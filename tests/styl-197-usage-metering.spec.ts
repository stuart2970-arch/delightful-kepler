import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  CHAT_MESSAGE_FEATURE_ID,
  VOICE_USAGE_FEATURE_ID,
  checkCapacityThresholds,
  getRolloverBalance,
  getTenantEffectiveLimit,
  logMeteredUsage,
} from '../src/lib/entitlements';
import {
  decideVoiceMinuteGate,
  INBOUND_MINUTES_EXHAUSTED_MESSAGE,
} from '../src/lib/telephony/voice-minute-gate';
import { POST as inboundPost } from '../src/app/api/telephony/inbound/route';

const root = process.cwd();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GLOBEX = '10000000-0000-0000-0000-000000000002';
const GATE_PHONE = '+447700900197';
const VOICE_IDS = ['voice_minutes', 'vapi_voice_minutes', 'voice_agent_minutes_web'];

const VOICE_ENV_KEYS = [
  'VOICE_ENABLED',
  'VAPI_API_KEY',
  'VAPI_PRIVATE_API_KEY',
  'VAPI_PRIVATE_KEY',
  'NEXT_PUBLIC_VAPI_PUBLIC_KEY',
  'VAPI_PUBLIC_KEY',
  'VAPI_MASTER_ASSISTANT_ID',
] as const;

function enableVoiceEnv(): () => void {
  const previous = Object.fromEntries(VOICE_ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.VOICE_ENABLED = 'true';
  process.env.VAPI_API_KEY = 'safe-test-vapi-private-key';
  process.env.VAPI_PRIVATE_API_KEY = 'safe-test-vapi-private-key';
  process.env.VAPI_PRIVATE_KEY = 'safe-test-vapi-private-key';
  process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY = 'safe-test-vapi-public-key';
  process.env.VAPI_PUBLIC_KEY = 'safe-test-vapi-public-key';
  process.env.VAPI_MASTER_ASSISTANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  return () => {
    for (const key of VOICE_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test.describe('STYL-197 usage metering and allowances', () => {
  test('chat meters message_allowance, the id the allowance checker reads', () => {
    expect(CHAT_MESSAGE_FEATURE_ID).toBe('message_allowance');
    const src = readFileSync(join(root, 'src/app/api/chat/stream/route.ts'), 'utf8');
    expect(src).toContain('CHAT_MESSAGE_FEATURE_ID');
    expect(src).not.toContain("'chat_messages'");
    expect(src).not.toContain('"chat_messages"');
  });

  test('usage insert errors are logged and do not throw', async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' '));
    };
    const client = {
      from(table: string) {
        return {
          insert: async () => ({ error: { code: '42P01', message: `${table} unavailable` }, data: null }),
        };
      },
    };
    try {
      await expect(logMeteredUsage(client, GLOBEX, 'message_allowance', 1, 'styl-197-error')).resolves.toBeUndefined();
    } finally {
      console.error = original;
    }
    expect(errors.join('\n')).toContain('[logMeteredUsage] usage_ledger insert failed');
    expect(errors.join('\n')).toContain('usage_ledger unavailable');
    expect(errors.join('\n')).toContain('[logMeteredUsage] usage_logs insert failed');
    expect(errors.join('\n')).toContain('usage_logs unavailable');
  });

  test('connected accounts reads usage_ledger.recorded_at', () => {
    const src = readFileSync(join(root, 'src/app/api/superadmin/connected-accounts/route.ts'), 'utf8');
    expect(src).toContain(".from('usage_ledger').select('quantity').gte('recorded_at', firstDayOfMonth)");
    expect(src).not.toContain(".from('usage_ledger').select('quantity').gte('created_at'");
  });

  test('catch-up and Microsoft Calendar migrations stay additive', () => {
    const catchup = readFileSync(
      join(root, 'supabase/migrations/20261111120000_styl197_dynamic_entitlements_catchup.sql'),
      'utf8',
    );
    const catchupSql = catchup.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
    expect(catchup).toContain('CREATE TABLE IF NOT EXISTS public.usage_logs');
    expect(catchup).toContain('CREATE TABLE IF NOT EXISTS public.tenant_entitlements');
    expect(catchup).toContain('ADD COLUMN IF NOT EXISTS type');
    expect(catchup).toContain('ADD COLUMN IF NOT EXISTS description');
    expect(catchup).toMatch(/description IS NULL/);
    expect(catchupSql).not.toMatch(/DROP TABLE/i);
    expect(catchupSql).not.toMatch(/DELETE FROM/i);
    expect(catchupSql).not.toContain('20261024130000');
    expect(catchupSql).not.toContain('sync_tenant_to_wordpress');
    expect(catchupSql).not.toContain('protect_super_admin_flag');

    const calendar = readFileSync(
      join(root, 'supabase/migrations/20261111120100_styl197_microsoft_calendar_catalogue_safe.sql'),
      'utf8',
    );
    const calendarSql = calendar.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
    expect(calendar).toContain("'remove_branding'");
    expect(calendar).toContain('ON CONFLICT (id) DO NOTHING');
    expect(calendar).toContain('ON CONFLICT (tier_id, feature_id) DO NOTHING');
    expect(calendar).toContain('information_schema.columns');
    expect(calendarSql).not.toContain('DO UPDATE');
    expect(calendarSql).not.toContain('sync_tenant_channel_flags');
    expect(calendarSql).not.toMatch(/INSERT INTO public\.features \(id, category_id, name, description\)/);

    const recorded = readFileSync(
      join(root, 'supabase/migrations/20261001150000_microsoft_calendar_addon.sql'),
      'utf8',
    );
    expect(recorded).toContain('INSERT INTO public.features (id, category_id, name, description)');
    expect(recorded).toContain('ON CONFLICT (tier_id, feature_id) DO UPDATE SET limit_value = 0');
  });

  test('minute gate allows under the allowance, blocks at 100%, and uses the plan default when there is no usage row', () => {
    expect(
      decideVoiceMinuteGate({
        usageRows: [{ quantity: 1, usage_type: 'consumption' }],
        catalogLimit: 10,
      }),
    ).toMatchObject({ allowed: true, reason: 'under_allowance', allowanceMinutes: 10, consumedMinutes: 1 });

    expect(
      decideVoiceMinuteGate({
        usageRows: [{ quantity: 10, usage_type: 'consumption' }],
        catalogLimit: 10,
      }),
    ).toMatchObject({ allowed: false, blockedForAllowance: true, reason: 'at_allowance', allowanceMinutes: 10, consumedMinutes: 10 });

    expect(
      decideVoiceMinuteGate({ usageRows: [], catalogLimit: 10 }),
    ).toMatchObject({ allowed: true, reason: 'plan_default', allowanceMinutes: 10, consumedMinutes: 0 });

    expect(
      decideVoiceMinuteGate({
        usageRows: [{ quantity: 100, usage_type: 'consumption' }],
        catalogLimit: null,
      }),
    ).toMatchObject({ allowed: true, reason: 'fail_open' });

    expect(
      decideVoiceMinuteGate({ usageRows: null, catalogLimit: 10 }),
    ).toMatchObject({ allowed: true, reason: 'fail_open' });

    expect(
      decideVoiceMinuteGate({
        usageRows: [
          { quantity: 20, usage_type: 'allocation' },
          { quantity: 20, usage_type: 'consumption' },
        ],
        catalogLimit: 10,
      }),
    ).toMatchObject({ allowed: false, reason: 'at_allowance', allowanceMinutes: 20, consumedMinutes: 20 });

    expect(INBOUND_MINUTES_EXHAUSTED_MESSAGE).toMatch(/run out of voice minutes/i);
  });
});

