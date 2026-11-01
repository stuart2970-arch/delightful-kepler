import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    expect(getPublicAppOrigin({ NEXT_PUBLIC_APP_URL: 'https://staging.styleflo.ai/' })).toBe(
      'https://staging.styleflo.ai',
    );
  });

  test('safePublicReturnUrl only accepts same-origin URLs', () => {
    const env = { NEXT_PUBLIC_APP_URL: 'https://staging.styleflo.ai' };
    const fallback = publicAppPath('/app', env);
    expect(safePublicReturnUrl('https://staging.styleflo.ai/app?tab=billing', fallback, env)).toBe(
      'https://staging.styleflo.ai/app?tab=billing',
    );
    expect(safePublicReturnUrl('https://styleflo.ai/app', fallback, env)).toBe(fallback);
    expect(safePublicReturnUrl('https://evil.example/phish', fallback, env)).toBe(fallback);
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
});
