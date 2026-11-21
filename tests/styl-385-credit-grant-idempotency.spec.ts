import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { handleStripeBillingEvent } from '../src/lib/billing/process-stripe-webhook';

const root = process.cwd();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GLOBEX = '10000000-0000-0000-0000-000000000002';

test.describe('STYL-385: credit grant idempotency', () => {
  test('migration adds sector_tag indexes and updates grant_one_off_pack', () => {
    const sql = readFileSync(
      join(root, 'supabase/migrations/20261121180100_styl385_credit_grant_idempotency.sql'),
      'utf8',
    );
    expect(sql).toContain('usage_ledger_invoice_addon_grant_key');
    expect(sql).toContain('usage_ledger_one_off_grant_key');
    expect(sql).toContain("sector_tag LIKE 'one_off:%'");
    expect(sql).toContain('grant_one_off_pack');
    expect(sql).not.toContain('20261024130000_styl202_addon_unique_and_helpers.sql');
  });

  test('Foundation checkout grants 10 voice minutes once per session id', async () => {
    test.skip(!serviceKey, 'Requires the local Supabase service role key');

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const sessionId = 'cs_styl385_checkout_once';
    await admin.from('usage_ledger').delete().eq('sector_tag', `plan_voice:checkout:${sessionId}`);

    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          customer: 'cus_styl385',
          metadata: { tenant_id: GLOBEX, plan_tier: 'foundation' },
        },
      },
    };

    const first = await handleStripeBillingEvent(event, { supabaseAdmin: admin });
    const second = await handleStripeBillingEvent(event, { supabaseAdmin: admin });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const { data: rows, error } = await admin
      .from('usage_ledger')
      .select('id, quantity, feature_id')
      .eq('tenant_id', GLOBEX)
      .eq('sector_tag', `plan_voice:checkout:${sessionId}`);
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.quantity).toBe(10);

    await admin.from('usage_ledger').delete().eq('sector_tag', `plan_voice:checkout:${sessionId}`);
  });

  test('the same invoice idempotency key is not inserted twice', async () => {
    test.skip(!serviceKey, 'Requires the local Supabase service role key');

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const invoiceId = 'in_styl385_invoice_key';
    const sector = `plan_voice:${invoiceId}`;

    await admin.from('usage_ledger').delete().eq('sector_tag', sector);
    await admin.from('stripe_webhook_processed_events').delete().like('event_id', 'evt_styl385_invoice%');

    const periodStart = Math.floor(Date.now() / 1000);
    const buildEvent = (eventSuffix: string) => ({
      id: `evt_styl385_invoice_${eventSuffix}`,
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: invoiceId,
          customer: 'cus_test_globex',
          billing_reason: 'subscription_cycle',
          period_start: periodStart,
          lines: {
            data: [{
              period: { start: periodStart, end: periodStart + 2592000 },
              price: { id: 'price_styl315_foundation' },
            }],
          },
          subscription_details: { metadata: { tenant_id: GLOBEX } },
        },
      },
    });

    await admin
      .from('subscription_tiers')
      .update({ stripe_price_id: 'price_styl315_foundation' })
      .in('id', ['foundation', 'base_tier']);

    const first = await handleStripeBillingEvent(buildEvent('one'), { supabaseAdmin: admin });
    const second = await handleStripeBillingEvent(buildEvent('two'), { supabaseAdmin: admin });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const { data: rows } = await admin
      .from('usage_ledger')
      .select('id, quantity')
      .eq('tenant_id', GLOBEX)
      .eq('sector_tag', sector);
    expect(rows).toHaveLength(1);

    await admin.from('usage_ledger').delete().eq('sector_tag', sector);
    await admin.from('stripe_webhook_processed_events').delete().like('event_id', 'evt_styl385_invoice%');
  });
});