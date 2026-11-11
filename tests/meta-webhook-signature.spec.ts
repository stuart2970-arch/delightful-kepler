import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { GET, POST } from '../src/app/api/webhooks/meta/route';
import { validateMetaSignature } from '../src/lib/meta';

const TEST_SECRET = 'test_meta_app_secret_123';
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'styleflo_meta_verify_2026';

function sign(rawBody: string, secret: string): string {
  const hex = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return `sha256=${hex}`;
}

function statusesPayload(): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'test_waba_signature',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+447446900875',
                phone_number_id: 'test_phone_id_signature',
              },
              statuses: [
                {
                  id: 'wamid.signature_status_001',
                  status: 'delivered',
                  timestamp: '1728900000',
                  recipient_id: '447970819149',
                  pricing: { billable: true, category: 'service' },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

async function withMetaSecret<T>(
  value: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const previous = process.env.META_APP_SECRET;
  try {
    if (value === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = value;
    return await run();
  } finally {
    if (previous === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previous;
  }
}

function postWebhook(rawBody: string, signature?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== undefined) headers['x-hub-signature-256'] = signature;
  return POST(
    new NextRequest('http://localhost:3001/api/webhooks/meta', {
      method: 'POST',
      headers,
      body: rawBody,
    }),
  );
}

test.describe('Meta webhook X-Hub-Signature-256', () => {
  test('GET verify-token handshake still succeeds without a signature', async () => {
    const challenge = 'challenge_signature_guard_441';
    const res = await GET(
      new NextRequest(
        `http://localhost:3001/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(VERIFY_TOKEN)}&hub.challenge=${encodeURIComponent(challenge)}`,
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(challenge);
  });

  test('POST without X-Hub-Signature-256 returns 401 and does not process', async () => {
    const rawBody = JSON.stringify({ entry: [] });
    await withMetaSecret(TEST_SECRET, async () => {
      const res = await postWebhook(rawBody);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Invalid webhook signature');
      expect(data.processed).toBeUndefined();
      expect(data.success).toBeUndefined();
    });
  });

  test('POST with a bad signature returns 401', async () => {
    const rawBody = JSON.stringify({ entry: [] });
    await withMetaSecret(TEST_SECRET, async () => {
      const res = await postWebhook(rawBody, 'sha256=' + '00'.repeat(32));
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Invalid webhook signature');
    });
  });

  test('blank or whitespace META_APP_SECRET rejects the webhook and processes nothing', async () => {
    const rawBody = statusesPayload();
    const notJson = '{not-json';
    const blanks = ['', '   ', '\t\n  '];

    for (const blank of blanks) {
      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args.map((part) => String(part)).join(' '));
      };
      try {
        await withMetaSecret(blank, async () => {
          expect(validateMetaSignature(rawBody, sign(rawBody, blank), blank)).toBe(false);
          expect(validateMetaSignature(rawBody, sign(rawBody, TEST_SECRET), blank)).toBe(false);

          const signedAsBlank = await postWebhook(notJson, sign(notJson, blank || TEST_SECRET));
          expect([401, 500]).toContain(signedAsBlank.status);
          expect(signedAsBlank.status).not.toBe(400);
          const signedText = await signedAsBlank.text();
          expect(signedText).not.toContain('statuses_processed');
          expect(signedText).not.toContain('"processed":true');
          expect(signedText).not.toContain('"success":true');

          const wouldHaveProcessed = await postWebhook(rawBody, sign(rawBody, blank || TEST_SECRET));
          expect([401, 500]).toContain(wouldHaveProcessed.status);
          const processedText = await wouldHaveProcessed.text();
          expect(processedText).not.toContain('statuses_processed');
          expect(processedText).not.toContain('"processed":true');
          expect(processedText).not.toContain('"success":true');
        });
        expect(errors.some((line) => /META_APP_SECRET/i.test(line))).toBe(true);
      } finally {
        console.error = originalError;
      }
    }

    await withMetaSecret(undefined, async () => {
      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args.map((part) => String(part)).join(' '));
      };
      try {
        expect(validateMetaSignature(rawBody, sign(rawBody, TEST_SECRET))).toBe(false);
        const res = await postWebhook(rawBody, sign(rawBody, TEST_SECRET));
        expect([401, 500]).toContain(res.status);
        const text = await res.text();
        expect(text).not.toContain('statuses_processed');
        expect(text).not.toContain('"processed":true');
        expect(errors.some((line) => /META_APP_SECRET/i.test(line))).toBe(true);
      } finally {
        console.error = originalError;
      }
    });
  });

  test('a valid signature over the raw body still processes the webhook', async () => {
    const rawBody = statusesPayload();
    await withMetaSecret(TEST_SECRET, async () => {
      expect(validateMetaSignature(rawBody, sign(rawBody, TEST_SECRET), TEST_SECRET)).toBe(true);
      const res = await postWebhook(rawBody, sign(rawBody, TEST_SECRET));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('statuses_processed');
    });
  });

  test('HMAC uses the trimmed secret', async () => {
    const rawBody = '{"entry":[]}';
    const padded = `  ${TEST_SECRET}\n`;
    expect(validateMetaSignature(rawBody, sign(rawBody, TEST_SECRET), padded)).toBe(true);
    expect(validateMetaSignature(rawBody, sign(rawBody, padded), padded)).toBe(false);
  });

  test('HTTP POST without X-Hub-Signature-256 returns 401', async ({ request }) => {
    const res = await request.post('/api/webhooks/meta', {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ entry: [] }),
    });
    expect(res.status()).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('Invalid webhook signature');
    expect(data.processed).toBeUndefined();
  });
});
