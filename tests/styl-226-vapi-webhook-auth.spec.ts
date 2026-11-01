import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POST as vapiPost } from '../src/app/api/webhooks/vapi/route';
import { POST as assistantPost } from '../src/app/api/webhooks/vapi/assistant/route';

const root = process.cwd();
const TEST_SECRET = 'styl226-webhook-secret';

test.describe('STYL-226: Vapi webhook secret and logging', () => {
  test('both webhook routes verify X-Vapi-Secret and do not log full bodies', () => {
    const main = readFileSync(join(root, 'src/app/api/webhooks/vapi/route.ts'), 'utf8');
    const assistant = readFileSync(join(root, 'src/app/api/webhooks/vapi/assistant/route.ts'), 'utf8');
    expect(main).toContain('verifyVapiWebhookSecret');
    expect(assistant).toContain('verifyVapiWebhookSecret');
    expect(assistant).not.toContain('Full incoming body');
    expect(assistant).not.toContain('JSON.stringify(body, null, 2)');
    expect(assistant).not.toContain('Falling back to active client chatbot');
    expect(readFileSync(join(root, 'src/lib/env/vapi-webhook-auth.ts'), 'utf8')).toContain('timingSafeEqual');
  });

  test('POST without the secret is rejected when the secret is set', async () => {
    const previous = process.env.VAPI_WEBHOOK_SECRET;
    const appEnv = process.env.APP_ENV;
    try {
      process.env.VAPI_WEBHOOK_SECRET = TEST_SECRET;
      process.env.APP_ENV = 'staging';
      const payload = JSON.stringify({ message: { type: 'assistant-request', call: { id: 'x' } } });
      const missing = await assistantPost(
        new Request('http://localhost:3001/api/webhooks/vapi/assistant', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload,
        }),
      );
      expect(missing.status).toBe(401);

      const forged = await vapiPost(
        new Request('http://localhost:3001/api/webhooks/vapi', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-vapi-secret': 'wrong' },
          body: JSON.stringify({ message: { type: 'end-of-call-report', call: { id: 'y' } } }),
        }),
      );
      expect(forged.status).toBe(401);
    } finally {
      if (previous === undefined) delete process.env.VAPI_WEBHOOK_SECRET;
      else process.env.VAPI_WEBHOOK_SECRET = previous;
      if (appEnv === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = appEnv;
    }
  });

  test('unset secret is refused outside test', async () => {
    const previous = {
      VAPI_WEBHOOK_SECRET: process.env.VAPI_WEBHOOK_SECRET,
      APP_ENV: process.env.APP_ENV,
      NODE_ENV: process.env.NODE_ENV,
      PLAYWRIGHT_TEST: process.env.PLAYWRIGHT_TEST,
    };
    try {
      delete process.env.VAPI_WEBHOOK_SECRET;
      process.env.APP_ENV = 'staging';
      process.env.NODE_ENV = 'production';
      delete process.env.PLAYWRIGHT_TEST;
      const { verifyVapiWebhookSecret } = await import('../src/lib/env/vapi-webhook-auth');
      const result = verifyVapiWebhookSecret(
        new Request('http://localhost:3001/api/webhooks/vapi', { method: 'POST' }),
        {
          APP_ENV: 'staging',
          NODE_ENV: 'production',
        },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(503);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
