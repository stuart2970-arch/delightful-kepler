import { test, expect } from '@playwright/test';

test.describe('Vapi, ElevenLabs & Telephony Integrations', () => {
  const testChatbotId = '0d37a64b-a4e7-462d-834a-22c948bba528'; // Betfred / Ailen Stats chatbot

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
        model: 'gemini-3.5-flash',
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
});
