import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { handleStripeBillingEvent } from '../src/lib/billing/process-stripe-webhook';
import { getRolloverBalance } from '../src/lib/entitlements';
import { resolveVoiceAllowance } from '../src/lib/telephony/voice-minute-gate';
import { handleInboundPost } from '../src/app/api/telephony/inbound/route';

/**
 * Foundation plan minutes on renewal. Local Supabase only. No Stripe API calls.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GLOBEX = '10000000-0000-0000-0000-000000000002';
const PHONE = '+447700900315';

test.describe('plan voice minutes for the current window', () => {
  test('a month of plan minutes is not compared with the whole rollover window', () => {
    expect(resolveVoiceAllowance({
      rolloverAllocated: 0,
      rolloverConsumed: 15,
      planMinutes: 10,
      currentPeriodConsumed: 0,
    })).toEqual({ allocated: 10, consumed: 0, source: 'plan_window' });

    expect(resolveVoiceAllowance({
      rolloverAllocated: 30,
      rolloverConsumed: 12,
      planMinutes: 10,
      currentPeriodConsumed: 2,
    })).toEqual({ allocated: 30, consumed: 12, source: 'rollover' });
  });
});

test.describe('STYL-315 Foundation voice renewal', () => {
  test.skip(!serviceKey, 'Requires the local Supabase service role key');

  let admin: SupabaseClient;
  let savedPhone: string | null = null;
  let insertedLandline = false;

  test.beforeAll(async () => {
    admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: tenant } = await admin.from('tenants').select('twilio_shadow_number, plan_tier').eq('id', GLOBEX).single();
    savedPhone = tenant?.twilio_shadow_number ?? null;
    expect(tenant?.plan_tier).toBe('foundation');
    await admin.from('tenants').update({ twilio_shadow_number: PHONE }).eq('id', GLOBEX);
    await admin.from('usage_ledger').delete().like('sector_tag', 'plan_voice:in_styl315%');
    await admin.from('usage_ledger').delete().eq('sector_tag', 'styl-315-old-usage');
  });

  test.afterAll(async () => {
    if (!admin) return;
    await admin.from('usage_ledger').delete().like('sector_tag', 'plan_voice:in_styl315%');
    await admin.from('usage_ledger').delete().eq('sector_tag', 'styl-315-landline');
    await admin.from('usage_ledger').delete().eq('sector_tag', 'styl-315-old-usage');
    if (insertedLandline) {
      await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', 'landline_addon');
    }
    await admin.from('tenants').update({ twilio_shadow_number: savedPhone }).eq('id', GLOBEX);
  });

  function renewalInvoice(id: string, reason = 'subscription_cycle') {
    const periodStart = Math.floor(Date.now() / 1000);
    return {
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id,
          customer: 'cus_test_globex',
          billing_reason: reason,
          period_start: periodStart,
          lines: { data: [{ period: { start: periodStart, end: periodStart + 2592000 } }] },
          subscription_details: { metadata: { tenant_id: GLOBEX } },
        },
      },
    };
  }

  test('the first monthly renewal grants the plan minutes once, and a duplicate delivery does not grant again', async () => {
    const invoiceId = 'in_styl315_first';
    const event = renewalInvoice(invoiceId);

    const first = await handleStripeBillingEvent(event, { supabaseAdmin: admin });
    expect(first.status).toBe(200);

    const { data: granted, error } = await admin
      .from('usage_ledger')
      .select('quantity, feature_id, usage_type, sector_tag, addon_catalog_id')
      .eq('tenant_id', GLOBEX)
      .eq('sector_tag', `plan_voice:${invoiceId}`);
    expect(error).toBeNull();
    expect(granted).toHaveLength(1);
    expect(granted?.[0]).toMatchObject({
      quantity: 10,
      feature_id: 'voice_minutes',
      usage_type: 'allocation',
      addon_catalog_id: null,
    });

    const second = await handleStripeBillingEvent(event, { supabaseAdmin: admin });
    expect(second.status).toBe(200);
    const { count } = await admin
      .from('usage_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', GLOBEX)
      .eq('sector_tag', `plan_voice:${invoiceId}`);
    expect(count).toBe(1);
  });

  test('a signup invoice does not grant a second block on top of checkout', async () => {
    const invoiceId = 'in_styl315_signup';
    const result = await handleStripeBillingEvent(renewalInvoice(invoiceId, 'subscription_create'), { supabaseAdmin: admin });
    expect(result.status).toBe(200);
    const { count } = await admin
      .from('usage_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('sector_tag', `plan_voice:${invoiceId}`);
    expect(count ?? 0).toBe(0);
  });

  test('a renewal grants plan minutes and the active bolt-on minutes', async () => {
    const { data: catalog } = await admin
      .from('addon_catalog')
      .select('included_voice_minutes')
      .eq('id', 'landline_addon')
      .single();
    const landlineMinutes = Number(catalog?.included_voice_minutes || 0);
    expect(landlineMinutes).toBeGreaterThan(0);

    const { data: already } = await admin
      .from('tenant_active_addons')
      .select('id')
      .eq('tenant_id', GLOBEX)
      .eq('addon_catalog_id', 'landline_addon')
      .eq('is_active', true)
      .maybeSingle();
    if (!already) {
      const { error: insertError } = await admin.from('tenant_active_addons').insert({
        tenant_id: GLOBEX,
        addon_catalog_id: 'landline_addon',
        feature_id: 'telephone_number',
        quantity: 1,
        is_active: true,
      });
      expect(insertError).toBeNull();
      insertedLandline = true;
    }

    const invoiceId = 'in_styl315_with_landline';
    const result = await handleStripeBillingEvent(renewalInvoice(invoiceId), { supabaseAdmin: admin });
    expect(result.status).toBe(200);

    const { data: planRow } = await admin
      .from('usage_ledger')
      .select('quantity, addon_catalog_id')
      .eq('sector_tag', `plan_voice:${invoiceId}`)
      .maybeSingle();
    expect(planRow).toMatchObject({ quantity: 10, addon_catalog_id: null });

    const since = new Date(Date.now() - 60_000).toISOString();
    const { data: boltOnRows } = await admin
      .from('usage_ledger')
      .select('quantity, addon_catalog_id, usage_type')
      .eq('tenant_id', GLOBEX)
      .eq('addon_catalog_id', 'landline_addon')
      .eq('usage_type', 'allocation')
      .gte('recorded_at', since);
    expect(boltOnRows?.some((row) => Number(row.quantity) === landlineMinutes)).toBe(true);

    const balance = await getRolloverBalance(GLOBEX);
    expect(balance.voice_minutes_allocated).toBeGreaterThanOrEqual(10 + landlineMinutes);
  });

  test('usage from outside this month does not use up the plan fallback', async () => {
    await admin.from('usage_ledger').delete().eq('tenant_id', GLOBEX).in('feature_id', ['voice_minutes', 'vapi_voice_minutes', 'voice_agent_minutes_web']);
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    const { error } = await admin.from('usage_ledger').insert({
      tenant_id: GLOBEX,
      feature_id: 'vapi_voice_minutes',
      quantity: 15,
      usage_type: 'consumption',
      sector_tag: 'styl-315-old-usage',
      recorded_at: twoMonthsAgo.toISOString(),
    });
    expect(error).toBeNull();

    const balance = await getRolloverBalance(GLOBEX);
    expect(balance.voice_minutes_allocated).toBe(0);
    expect(balance.voice_minutes_consumed).toBe(15);

    const form = new FormData();
    form.set('To', PHONE);
    form.set('From', '+447700900316');
    const previous = process.env.VOICE_ENABLED;
    process.env.VOICE_ENABLED = 'true';
    process.env.VAPI_API_KEY = 'safe-test-vapi-private-key';
    process.env.VAPI_PRIVATE_API_KEY = 'safe-test-vapi-private-key';
    process.env.VAPI_PRIVATE_KEY = 'safe-test-vapi-private-key';
    process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY = 'safe-test-vapi-public-key';
    process.env.VAPI_PUBLIC_KEY = 'safe-test-vapi-public-key';
    process.env.VAPI_MASTER_ASSISTANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    try {
      const response = await handleInboundPost(
        new Request('http://localhost:3001/api/telephony/inbound', { method: 'POST', body: form }),
      );
      const body = await response.text();
      expect(body).toContain('https://api.vapi.ai/twilio/inbound_call');
      expect(body).not.toContain("We can't take your call right now");
      expect(logs.join('\n')).toContain('reason: plan_default');
      expect(logs.join('\n')).toContain('consumed: 0');
    } finally {
      console.log = original;
      if (previous === undefined) delete process.env.VOICE_ENABLED;
      else process.env.VOICE_ENABLED = previous;
      await admin.from('usage_ledger').delete().eq('sector_tag', 'styl-315-old-usage');
    }
  });
});
