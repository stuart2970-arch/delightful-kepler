import { test, expect } from '@playwright/test';

test.describe('Phase 3: Twilio Auto-Capture Verification Engine & Voice Fallback', () => {
  test('should handle Twilio Voice initial call with speech gather TwiML', async ({ request }) => {
    const params = new URLSearchParams();
    params.append('From', '+16505550100');
    params.append('To', '+447446900875');
    params.append('CallSid', 'CAtest_call_sid_001');

    const res = await request.post('/api/webhooks/twilio/voice', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: params.toString(),
    });

    expect(res.status()).toBe(200);
    const contentType = res.headers()['content-type'];
    expect(contentType).toContain('text/xml');

    const xml = await res.text();
    expect(xml).toContain('<Gather');
    expect(xml).toContain('input="speech"');
    expect(xml).toContain('Please speak the verification code clearly');
  });

  test('should handle Twilio Voice transcription callback with hangup', async ({ request }) => {
    const params = new URLSearchParams();
    params.append('From', '+16505550100');
    params.append('To', '+447446900875');
    params.append('CallSid', 'CAtest_call_sid_002');
    params.append('SpeechResult', 'Your code is 4 9 2 0 1 8');

    const res = await request.post('/api/webhooks/twilio/voice?step=transcribe', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: params.toString(),
    });

    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<Hangup/>');
  });

  test('should route /api/twilio/sms-inbound to the Twilio SMS handler', async ({ request }) => {
    const params = new URLSearchParams();
    params.append('From', '+447970819149');
    params.append('To', '+447446900875');
    params.append('Body', 'Hello there');

    const res = await request.post('/api/twilio/sms-inbound', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: params.toString(),
    });

    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<Response>');
  });

  test('should reject unauthorized access to /api/whatsapp/verification-code without session', async ({ request }) => {
    const res = await request.get('/api/whatsapp/verification-code');
    expect(res.status()).toBe(401);
  });
});
