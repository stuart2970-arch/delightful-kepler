import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  buildVoiceMinuteGateBalance,
  decideVoiceMinuteGate,
  INBOUND_MINUTES_EXHAUSTED_MESSAGE,
} from '../src/lib/telephony/voice-minute-gate';
import { evaluateTenantVoiceMinuteGate } from '../src/lib/telephony/tenant-voice-minute-gate';
import { resolveChatbotVoiceAccess } from '../src/lib/voice/chatbot-voice-access';
import { handleInboundPost } from '../src/app/api/telephony/inbound/route';
import { POST as webCallPost } from '../src/app/api/voice/web-call/route';
import { GET as getChatbotConfig } from '../src/app/api/chatbots/[id]/route';
import { signChatSessionToken } from '../src/lib/chat-session';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Dedicated tenant/chatbot so ledger pollution from parallel specs cannot shift consumed totals. */
const ISOLATED_TENANT = 'f2950000-0000-4000-8000-000000000295';
const ISOLATED_CHATBOT = 'f2950000-0000-4000-8000-000000000296';
const ISOLATED_PHONE = '+447700900295';
const LEDGER_TAG = 'styl-295-296-isolated';

const VOICE_ENV_KEYS = [
  'VOICE_ENABLED',
  'VAPI_API_KEY',
  'VAPI_PRIVATE_API_KEY',
  'VAPI_PRIVATE_KEY',
  'NEXT_PUBLIC_VAPI_PUBLIC_KEY',
  'VAPI_PUBLIC_KEY',
  'VAPI_MASTER_ASSISTANT_ID',
  'NEXT_PUBLIC_APP_URL',
  'VAPI_WEBHOOK_SECRET',
  'PLAYWRIGHT_TEST',
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
  process.env.NEXT_PUBLIC_APP_URL = 'http://127.0.0.1:3001';
  process.env.VAPI_WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.PLAYWRIGHT_TEST = 'true';
  return () => {
    for (const key of VOICE_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test.describe('STYL-296 included plan minutes with purchased packs', () => {
  test('buildVoiceMinuteGateBalance adds catalogue minutes when the plan grant is missing from the ledger', () => {
    expect(
      buildVoiceMinuteGateBalance({
        rolloverAllocated: 20,
        consumed: 5,
        catalogLimit: 10,
        planVoiceAllocatedInLedger: 0,
        purchasedPackAllocationInLedger: 20,
      }),
    ).toEqual({ allocated: 30, consumed: 5 });

    expect(
      decideVoiceMinuteGate({
        balance: buildVoiceMinuteGateBalance({
          rolloverAllocated: 20,
          consumed: 30,
          catalogLimit: 10,
          planVoiceAllocatedInLedger: 0,
          purchasedPackAllocationInLedger: 20,
        }),
        catalogLimit: 10,
      }),
    ).toMatchObject({ allowed: false, blockedForAllowance: true, allowanceMinutes: 30, consumedMinutes: 30 });

    expect(
      buildVoiceMinuteGateBalance({
        rolloverAllocated: 30,
        consumed: 10,
        catalogLimit: 10,
        planVoiceAllocatedInLedger: 10,
        purchasedPackAllocationInLedger: 20,
      }),
    ).toEqual({ allocated: 30, consumed: 10 });
  });

  test('pack only still blocks at 100% of the pack allowance', () => {
    expect(
      decideVoiceMinuteGate({
        balance: { allocated: 20, consumed: 20 },
        catalogLimit: 10,
      }),
    ).toMatchObject({ allowed: false, reason: 'at_allowance', allowanceMinutes: 20 });
  });

  test('plan window still applies with no pack in the ledger', () => {
    expect(
      decideVoiceMinuteGate({
        balance: { allocated: 0, consumed: 10 },
        catalogLimit: 10,
      }),
    ).toMatchObject({ allowed: false, reason: 'at_allowance', allowanceMinutes: 10 });
  });
});

test.describe('STYL-295 and STYL-296 integration', () => {
  test.skip(!serviceKey, 'Requires the local Supabase service role key');

  let admin: SupabaseClient;
  let restoreEnv: () => void;

  test.beforeAll(async () => {
    restoreEnv = enableVoiceEnv();
    admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await admin.from('usage_ledger').delete().eq('tenant_id', ISOLATED_TENANT);

    const { error: tenantError } = await admin.from('tenants').upsert({
      id: ISOLATED_TENANT,
      tenant_id: ISOLATED_TENANT,
      company_name: 'STYL-295 Isolated',
      slug: 'styl-295-isolated',
      plan_tier: 'foundation',
      twilio_shadow_number: ISOLATED_PHONE,
    });
    expect(tenantError).toBeNull();

    const { error: botError } = await admin.from('chatbots').upsert({
      id: ISOLATED_CHATBOT,
      tenant_id: ISOLATED_TENANT,
      name: 'STYL-295 Gate Bot',
      primary_color: '#4F46E5',
      configuration_json: { agent_name: 'Gate Bot' },
      voice_enabled: true,
    });
    expect(botError).toBeNull();
  });

  test.afterAll(async () => {
    if (admin) {
      await admin.from('usage_ledger').delete().eq('tenant_id', ISOLATED_TENANT);
      await admin.from('chatbots').delete().eq('id', ISOLATED_CHATBOT);
      await admin.from('tenants').delete().eq('id', ISOLATED_TENANT);
    }
    restoreEnv?.();
  });

  async function seedPackOnly(allocated: number, consumed: number) {
    const now = new Date();
    const expires = new Date(now);
    expires.setMonth(expires.getMonth() + 2);
    await admin.from('usage_ledger').delete().eq('tenant_id', ISOLATED_TENANT);
    const rows = [];
    const packSector = `one_off:${LEDGER_TAG}:${Date.now()}:voice_minutes`;
    if (allocated > 0) {
      rows.push({
        tenant_id: ISOLATED_TENANT,
        feature_id: 'voice_minutes',
        quantity: allocated,
        usage_type: 'allocation',
        sector_tag: packSector,
        expires_at: expires.toISOString(),
        billing_period_start: now.toISOString(),
        recorded_at: now.toISOString(),
      });
    }
    if (consumed > 0) {
      rows.push({
        tenant_id: ISOLATED_TENANT,
        feature_id: 'voice_minutes',
        quantity: consumed,
        usage_type: 'consumption',
        sector_tag: `${LEDGER_TAG}-consume`,
        recorded_at: now.toISOString(),
      });
    }
    if (rows.length > 0) {
      const { error } = await admin.from('usage_ledger').insert(rows);
      expect(error).toBeNull();
    }
  }

  test('included-not-in-ledger plus pack allows calls below the combined allowance', async () => {
    await seedPackOnly(20, 5);
    const gate = await evaluateTenantVoiceMinuteGate(admin, ISOLATED_TENANT);
    expect(gate.decision).toMatchObject({ allowed: true, allowanceMinutes: 30, consumedMinutes: 5 });
  });

  test('at 100% the widget config turns voice off and web-call refuses with the holding message', async () => {
    await seedPackOnly(20, 30);
    const gate = await evaluateTenantVoiceMinuteGate(admin, ISOLATED_TENANT);
    expect(gate.decision.allowed).toBe(false);

    const access = await resolveChatbotVoiceAccess(admin, {
      id: ISOLATED_CHATBOT,
      tenant_id: ISOLATED_TENANT,
      voice_enabled: true,
    });
    expect(access.voiceEnabled).toBe(false);
    expect(access.reason).toBe(INBOUND_MINUTES_EXHAUSTED_MESSAGE);

    const configRes = await getChatbotConfig(
      new Request(`http://localhost/api/chatbots/${ISOLATED_CHATBOT}`),
      { params: Promise.resolve({ id: ISOLATED_CHATBOT }) },
    );
    const config = await configRes.json();
    expect(config.voiceEnabled).toBe(false);
  });

  test('at 100% inbound and widget both refuse; below 100% both allow', async () => {
    await seedPackOnly(20, 25);
    const gateUnder = await evaluateTenantVoiceMinuteGate(admin, ISOLATED_TENANT);
    expect(gateUnder.decision.allowed).toBe(true);

    const formUnder = new FormData();
    formUnder.set('To', ISOLATED_PHONE);
    const inboundUnder = await handleInboundPost(
      new Request('http://localhost/api/telephony/inbound', { method: 'POST', body: formUnder }),
    );
    expect(await inboundUnder.text()).toContain('https://api.vapi.ai/twilio/inbound_call');

    await seedPackOnly(20, 30);
    const formBlock = new FormData();
    formBlock.set('To', ISOLATED_PHONE);
    const inboundBlock = await handleInboundPost(
      new Request('http://localhost/api/telephony/inbound', { method: 'POST', body: formBlock }),
    );
    expect(await inboundBlock.text()).toContain(INBOUND_MINUTES_EXHAUSTED_MESSAGE);

    const accessBlock = await resolveChatbotVoiceAccess(admin, {
      id: ISOLATED_CHATBOT,
      tenant_id: ISOLATED_TENANT,
      voice_enabled: true,
    });
    expect(accessBlock.allowed).toBe(false);
    expect(accessBlock.reason).toBe(INBOUND_MINUTES_EXHAUSTED_MESSAGE);
  });

  test('web-call refuses exhausted allowance without calling Vapi when mock header is set', async () => {
    await seedPackOnly(20, 30);
    const sessionId = 'styl-295-296-session';
    const sessionToken = signChatSessionToken({
      chatbotId: ISOLATED_CHATBOT,
      sessionId,
      expiresInSeconds: 3600,
    });
    const request = new Request('http://localhost/api/voice/web-call', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-token': sessionToken,
        'x-test-mock-vapi-web-call': '1',
        Origin: 'http://localhost:3001',
      },
      body: JSON.stringify({
        chatbotId: ISOLATED_CHATBOT,
        sessionId,
        assistant: { recordingEnabled: false },
      }),
    });
    const response = await webCallPost(request);
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toBe(INBOUND_MINUTES_EXHAUSTED_MESSAGE);
  });
});