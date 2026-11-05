import { test, expect } from '@playwright/test';
import { getGeminiApiKey } from '../src/lib/embeddings';

/**
 * STYL-203 follow-up: with feature secrets unset, core helpers must not throw at
 * call time in a way that would crash staging boot / unrelated routes.
 */
test.describe('STYL-203: staging core secrets / graceful degrade', () => {
  test('getGeminiApiKey does not throw when APP_ENV=staging and key is unset', () => {
    const prev = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      APP_ENV: process.env.APP_ENV,
      NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      PLAYWRIGHT_TEST: process.env.PLAYWRIGHT_TEST,
      CI: process.env.CI,
      NODE_ENV: process.env.NODE_ENV,
    };

    try {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      // Force the production-URL path (would throw without the staging soft-degrade).
      process.env.APP_ENV = 'staging';
      process.env.NEXT_PUBLIC_ENV = 'staging';
      process.env.NEXT_PUBLIC_APP_URL = 'https://staging.styleflo.ai';
      delete process.env.PLAYWRIGHT_TEST;
      delete process.env.CI;
      process.env.NODE_ENV = 'production';

      expect(() => getGeminiApiKey()).not.toThrow();
      expect(getGeminiApiKey()).toBe('');
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test('docs/staging.md documents the six core secrets:set + grantaccess commands', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const docs = readFileSync(join(process.cwd(), 'docs/staging.md'), 'utf8');

    for (const name of [
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'GEMINI_API_KEY',
      'CLOUDFLARE_TURNSTILE_SECRET_KEY',
      'CHAT_SESSION_SIGNING_SECRET',
      'TOKEN_ENC_KEY',
    ]) {
      expect(docs).toContain(
        `firebase apphosting:secrets:set ${name} --project styleflo-staging`,
      );
      expect(docs).toContain(
        `firebase apphosting:secrets:grantaccess ${name} --backend delightful-kepler --project styleflo-staging`,
      );
    }

    expect(docs).toContain('Wired feature secrets (STYL-226)');
    expect(docs).toContain('openssl rand -hex 32');
    expect(docs).toContain('STRIPE_WEBHOOK_SECRET');
    expect(docs).toContain('https://staging.styleflo.ai');
    expect(docs).toContain('1x0000000000000000000000000000000AA');
  });
});
