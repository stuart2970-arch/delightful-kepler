import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signChatSessionToken } from '../src/lib/chat-session';
import { isAllowedEmbedOrigin } from '../src/lib/voice/embed-origin';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CHATBOT_ID = 'e0000000-0000-0000-0000-000000000002';
const TENANT_ID = '10000000-0000-0000-0000-000000000002';

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function sessionHeaders(sessionId: string) {
  const sessionToken = signChatSessionToken({ chatbotId: CHATBOT_ID, sessionId, expiresInSeconds: 3600 });
  return {
    'Content-Type': 'application/json',
    'x-session-token': sessionToken,
    'x-turnstile-token': '1x0000000000000000000000000000000AA',
    Origin: 'http://localhost:3001',
  };
}

test.describe('Vapi web-call route guards', () => {
  test.beforeAll(async () => {
    await admin.from('chatbots').update({ voice_enabled: true }).eq('id', CHATBOT_ID);
    await admin.from('tenants').update({ domain: null }).eq('id', TENANT_ID);
  });

  test('embed origin helper allows app origin and registered tenant domain', () => {
    const tenantRequest = new Request('https://app.test/api/voice/web-call', {
      headers: { origin: 'https://salon.example.com' },
    });
    expect(isAllowedEmbedOrigin(tenantRequest, 'salon.example.com')).toBe(true);
    expect(isAllowedEmbedOrigin(tenantRequest, 'other.example.com')).toBe(false);
  });

  test('rejects unauthenticated requests before Vapi is called', async ({ request }) => {
    const res = await request.post('/api/voice/web-call', {
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001' },
      data: { chatbotId: CHATBOT_ID, sessionId: 'unauth-web-call-session' },
    });
    expect(res.status()).toBe(401);
  });

  test('rejects a foreign embed origin when the tenant domain is set', async ({ request }) => {
    const { data: before } = await admin.from('tenants').select('domain').eq('id', TENANT_ID).single();
    await admin.from('tenants').update({ domain: 'allowed-embed.example' }).eq('id', TENANT_ID);
    try {
      const sessionId = `embed-block-${Date.now()}`;
      const res = await request.post('/api/voice/web-call', {
        headers: {
          ...sessionHeaders(sessionId),
          Origin: 'https://attacker.example',
        },
        data: { chatbotId: CHATBOT_ID, sessionId, assistant: {} },
      });
      expect(res.status()).toBe(403);
    } finally {
      await admin.from('tenants').update({ domain: before?.domain ?? null }).eq('id', TENANT_ID);
    }
  });

  test('rejects when voice is disabled on the chatbot', async ({ request }) => {
    const { data: before } = await admin.from('chatbots').select('voice_enabled').eq('id', CHATBOT_ID).single();
    await admin.from('chatbots').update({ voice_enabled: false }).eq('id', CHATBOT_ID);
    try {
      const sessionId = `voice-off-${Date.now()}`;
      const res = await request.post('/api/voice/web-call', {
        headers: sessionHeaders(sessionId),
        data: { chatbotId: CHATBOT_ID, sessionId, assistant: {} },
      });
      expect(res.status()).toBe(403);
    } finally {
      await admin.from('chatbots').update({ voice_enabled: before?.voice_enabled ?? true }).eq('id', CHATBOT_ID);
    }
  });

  test('enforces per-IP rate limits', async ({ request }) => {
    const stamp = Date.now();
    const sessionId = `rate-ip-${stamp}`;
    const headers = {
      ...sessionHeaders(sessionId),
      'x-test-web-call-rate-limit-ip': '2',
      'x-test-web-call-rate-limit-bot': '100',
      'x-forwarded-for': `203.0.113.${stamp % 200}`,
      'x-test-mock-vapi-web-call': '1',
    };
    const payload = { chatbotId: CHATBOT_ID, sessionId, assistant: {} };
    const first = await request.post('/api/voice/web-call', { headers, data: payload });
    const second = await request.post('/api/voice/web-call', { headers, data: payload });
    const third = await request.post('/api/voice/web-call', { headers, data: payload });
    expect(first.status()).not.toBe(429);
    expect(second.status()).not.toBe(429);
    expect(third.status()).toBe(429);
  });

  test('creates a call only after session, origin, and voice checks pass', async ({ request }) => {
    const sessionId = `guarded-ok-${Date.now()}`;
    const res = await request.post('/api/voice/web-call', {
      headers: {
        ...sessionHeaders(sessionId),
        'x-test-mock-vapi-web-call': '1',
      },
      data: { chatbotId: CHATBOT_ID, sessionId, assistant: { firstMessage: 'Hello' } },
    });
    const body = await res.json();
    expect(res.status(), JSON.stringify(body)).toBe(200);
    expect(body.id).toMatch(/^mock-web-call-/);
    expect(body.webCallUrl).toContain('vapi.test');
  });
});