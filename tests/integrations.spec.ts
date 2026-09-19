import { test, expect } from '@playwright/test';

test.describe('Vapi, ElevenLabs & Telephony Integrations', () => {
  const testChatbotId = 'e0000000-0000-0000-0000-000000000001'; // Acme Support Bot (seeded locally)

  test('Vapi Assistant Webhook returns valid dynamic assistant with 11labs voice', async ({ request }) => {
    const response = await request.post('/api/webhooks/vapi/assistant', {
      data: {
        message: {
          type: 'assistant-request',
          call: { id: 'test_playwright_call_123' }
        }
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    // Assert Vapi root and messageResponse assistant structures
    const assistant = data.assistant || data.messageResponse?.assistant;
    expect(assistant).toBeTruthy();
    expect(assistant.name).toBeTruthy();
    expect(assistant.firstMessage).toBeTruthy();

    // Assert 11labs voice provider & persona configuration
    expect(assistant.voice).toBeTruthy();
    expect(assistant.voice.provider).toBe('11labs');
    expect(assistant.voice.voiceId).toBeTruthy();

    // Assert custom LLM provider pointing to styleflo voice completion endpoint
    expect(assistant.model).toBeTruthy();
    expect(assistant.model.provider).toBe('custom-llm');
    expect(assistant.model.url).toContain('/api/voice/');
  });

  test('ElevenLabs Custom LLM Voice Completion endpoint streams response successfully', async ({ request }) => {
    const response = await request.post(`/api/voice/${testChatbotId}/chat/completions`, {
      data: {
        model: 'gemini-3.6-flash',
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
    const response = await request.post('/api/integrations/meta/test-journey', {
      data: {
        tenantId: '7b0f485d-49b8-416e-8c6f-1effea14a57b',
        channel: 'whatsapp',
        messageText: 'Hello! What services are available and how can I book?'
      }
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.replyText).toBeTruthy();
    expect(data.channel).toBe('whatsapp');
  });

  test('Meta Settings API returns configured webhook and token details', async ({ request }) => {
    const response = await request.get('/api/integrations/meta/settings?tenantId=7b0f485d-49b8-416e-8c6f-1effea14a57b');
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.webhookUrl).toContain('/api/webhooks/meta');
    expect(data.verifyToken).toBeTruthy();
  });

  test('Meta Data Deletion compliance callback returns valid tracking URL and confirmation code', async ({ request }) => {
    const response = await request.post('/api/data-deletion');
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.confirmation_code).toBeTruthy();
    expect(data.url).toContain('https://styleflo.ai/data-deletion');
  });
});