test.describe('STYL-197 database metering', () => {
  test.skip(!serviceKey, 'Requires the local Supabase service role key');

  let admin: SupabaseClient;

  test.beforeAll(() => {
    admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  test('a metered chat message writes usage_ledger and usage_logs for message_allowance', async () => {
    const marker = `styl-197-chat-${Date.now()}`;
    await logMeteredUsage(admin, GLOBEX, CHAT_MESSAGE_FEATURE_ID, 1, marker);

    const { data: ledger, error: ledgerError } = await admin
      .from('usage_ledger')
      .select('feature_id, quantity, usage_type')
      .eq('tenant_id', GLOBEX)
      .eq('feature_id', 'message_allowance')
      .order('recorded_at', { ascending: false })
      .limit(1);
    expect(ledgerError).toBeNull();
    expect(ledger?.[0]).toMatchObject({ feature_id: 'message_allowance', quantity: 1, usage_type: 'consumption' });

    const { data: logs, error: logsError } = await admin
      .from('usage_logs')
      .select('feature_id, amount, description')
      .eq('description', marker);
    expect(logsError).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs?.[0].feature_id).toBe('message_allowance');
    expect(logs?.[0].description).toBe(marker);
    expect(Number(logs?.[0].amount)).toBe(1);

    await admin.from('usage_logs').delete().eq('description', marker);
    await admin.from('usage_ledger').delete().eq('tenant_id', GLOBEX).eq('feature_id', 'message_allowance');
  });

  test('usage_ledger has recorded_at and not created_at', async () => {
    const { error: missing } = await admin
      .from('usage_ledger')
      .select('quantity')
      .gte('created_at', new Date().toISOString())
      .limit(1);
    expect(missing).toBeTruthy();

    const { error: present } = await admin
      .from('usage_ledger')
      .select('quantity')
      .gte('recorded_at', new Date(0).toISOString())
      .limit(1);
    expect(present).toBeNull();
  });

  test('legacy vapi_voice_minutes consumption reduces the voice balance and can trip the 85% alert', async () => {
    const limit = await getTenantEffectiveLimit(GLOBEX, 'voice_minutes');
    expect(typeof limit).toBe('number');
    expect(limit).toBeGreaterThan(0);

    const marker = `styl-197-legacy-${Date.now()}`;
    const before = await getRolloverBalance(GLOBEX);
    const quantity = 3;
    const { error: insertError } = await admin.from('usage_ledger').insert({
      tenant_id: GLOBEX,
      feature_id: 'vapi_voice_minutes',
      quantity,
      usage_type: 'consumption',
      sector_tag: marker,
      recorded_at: new Date().toISOString(),
    });
    expect(insertError).toBeNull();

    const after = await getRolloverBalance(GLOBEX);
    expect(after.voice_minutes_consumed).toBe(before.voice_minutes_consumed + quantity);

    const needed = Math.max(0, Math.ceil((limit as number) * 0.85) - after.voice_minutes_consumed);
    if (needed > 0) {
      const { error: topUpError } = await admin.from('usage_ledger').insert({
        tenant_id: GLOBEX,
        feature_id: 'vapi_voice_minutes',
        quantity: needed,
        usage_type: 'consumption',
        sector_tag: marker,
        recorded_at: new Date().toISOString(),
      });
      expect(topUpError).toBeNull();
    }

    const thresholds = await checkCapacityThresholds(GLOBEX);
    const voice = thresholds.find((row) => row.featureId === 'voice_minutes');
    expect(voice).toBeTruthy();
    expect(voice!.percentUsed).toBeGreaterThanOrEqual(85);
    expect(voice!.currentUsage).toBeGreaterThanOrEqual(Math.ceil((limit as number) * 0.85));

    await admin.from('usage_ledger').delete().eq('sector_tag', marker);
  });

  test('a Vapi end-of-call records voice_minutes so the dashboard balance counts it', async ({ request }) => {
    const before = await getRolloverBalance(GLOBEX);
    const callId = `styl-197-vapi-${Date.now()}`;
    const res = await request.post('/api/webhooks/vapi', {
      headers: { 'x-vapi-secret': process.env.VAPI_WEBHOOK_SECRET || 'test-vapi-webhook-secret' },
      data: {
        message: {
          type: 'end-of-call-report',
          call: {
            id: callId,
            type: 'inboundPhoneCall',
            duration: 60,
            transcript: 'User: Hello.',
            metadata: { tenant_id: GLOBEX, session_id: callId },
          },
        },
      },
    });
    expect(res.status()).toBe(200);

    const { data: row, error } = await admin
      .from('usage_ledger')
      .select('feature_id, quantity, usage_type')
      .eq('tenant_id', GLOBEX)
      .eq('sector_tag', `Vapi Call ID: ${callId}`)
      .maybeSingle();
    expect(error).toBeNull();
    expect(row).toMatchObject({
      feature_id: VOICE_USAGE_FEATURE_ID,
      quantity: 1,
      usage_type: 'consumption',
    });

    const after = await getRolloverBalance(GLOBEX);
    expect(after.voice_minutes_consumed).toBeGreaterThanOrEqual(before.voice_minutes_consumed + 1);

    await admin.from('usage_ledger').delete().eq('sector_tag', `Vapi Call ID: ${callId}`);
    await admin.from('conversations').delete().eq('user_session_id', callId);
  });
});

test.describe('STYL-197 inbound minute gate', () => {
  test.skip(!serviceKey, 'Requires the local Supabase service role key');

  let admin: SupabaseClient;
  let restoreEnv: (() => void) | null = null;
  let savedPhone: { twilio_shadow_number: string | null; twilio_mobile_number: string | null } | null = null;
  let savedVoiceRows: Array<Record<string, unknown>> = [];

  test.beforeAll(async () => {
    admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: tenant } = await admin
      .from('tenants')
      .select('twilio_shadow_number, twilio_mobile_number')
      .eq('id', GLOBEX)
      .single();
    savedPhone = {
      twilio_shadow_number: tenant?.twilio_shadow_number ?? null,
      twilio_mobile_number: tenant?.twilio_mobile_number ?? null,
    };
    const { error: phoneError } = await admin
      .from('tenants')
      .update({ twilio_shadow_number: GATE_PHONE })
      .eq('id', GLOBEX);
    expect(phoneError).toBeNull();

    const { data: existing } = await admin
      .from('usage_ledger')
      .select('*')
      .eq('tenant_id', GLOBEX)
      .in('feature_id', VOICE_IDS);
    savedVoiceRows = existing || [];
    if (savedVoiceRows.length > 0) {
      await admin.from('usage_ledger').delete().eq('tenant_id', GLOBEX).in('feature_id', VOICE_IDS);
    }
    restoreEnv = enableVoiceEnv();
  });

  test.afterAll(async () => {
    if (restoreEnv) restoreEnv();
    if (!admin) return;
    await admin.from('usage_ledger').delete().eq('tenant_id', GLOBEX).in('feature_id', VOICE_IDS);
    if (savedVoiceRows.length > 0) {
      const restored = savedVoiceRows.map((row) => {
        const copy = { ...row };
        delete copy.id;
        return copy;
      });
      await admin.from('usage_ledger').insert(restored);
    }
    if (savedPhone) {
      await admin.from('tenants').update(savedPhone).eq('id', GLOBEX);
    }
  });

  async function placeCall(): Promise<{ body: string; warns: string[]; logs: string[] }> {
    const warns: string[] = [];
    const logs: string[] = [];
    const originalWarn = console.warn;
    const originalLog = console.log;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(' '));
    };
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    try {
      const form = new FormData();
      form.set('To', GATE_PHONE);
      form.set('From', '+447700900198');
      const response = await inboundPost(
        new Request('http://localhost:3001/api/telephony/inbound', { method: 'POST', body: form }),
      );
      return { body: await response.text(), warns, logs };
    } finally {
      console.warn = originalWarn;
      console.log = originalLog;
    }
  }

  test('under the plan allowance the call is forwarded', async () => {
    const { error } = await admin.from('usage_ledger').insert({
      tenant_id: GLOBEX,
      feature_id: 'voice_minutes',
      quantity: 1,
      usage_type: 'consumption',
      sector_tag: 'styl-197-gate-under',
      recorded_at: new Date().toISOString(),
    });
    expect(error).toBeNull();

    const { body, warns } = await placeCall();
    expect(body).toContain('https://api.vapi.ai/twilio/inbound_call');
    expect(body).not.toContain(INBOUND_MINUTES_EXHAUSTED_MESSAGE);
    expect(warns.join('\n')).not.toContain('[Telephony Inbound] BLOCK');

    await admin.from('usage_ledger').delete().eq('sector_tag', 'styl-197-gate-under');
  });

  test('at 100% of the allowance the call is blocked and the block is logged', async () => {
    const { error } = await admin.from('usage_ledger').insert({
      tenant_id: GLOBEX,
      feature_id: 'voice_minutes',
      quantity: 10,
      usage_type: 'consumption',
      sector_tag: 'styl-197-gate-full',
      recorded_at: new Date().toISOString(),
    });
    expect(error).toBeNull();

    const { body, warns } = await placeCall();
    expect(body).toContain(INBOUND_MINUTES_EXHAUSTED_MESSAGE);
    expect(body).not.toContain('https://api.vapi.ai/twilio/inbound_call');
    expect(warns.join('\n')).toContain(`[Telephony Inbound] BLOCK tenant=${GLOBEX}`);
    expect(warns.join('\n')).toContain('allowance=10');
    expect(warns.join('\n')).toContain('consumed=10');

    await admin.from('usage_ledger').delete().eq('sector_tag', 'styl-197-gate-full');
  });

  test('with no usage row the call uses the plan default and is forwarded', async () => {
    const { count, error } = await admin
      .from('usage_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', GLOBEX)
      .in('feature_id', VOICE_IDS);
    expect(error).toBeNull();
    expect(count ?? 0).toBe(0);

    const { body, warns, logs } = await placeCall();
    expect(body).toContain('https://api.vapi.ai/twilio/inbound_call');
    expect(body).not.toContain(INBOUND_MINUTES_EXHAUSTED_MESSAGE);
    expect(warns.join('\n')).not.toContain('[Telephony Inbound] BLOCK');
    expect(logs.join('\n')).toContain('reason: plan_default');
    expect(logs.join('\n')).toContain('allowance: 10');
  });
});
