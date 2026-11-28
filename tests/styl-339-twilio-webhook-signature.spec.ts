import { test, expect } from '@playwright/test';
import twilio from 'twilio';
import {
  extractTwilioWebhookParams,
  publicTwilioWebhookUrl,
  verifyTwilioWebhookRequest,
} from '../src/lib/env/twilio-webhook-auth';

const AUTH = 'twilio-test-auth-token-styl339';

test.describe('STYL-339: Twilio webhook signature', () => {
  test('publicTwilioWebhookUrl uses forwarded host and proto', () => {
    const request = new Request('http://internal:3001/api/webhooks/twilio/sms?foo=1', {
      method: 'POST',
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'staging.styleflo.ai',
      },
    });
    expect(publicTwilioWebhookUrl(request)).toBe(
      'https://staging.styleflo.ai/api/webhooks/twilio/sms?foo=1',
    );
  });

  test('forged signature is rejected outside Playwright', async () => {
    const params = new URLSearchParams({ From: '+15550001111', Body: 'hi' });
    const request = new Request('http://localhost:3001/api/webhooks/twilio/sms', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'forged',
      },
      body: params.toString(),
    });
    const result = await verifyTwilioWebhookRequest(request, {
      TWILIO_AUTH_TOKEN: AUTH,
      APP_ENV: 'staging',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  test('valid signature passes with parameter map from body', async () => {
    const fields = { From: '+15550001111', To: '+15550002222', Body: 'hello' };
    const url = 'https://staging.styleflo.ai/api/webhooks/twilio/sms';
    const signature = twilio.getExpectedTwilioSignature(AUTH, url, fields);
    const request = new Request('http://internal/api/webhooks/twilio/sms', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': signature,
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'staging.styleflo.ai',
      },
      body: new URLSearchParams(fields).toString(),
    });
    const extracted = await extractTwilioWebhookParams(request.clone());
    expect(extracted.Body).toBe('hello');
    const result = await verifyTwilioWebhookRequest(request, {
      TWILIO_AUTH_TOKEN: AUTH,
      APP_ENV: 'staging',
    });
    expect(result.ok).toBe(true);
  });

  test('PLAYWRIGHT_TEST bypasses validation', async () => {
    const request = new Request('http://localhost/api/webhooks/twilio/sms', { method: 'POST' });
    const result = await verifyTwilioWebhookRequest(request, { PLAYWRIGHT_TEST: 'true' });
    expect(result.ok).toBe(true);
  });
});