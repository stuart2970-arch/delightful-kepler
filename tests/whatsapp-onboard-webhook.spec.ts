import { test, expect } from '@playwright/test';
import crypto from 'crypto';

test.describe('Phase 2: WhatsApp Embedded Signup (v4) Onboarding & Webhooks', () => {
  const secret = process.env.META_APP_SECRET || 'test_meta_app_secret_123';
  const verifyToken = process.env.META_VERIFY_TOKEN || 'styleflo_meta_verify_2026';

  test('should verify Meta webhook handshake (GET) with valid token', async ({ request }) => {
    const challenge = 'challenge_test_code_99182';
    const res = await request.get(`/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=${challenge}`);

    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toBe(challenge);
  });

  test('should reject Meta webhook handshake (GET) with invalid token', async ({ request }) => {
    const res = await request.get('/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=test');
    expect(res.status()).toBe(403);
  });

  test('should reject Meta webhook POST if HMAC-SHA256 signature is invalid', async ({ request }) => {
    const payload = JSON.stringify({ entry: [] });
    const invalidSignature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';

    const res = await request.post('/api/webhooks/meta', {
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': invalidSignature,
      },
      data: payload,
    });

    expect(res.status()).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('Invalid webhook signature');
  });

  test('should accept Meta webhook POST with valid HMAC-SHA256 signature', async ({ request }) => {
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'test_waba_123',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+447446900875',
                  phone_number_id: 'test_phone_id_999',
                },
                statuses: [
                  {
                    id: 'wamid.HBgLtest_status_msg_001',
                    status: 'delivered',
                    timestamp: '1728900000',
                    recipient_id: '447970819149',
                    pricing: {
                      billable: true,
                      category: 'service',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const signature = crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');

    const res = await request.post('/api/webhooks/meta', {
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      data: payload,
    });

    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('statuses_processed');
  });

  test('should handle inbound STOP opt-out keyword without error', async ({ request }) => {
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'test_waba_123',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+447446900875',
                  phone_number_id: 'test_phone_id_999',
                },
                contacts: [{ profile: { name: 'Sarah Jenkins' }, wa_id: '447970819149' }],
                messages: [
                  {
                    from: '447970819149',
                    id: 'wamid.HBgLtest_stop_msg_001',
                    timestamp: '1728900000',
                    text: { body: 'STOP' },
                    type: 'text',
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const signature = crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');

    const res = await request.post('/api/webhooks/meta', {
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      data: payload,
    });

    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test('should reject unauthorized calls to /api/whatsapp/onboard without session', async ({ request }) => {
    const res = await request.post('/api/whatsapp/onboard', {
      data: {
        code: 'mock_auth_code',
        waba_id: '12345',
        phone_number_id: '67890',
      },
    });

    expect(res.status()).toBe(401);
  });
});
