import { test, expect } from '@playwright/test';

test.describe('Native Twilio 2-Way SMS Integration', () => {
  test('should parse Twilio form-encoded payload and return valid TwiML XML', async ({ request }) => {
    const params = new URLSearchParams();
    params.append('From', '+447970819149');
    params.append('To', '+447446900875');
    params.append('Body', 'Hello, what are your business hours?');
    params.append('MessageSid', 'SMtest_twiml_xml_response_sid');

    const response = await request.post('/api/webhooks/twilio/sms', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: params.toString(),
    });

    expect(response.status()).toBe(200);
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('text/xml');

    const xmlBody = await response.text();
    expect(xmlBody).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xmlBody).toContain('<Response>');
    expect(xmlBody).toContain('<Message>');
    expect(xmlBody).toContain('</Message>');
    expect(xmlBody).toContain('</Response>');
  });

  test('should handle missing body gracefully with a fallback TwiML message', async ({ request }) => {
    const params = new URLSearchParams();
    params.append('From', '+447970819149');

    const response = await request.post('/api/webhooks/twilio/sms', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: params.toString(),
    });

    expect(response.status()).toBe(200);
    const xmlBody = await response.text();
    expect(xmlBody).toContain('Please send a valid text message');
  });
});
