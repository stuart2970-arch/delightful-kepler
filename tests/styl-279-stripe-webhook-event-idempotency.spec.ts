import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { handleStripeBillingEvent } from '../src/lib/billing/process-stripe-webhook';
import { POST } from '../src/app/api/webhooks/stripe/route';

const root = process.cwd();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GLOBEX = '10000000-0000-0000-0000-000000000002';
const EVENT_ID = 'evt_styl279_dup_invoice';
const INVOICE_ID = 'in_styl279_dup';

test.describe('STYL-279: Stripe webhook event idempotency', () => {
  test('migration creates a service-role-only processed-events table', () => {
    const sql = readFileSync(
      join(root, 'supabase/migrations/20261121180000_styl279_stripe_webhook_processed_events.sql'),
      'utf8',
    );
    expect(sql).toContain('stripe_webhook_processed_events');
    expect(sql).toContain('event_id text PRIMARY KEY');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.stripe_webhook_processed_events/);
    expect(sql).toContain('claim_stripe_webhook_event');
    expect(sql).toContain('complete_stripe_webhook_event');
  });

  test('duplicate delivery with the same event id runs billing side effects once', async () => {
    test.skip(!serviceKey, 'Requires the local Supabase service role key');

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await admin.from('stripe_webhook_processed_events').delete().eq('event_id', EVENT_ID);
    await admin.from('usage_ledger').delete().eq('sector_tag', `plan_voice:${INVOICE_ID}`);

    const allocations: Array<number> = [];
    const periodStart = Math.floor(Date.now() / 1000);
    const event = {
      id: EVENT_ID,
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: INVOICE_ID,
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
    };

    await admin
      .from('subscription_tiers')
      .update({ stripe_price_id: 'price_styl315_foundation' })
      .in('id', ['foundation', 'base_tier']);

    const deps = {
      supabaseAdmin: admin,
      allocateRollingCredits: async () => {
        allocations.push(1);
        return { id: 'alloc-tracked' };
      },
    };

    const first = await handleStripeBillingEvent(event, deps);
    const second = await handleStripeBillingEvent(event, deps);

    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeFalsy();
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(allocations).toHaveLength(1);

    const { data: row } = await admin
      .from('stripe_webhook_processed_events')
      .select('status, event_type')
      .eq('event_id', EVENT_ID)
      .maybeSingle();
    expect(row?.status).toBe('processed');
    expect(row?.event_type).toBe('invoice.payment_succeeded');

    await admin.from('stripe_webhook_processed_events').delete().eq('event_id', EVENT_ID);
    await admin.from('usage_ledger').delete().eq('sector_tag', `plan_voice:${INVOICE_ID}`);
  });

  test('a failed handler can be retried safely after the event is marked failed', async () => {
    test.skip(!serviceKey, 'Requires the local Supabase service role key');

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const retryEventId = 'evt_styl279_retry_fail';
    const invoiceId = 'in_styl279_retry_fail';
    await admin.from('stripe_webhook_processed_events').delete().eq('event_id', retryEventId);
    await admin.from('usage_ledger').delete().eq('sector_tag', `plan_voice:${invoiceId}`);

    const periodStart = Math.floor(Date.now() / 1000);
    const event = {
      id: retryEventId,
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
    };

    let shouldFail = true;
    const flakyDeps = {
      supabaseAdmin: admin,
      allocateRollingCredits: async () => {
        if (shouldFail) throw new Error('simulated billing failure');
        return { id: 'ok' };
      },
    };

  await admin
      .from('subscription_tiers')
      .update({ stripe_price_id: 'price_styl315_foundation' })
      .in('id', ['foundation', 'base_tier']);

    const first = await handleStripeBillingEvent(event, flakyDeps);
    expect(first.status).toBe(500);

    const { data: failedRow } = await admin
      .from('stripe_webhook_processed_events')
      .select('status')
      .eq('event_id', retryEventId)
      .maybeSingle();
    expect(failedRow?.status).toBe('failed');

    shouldFail = false;
    const second = await handleStripeBillingEvent(event, { supabaseAdmin: admin });
    expect(second.status).toBe(200);

    await admin.from('stripe_webhook_processed_events').delete().eq('event_id', retryEventId);
    await admin.from('usage_ledger').delete().eq('sector_tag', `plan_voice:${invoiceId}`);
  });
});

test.describe('STYL-279: webhook route duplicate signed payload', () => {
  test('POST with the same signed event id returns 200 without re-running billing', async () => {
    test.skip(!serviceKey, 'Requires the local Supabase service role key');

    const TEST_SECRET = 'whsec_styl279_test_signing_secret';
    const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const eventId = 'evt_styl279_route_dup';
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await admin.from('stripe_webhook_processed_events').delete().eq('event_id', eventId);

    const payload = JSON.stringify({
      id: eventId,
      object: 'event',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_styl279_route',
          subscription_details: { metadata: { tenant_id: GLOBEX } },
        },
      },
    });

    try {
      process.env.STRIPE_WEBHOOK_SECRET = TEST_SECRET;
      const headers = {
        'content-type': 'application/json',
        'stripe-signature': Stripe.webhooks.generateTestHeaderString({
          payload,
          secret: TEST_SECRET,
        }),
      };

      const first = await POST(new Request('http://localhost:3001/api/webhooks/stripe', {
        method: 'POST',
        headers,
        body: payload,
      }));
      const second = await POST(new Request('http://localhost:3001/api/webhooks/stripe', {
        method: 'POST',
        headers,
        body: payload,
      }));

      expect(first.status).toBe(200);
      const firstBody = await first.json();
      expect(firstBody.duplicate).toBeFalsy();

      expect(second.status).toBe(200);
      const secondBody = await second.json();
      expect(secondBody.duplicate).toBe(true);
    } finally {
      if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
      await admin.from('stripe_webhook_processed_events').delete().eq('event_id', eventId);
    }
  });
});