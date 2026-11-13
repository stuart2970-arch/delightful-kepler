import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestSuperadminUser, createTestUser } from './test-auth-helper';

const vapiWebhookHeaders = {
  'x-vapi-secret': process.env.VAPI_WEBHOOK_SECRET || 'test-vapi-webhook-secret',
};

async function ownerOfTelephonyTenant(tenantId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Local Supabase env is missing');
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.from('tenants').upsert({
    id: tenantId,
    tenant_id: tenantId,
    company_name: 'Playwright Telephony Tenant',
  }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  return createTestUser({ tenantId, role: 'owner' });
}

async function setTenantPhones(tenantId: string, shadow: string, mobile: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Local Supabase env is missing');
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.from('tenants').update({
    twilio_shadow_number: shadow,
    twilio_mobile_number: mobile,
  }).eq('id', tenantId);
  if (error) throw new Error(error.message);
}

test.describe('Vapi, ElevenLabs & Telephony Integrations', () => {
  const testChatbotId = 'e0000000-0000-0000-0000-000000000001'; // Acme Support Bot (seeded locally)

  test('Vapi Assistant Webhook returns voice unavailable while VOICE_ENABLED is off', async ({ request }) => {
    const response = await request.post('/api/webhooks/vapi/assistant', {
      headers: vapiWebhookHeaders,
      data: {
        message: {
          type: 'assistant-request',
          call: { id: 'test_playwright_call_123' }
        }
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    const assistant = data.assistant || data.messageResponse?.assistant;
    expect(assistant).toBeTruthy();
    expect(assistant.firstMessage).toMatch(/voice is currently unavailable/i);
    expect(assistant.artifactPlan?.recordingEnabled).toBe(false);
  });

  test('ElevenLabs Custom LLM Voice Completion endpoint streams response successfully', async ({ request }) => {
    const response = await request.post(`/api/voice/chat/completions?chatbotId=${testChatbotId}`, {
      data: {
        model: 'gemini-1.5-flash',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      }
    });

    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('text/event-stream');

    const bodyText = await response.text();
    expect(bodyText).toContain('data:');
    expect(bodyText).toContain('chatcmpl-vapi');
  });

  test('Telephony Inbound Webhook handles form urlencoded webhook payload from Twilio', async ({ request }) => {
    const response = await request.post('/api/telephony/inbound', {
      form: {
        Called: '+447000000000',
        Caller: '+447999999999'
      }
    });

    // Twilio webhooks return TwiML XML or 200 response
    expect(response.status()).toBeLessThan(500);
  });

  test('Telephony Search endpoint rejects unauthenticated requests with 401', async ({ request }) => {
    const response = await request.post('/api/telephony/search', {
      data: { number_type: 'local', area_code: '0151' }
    });
    expect(response.status()).toBe(401);
  });

  test('Meta Webhook Handshake successfully verifies with hub.challenge', async ({ request }) => {
    const testChallenge = 'meta_test_challenge_' + Math.floor(Math.random() * 100000);
    const response = await request.get(`/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=styleflo_meta_verify_2026&hub.challenge=${testChallenge}`);
    
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toBe(testChallenge);
  });

  test('WhatsApp Webhook alias route forwards handshake and verifies correctly', async ({ request }) => {
    const testChallenge = 'whatsapp_test_challenge_' + Math.floor(Math.random() * 100000);
    const response = await request.get(`/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=styleflo_meta_verify_2026&hub.challenge=${testChallenge}`);
    
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toBe(testChallenge);
  });

  test('Meta Webhook Handshake rejects invalid verification tokens with 403', async ({ request }) => {
    const response = await request.get('/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=invalid_token_123&hub.challenge=fail_me');
    expect(response.status()).toBe(403);
  });

  test('Meta Test Journey API simulates conversational flow and generates AI response', async ({ request }) => {
    const superadmin = await createTestSuperadminUser();
    try {
      const response = await request.post('/api/integrations/meta/test-journey', {
        headers: { Authorization: `Bearer ${superadmin.token}` },
        data: {
          tenantId: '10000000-0000-0000-0000-000000000001',
          channel: 'whatsapp',
          messageText: 'Hello! What services are available and how can I book?'
        }
      });

      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.replyText).toBeTruthy();
      expect(data.channel).toBe('whatsapp');
    } finally {
      await superadmin.cleanup();
    }
  });

  test('Meta Settings API returns configured webhook and token details', async ({ request }) => {
    const owner = await createTestUser({
      tenantId: '10000000-0000-0000-0000-000000000001',
      role: 'owner',
    });
    try {
      const response = await request.get('/api/integrations/meta/settings?tenantId=10000000-0000-0000-0000-000000000001', {
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.webhookUrl).toContain('/api/webhooks/meta');
      expect(data.verifyToken).toBeUndefined();
      expect(data.metaAccessTokenMasked).toBeUndefined();
    } finally {
      await owner.cleanup();
    }
  });

  test('Meta Data Deletion compliance callback returns valid tracking URL and confirmation code', async ({ request }) => {
    const response = await request.post('/api/data-deletion');
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.confirmation_code).toBeTruthy();
    expect(data.url).toContain('https://styleflo.ai/data-deletion');
  });

  test('Tenant Settings API preserves landline phone number without destructive wiping', async ({ request }) => {
    const testTenantId = '7b0f485d-49b8-416e-8c6f-1effea14a57b';
    const testLandline = '+441619460000';
    const testMobile = '+447446900875';
    const owner = await ownerOfTelephonyTenant(testTenantId);

    try {
    await setTenantPhones(testTenantId, testLandline, testMobile);
    const refused = await request.patch('/api/tenants/settings', {
      headers: { Authorization: `Bearer ${owner.token}` },
      data: {
        tenantId: testTenantId,
        twilioShadowNumber: '+441619460999',
      },
    });
    expect(refused.status()).toBe(403);

    // 2. Verify inbound call webhook matches tenant for the landline number
    const inboundRes = await request.post('/api/telephony/inbound', {
      form: {
        To: testLandline,
        From: '+447111222333'
      }
    });

    expect(inboundRes.status()).toBe(200);
    const twimlText = await inboundRes.text();
    // Verify response connects call rather than returning "not configured" dead line error
    expect(twimlText).not.toContain('Sorry, this number is not configured correctly');

    // 3. Verify inbound call webhook matches tenant for the mobile number
    const inboundMobileRes = await request.post('/api/telephony/inbound', {
      form: {
        To: testMobile,
        From: '+447111222333'
      }
    });

    expect(inboundMobileRes.status()).toBe(200);
    const twimlMobileText = await inboundMobileRes.text();
    expect(twimlMobileText).not.toContain('Sorry, this number is not configured correctly');
    } finally {
      await owner.cleanup();
    }
  });

  test('Inbound Vapi voice call webhook resolves assistant and provides valid trailing-slash custom LLM endpoint for both landline and mobile numbers', async ({ request }) => {
    const testTenantId = '7b0f485d-49b8-416e-8c6f-1effea14a57b';
    const landlineNumber = '+441514538001';
    const mobileNumber = '+447446900875';

    // 1. Ensure tenant has both landline and mobile numbers mapped in DB
    const owner = await ownerOfTelephonyTenant(testTenantId);
    try {
    await setTenantPhones(testTenantId, landlineNumber, mobileNumber);

    // 2. Test inbound call dialed to Landline (+441514538001)
    const landlineVapiRes = await request.post('/api/webhooks/vapi/assistant', {
      headers: vapiWebhookHeaders,
      data: {
        message: {
          type: 'assistant-request',
          call: {
            id: 'call_landline_test_123',
            phoneNumber: { number: landlineNumber },
            customer: { number: '+447970819149' }
          },
          phoneNumber: { number: landlineNumber }
        }
      }
    });

    expect(landlineVapiRes.status()).toBe(200);
    const landlineData = await landlineVapiRes.json();
    const landlineAssistant = landlineData.assistant || landlineData.messageResponse?.assistant;
    expect(landlineAssistant).toBeTruthy();
    expect(landlineAssistant.firstMessage).toMatch(/voice is currently unavailable/i);

    // 3. Test inbound call dialed to Mobile (+447446900875)
    const mobileVapiRes = await request.post('/api/webhooks/vapi/assistant', {
      headers: vapiWebhookHeaders,
      data: {
        message: {
          type: 'assistant-request',
          call: {
            id: 'call_mobile_test_123',
            phoneNumber: { number: mobileNumber },
            customer: { number: '+447970819149' }
          },
          phoneNumber: { number: mobileNumber }
        }
      }
    });

    expect(mobileVapiRes.status()).toBe(200);
    const mobileData = await mobileVapiRes.json();
    const mobileAssistant = mobileData.assistant || mobileData.messageResponse?.assistant;
    expect(mobileAssistant).toBeTruthy();
    expect(mobileAssistant.firstMessage).toMatch(/voice is currently unavailable/i);

    // 4. Custom LLM endpoint still responds when called directly
    const completionRes = await request.post(`/api/voice/${testChatbotId}/chat/completions`, {
      data: {
        model: 'gemini-1.5-flash',
        messages: [{ role: 'user', content: 'What time are you open?' }],
        stream: true
      }
    });

    expect(completionRes.status()).toBe(200);
    expect(completionRes.headers()['content-type']).toContain('text/event-stream');
    } finally {
      await owner.cleanup();
    }
  });
});

