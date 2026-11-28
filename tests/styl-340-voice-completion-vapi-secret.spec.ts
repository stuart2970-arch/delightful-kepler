import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyVapiWebhookSecret } from '../src/lib/env/vapi-webhook-auth';

const root = process.cwd();
const TEST_SECRET = 'styl340-vapi-secret';

test.describe('STYL-340: voice completion routes require Vapi secret', () => {
  test('completion route sources call verifyVapiWebhookSecret', () => {
    const chatbotPath = join(root, 'src/app/api/voice/[chatbotId]/chat/completions/route.ts');
    const legacyPath = join(root, 'src/app/api/voice/chat/completions/route.ts');
    expect(readFileSync(chatbotPath, 'utf8')).toContain('verifyVapiWebhookSecret');
    expect(readFileSync(legacyPath, 'utf8')).toContain('verifyVapiWebhookSecret');
  });

  test('missing X-Vapi-Secret is rejected when secret is configured', () => {
    const result = verifyVapiWebhookSecret(
      new Request('http://localhost/api/voice/x/chat/completions', { method: 'POST' }),
      { VAPI_WEBHOOK_SECRET: TEST_SECRET, APP_ENV: 'staging' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  test('matching X-Vapi-Secret is accepted', () => {
    const result = verifyVapiWebhookSecret(
      new Request('http://localhost/api/voice/x/chat/completions', {
        method: 'POST',
        headers: { 'x-vapi-secret': TEST_SECRET },
      }),
      { VAPI_WEBHOOK_SECRET: TEST_SECRET, APP_ENV: 'staging' },
    );
    expect(result.ok).toBe(true);
  });
});