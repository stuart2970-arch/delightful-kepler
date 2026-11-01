import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestNormalUser, TestUserSession } from './test-auth-helper';
import {
  getPublicAppOrigin,
  publicAppPath,
  resolveServerPublicAppOrigin,
  safePublicReturnUrl,
} from '../src/lib/env/public-app-url';

const root = process.cwd();
const PROD_HOST = 'app.styleflo.ai';

function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test.describe('STYL-226: public app origin helper', () => {
  const sourceFiles = [
    'src/app/login/page.tsx',
    'src/app/register/page.tsx',
    'src/app/onboard/page.tsx',
    'src/app/api/auth/magic-link/route.ts',
    'src/app/api/billing/checkout/route.ts',
    'src/components/AddOnUpsellModal.tsx',
    'src/components/DashboardClient.tsx',
    'src/app/dashboard/billing/page.tsx',
    'src/proxy.ts',
    'src/app/api/integrations/google/authorize/route.ts',
    'src/app/api/integrations/google/callback/route.ts',
    'src/app/api/integrations/microsoft/authorize/route.ts',
    'src/app/api/integrations/microsoft/callback/route.ts',
  ];

  test('login embedded top navigation falls back to location.assign', () => {
    const src = codeWithoutComments(readFileSync(join(root, 'src/app/login/page.tsx'), 'utf8'));
    expect(src).toMatch(/try\s*\{/);
    expect(src).toContain("window.location.assign('/dashboard')");
    expect(src).toMatch(/catch/);
  });

  test('AddOnUpsellModal only sends customPricePence for sliding add-ons', () => {
    const src = codeWithoutComments(readFileSync(join(root, 'src/components/AddOnUpsellModal.tsx'), 'utf8'));
    expect(src).toMatch(/if\s*\(\s*!addon\.is_sliding\s*\)/);
    expect(src).toContain('handleSubscribe(addon.id)');
  });

  test('redirect and success_url builders do not hard-code the production host', () => {
    for (const rel of sourceFiles) {
      const src = codeWithoutComments(readFileSync(join(root, rel), 'utf8'));
      expect(src, rel).toContain('publicAppPath');
      expect(src, rel).not.toContain(PROD_HOST);
    }
    const helper = readFileSync(join(root, 'src/lib/env/public-app-url.ts'), 'utf8');
    expect(helper).toContain('getPublicAppOrigin');
    expect(helper).toContain('staging');
  });

  test('helper never falls back to production on staging', () => {
    expect(
      resolveServerPublicAppOrigin({
        APP_ENV: 'staging',
        NEXT_PUBLIC_APP_URL: 'https://staging.styleflo.ai',
      }),
    ).toBe('https://staging.styleflo.ai');

    expect(
      resolveServerPublicAppOrigin({
        APP_ENV: 'staging',
        NEXT_PUBLIC_ENV: 'staging',
      }),
    ).toBe('https://staging.styleflo.ai');

    expect(
      resolveServerPublicAppOrigin({
        NODE_ENV: 'production',
      }),
    ).toBe('https://app.styleflo.ai');

    expect(publicAppPath('/login', { NEXT_PUBLIC_APP_URL: 'https://staging.styleflo.ai' })).toBe(
      'https://staging.styleflo.ai/login',
    );
    expect(publicAppPath('/dashboard', { NEXT_PUBLIC_APP_URL: 'https://staging.styleflo.ai' })).toBe(
      'https://staging.styleflo.ai/dashboard',
    );
    expect(publicAppPath('/dashboard?tab=billing', { NODE_ENV: 'production' })).toBe(
      'https://app.styleflo.ai/dashboard?tab=billing',
    );
    expect(getPublicAppOrigin({ NEXT_PUBLIC_APP_URL: 'https://staging.styleflo.ai/' })).toBe(
      'https://staging.styleflo.ai',
    );
  });

  test('checkout success_url follows staging versus production public app config', () => {
    expect(publicAppPath('/dashboard?tab=scheduling', { NEXT_PUBLIC_APP_URL: 'https://staging.styleflo.ai' })).toBe(
      'https://staging.styleflo.ai/dashboard?tab=scheduling',
    );
    expect(publicAppPath('/payment-confirmed', { NEXT_PUBLIC_APP_URL: 'https://app.styleflo.ai' })).toBe(
      'https://app.styleflo.ai/payment-confirmed',
    );
    expect(publicAppPath('/register', { NODE_ENV: 'production' })).toBe('https://app.styleflo.ai/register');
    const checkoutSrc = codeWithoutComments(readFileSync(join(root, 'src/app/api/billing/checkout/route.ts'), 'utf8'));
    expect(checkoutSrc).toContain("publicAppPath('/dashboard");
    expect(checkoutSrc).toContain("publicAppPath('/register')");
    expect(checkoutSrc).not.toContain("publicAppPath('/app')");
    expect(checkoutSrc).not.toContain("publicAppPath('/#pricing')");
  });

  test('safePublicReturnUrl only accepts same-origin URLs and returns URL.href', () => {
    const env = { NEXT_PUBLIC_APP_URL: 'https://staging.styleflo.ai' };
    const fallback = publicAppPath('/dashboard?tab=billing', env);
    expect(safePublicReturnUrl('https://staging.styleflo.ai/dashboard?tab=billing', fallback, env)).toBe(
      'https://staging.styleflo.ai/dashboard?tab=billing',
    );
    expect(
      safePublicReturnUrl('  https://staging.styleflo.ai/dashboard?tab=scheduling  ', fallback, env),
    ).toBe('https://staging.styleflo.ai/dashboard?tab=scheduling');
    expect(safePublicReturnUrl('https://styleflo.ai/app', fallback, env)).toBe(fallback);
    expect(safePublicReturnUrl('https://evil.example/phish', fallback, env)).toBe(fallback);
    expect(safePublicReturnUrl('javascript:alert(1)', fallback, env)).toBe(fallback);
    expect(safePublicReturnUrl('/dashboard?tab=billing', fallback, env)).toBe(fallback);
    expect(safePublicReturnUrl('//evil.example/phish', fallback, env)).toBe(fallback);
    expect(safePublicReturnUrl('https://staging.styleflo.ai.evil.example/dashboard', fallback, env)).toBe(fallback);
    expect(safePublicReturnUrl('', fallback, env)).toBe(fallback);
    expect(safePublicReturnUrl('https://evil.example@staging.styleflo.ai/dashboard', fallback, env)).toBe(fallback);
    expect(safePublicReturnUrl('https://user:pass@staging.styleflo.ai/dashboard', fallback, env)).toBe(fallback);
    expect(safePublicReturnUrl('https://staging.styleflo.ai\\@evil.example', fallback, env)).toBe(fallback);
    expect(safePublicReturnUrl('https://evil.example\\@staging.styleflo.ai/dashboard', fallback, env)).toBe(fallback);
  });

  test('Google sign-in on /login does not send users to the production app host', async ({ page }) => {
    let captured = '';
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/v1/authorize') || url.includes('accounts.google.com')) {
        captured = url;
        await route.abort();
        return;
      }
      await route.continue();
    });

    await page.goto('/login');
    await page.getByRole('button', { name: /Google/i }).first().click();
    await page.waitForTimeout(1500);

    if (captured) {
      expect(captured).not.toContain(PROD_HOST);
    } else {
      const loginSrc = codeWithoutComments(readFileSync(join(root, 'src/app/login/page.tsx'), 'utf8'));
      expect(loginSrc).not.toContain(PROD_HOST);
      expect(loginSrc).toContain('publicAppPath');
    }
  });

  test('signed-in /login redirects to /dashboard, not /app', async ({ page, request }) => {
    let session: TestUserSession | undefined;
    try {
      session = await createTestNormalUser();
      await page.goto('/login');
      await page.locator('input[type="email"]').fill(session.user.email);
      await page.locator('input[type="password"]').fill('Password123!');
      await page.locator('form button[type="submit"]').click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

      await page.goto('/login');
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
      expect(page.url()).not.toContain('/app');

      const missing = await request.get('/app');
      expect(missing.status()).toBe(404);
    } finally {
      if (session) await session.cleanup();
    }
  });
});
