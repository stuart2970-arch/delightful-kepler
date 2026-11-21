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
const GLOBEX = '10000000-0000-0000-0000-000000000002';
const GATE_PHONE = '+447700900197';
const CHATBOT_GLOBEX = 'e0000000-0000-0000-0000-000000000002';

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
  let savedPhone: string | null;

  test.beforeAll(async () => {
    restoreEnv = enableVoiceEnv();
    admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: tenant } = await admin.from('tenants').select('twilio_shadow_number').eq('id', GLOBEX).single();
    savedPhone = tenant?.twilio_shadow_number ?? null;
    await admin.from('tenants').update({ twilio_shadow_number: GATE_PHONE }).eq('id', GLOBEX);
    await admin.from('usage_ledger').delete().like('sector_tag', 'one_off:styl-295-296%');
    await admin.from('usage_ledger').delete().like('sector_tag', 'styl-295-296%');
    await admin.from('chatbots').update({ voice_enabled: true }).eq('id', CHATBOT_GLOBEX);
  });

  test.afterAll(async () => {
    if (admin) {
      await admin.from('usage_ledger').delete().like('sector_tag', 'one_off:styl-295-296%');
      await admin.from('usage_ledger').delete().like('sector_tag', 'styl-295-296%');
      await admin.from('tenants').update({ twilio_shadow_number: savedPhone }).eq('id', GLOBEX);
    }
    restoreEnv?.();
  });

  async function seedPackOnly(allocated: number, consumed: number) {
    const now = new Date();
    const expires = new Date(now);
    expires.setMonth(expires.getMonth() + 2);
    await admin.from('usage_ledger').delete().like('sector_tag', 'one_off:styl-295-296%');
    await admin.from('usage_ledger').delete().like('sector_tag', 'styl-295-296%');
    const rows = [];
    const packSector = `one_off:styl-295-296-${Date.now()}:voice_minutes`;
    if (allocated > 0) {
      rows.push({
        tenant_id: GLOBEX,
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
        tenant_id: GLOBEX,
        feature_id: 'voice_minutes',
        quantity: consumed,
        usage_type: 'consumption',
        sector_tag: 'styl-295-296-consume',
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
    const gate = await evaluateTenantVoiceMinuteGate(admin, GLOBEX);
    expect(gate.decision).toMatchObject({ allowed: true, allowanceMinutes: 30, consumedMinutes: 5 });
  });

  test('at 100% the widget config turns voice off and web-call refuses with the holding message', async () => {
    await seedPackOnly(20, 30);
    const gate = await evaluateTenantVoiceMinuteGate(admin, GLOBEX);
    expect(gate.decision.allowed).toBe(false);

    const access = await resolveChatbotVoiceAccess(admin, {
      id: CHATBOT_GLOBEX,
      tenant_id: GLOBEX,
      voice_enabled: true,
    });
    expect(access.voiceEnabled).toBe(false);
    expect(access.reason).toBe(INBOUND_MINUTES_EXHAUSTED_MESSAGE);

    const configRes = await getChatbotConfig(
      new Request(`http://localhost/api/chatbots/${CHATBOT_GLOBEX}`),
      { params: Promise.resolve({ id: CHATBOT_GLOBEX }) },
    );
    const config = await configRes.json();
    expect(config.voiceEnabled).toBe(false);
  });

  test('at 100% inbound and widget both refuse; below 100% both allow', async () => {
    await seedPackOnly(20, 25);
    const gateUnder = await evaluateTenantVoiceMinuteGate(admin, GLOBEX);
    expect(gateUnder.decision.allowed).toBe(true);

    const formUnder = new FormData();
    formUnder.set('To', GATE_PHONE);
    const inboundUnder = await handleInboundPost(
      new Request('http://localhost/api/telephony/inbound', { method: 'POST', body: formUnder }),
    );
    expect(await inboundUnder.text()).toContain('https://api.vapi.ai/twilio/inbound_call');

    await seedPackOnly(20, 30);
    const formBlock = new FormData();
    formBlock.set('To', GATE_PHONE);
    const inboundBlock = await handleInboundPost(
      new Request('http://localhost/api/telephony/inbound', { method: 'POST', body: formBlock }),
    );
    expect(await inboundBlock.text()).toContain(INBOUND_MINUTES_EXHAUSTED_MESSAGE);

    const accessBlock = await resolveChatbotVoiceAccess(admin, {
      id: CHATBOT_GLOBEX,
      tenant_id: GLOBEX,
      voice_enabled: true,
    });
    expect(accessBlock.allowed).toBe(false);
    expect(accessBlock.reason).toBe(INBOUND_MINUTES_EXHAUSTED_MESSAGE);
  });

  test('web-call refuses exhausted allowance without calling Vapi when mock header is set', async () => {
    process.env.PLAYWRIGHT_TEST = 'true';
    await seedPackOnly(20, 30);
    const sessionId = 'styl-295-296-session';
    const sessionToken = signChatSessionToken({
      chatbotId: CHATBOT_GLOBEX,
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
        chatbotId: CHATBOT_GLOBEX,
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