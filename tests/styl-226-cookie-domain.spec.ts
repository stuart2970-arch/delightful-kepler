import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSsoCookieDomain } from '../src/lib/env/cookie-domain';

const root = process.cwd();

test.describe('STYL-226: host-only auth cookies on staging', () => {
  test('proxy.ts has a staging host-only cookie branch', () => {
    const src = readFileSync(join(root, 'src/proxy.ts'), 'utf8');
    expect(src).toContain('resolveSsoCookieDomain');
    expect(src).toMatch(/styleflo_sso_token/);
  });

  test('resolveSsoCookieDomain omits Domain on staging', () => {
    expect(
      resolveSsoCookieDomain({
        appEnv: 'staging',
        hostname: 'staging.styleflo.ai',
      }),
    ).toBeUndefined();
    expect(
      resolveSsoCookieDomain({
        hostname: 'staging.styleflo.ai',
        nodeEnv: 'production',
      }),
    ).toBeUndefined();
    expect(
      resolveSsoCookieDomain({
        appEnv: 'production',
        hostname: 'app.styleflo.ai',
        nodeEnv: 'production',
      }),
    ).toBe('.styleflo.ai');
    expect(
      resolveSsoCookieDomain({
        appEnv: 'development',
        hostname: 'localhost',
        nodeEnv: 'development',
      }),
    ).toBe('.styleflo.test');
  });

  test('requests through the local app never set Domain=.styleflo.ai on the SSO cookie', async ({ request }) => {
    const res = await request.get('/login');
    const raw = res.headers()['set-cookie'] || '';
    const cookies = Array.isArray(raw) ? raw : [raw];
    for (const cookie of cookies) {
      if (!cookie.toLowerCase().includes('styleflo_sso_token')) continue;
      expect(cookie).not.toMatch(/domain=\.styleflo\.ai/i);
    }
  });
});
