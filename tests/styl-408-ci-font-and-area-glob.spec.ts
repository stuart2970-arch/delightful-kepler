import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useDeterministicCiFonts } from '@/lib/fonts/ci-font-mode';

function areasFor(file: string) {
  const result = spawnSync(
    'node',
    ['scripts/ci-playwright-paths.mjs', 'print', file],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PLAYWRIGHT_CI_FORCE_ALL: '',
        BASE_BRANCH: '',
      },
    },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as {
    forceAll: boolean;
    areas: string[];
    uncovered: string[];
  };
}

test.describe('STYL-408 CI fonts and area globs', () => {
  test('a double-star directory pattern selects a file directly under the prefix', () => {
    const direct = areasFor('src/components/ServiceEditor.tsx');
    expect(direct.forceAll).toBe(false);
    expect(direct.uncovered).toEqual([]);
    expect(direct.areas).toContain('booking-calendar');

    const nested = areasFor('src/components/dashboard-views/BillingView.tsx');
    expect(nested.forceAll).toBe(false);
    expect(nested.areas).toEqual(['billing-stripe-entitlements']);

    const billingLib = areasFor('src/lib/billing/bolt-on.ts');
    expect(billingLib.forceAll).toBe(false);
    expect(billingLib.areas).toContain('billing-stripe-entitlements');

    const shared = areasFor('src/lib/fonts/index.ts');
    expect(shared.forceAll).toBe(true);
  });

  test('deterministic fonts turn on for Playwright or CI and stay off for production builds', () => {
    expect(useDeterministicCiFonts({ NODE_ENV: 'development' })).toBe(false);
    expect(useDeterministicCiFonts({ NODE_ENV: 'development', PLAYWRIGHT_TEST: 'true' })).toBe(true);
    expect(useDeterministicCiFonts({ NODE_ENV: 'test', CI: 'true' })).toBe(true);
    expect(useDeterministicCiFonts({ CI: '1' })).toBe(true);
    expect(
      useDeterministicCiFonts({ NODE_ENV: 'production', CI: 'true', PLAYWRIGHT_TEST: 'true' }),
    ).toBe(false);
  });

  test('production font module is unchanged and the CI entry does not import Google fonts', () => {
    const root = process.cwd();
    const production = readFileSync(join(root, 'src/lib/fonts/root-fonts-production.ts'), 'utf8');
    const barrel = readFileSync(join(root, 'src/lib/fonts/index.ts'), 'utf8');
    const ciEntry = readFileSync(join(root, 'src/lib/fonts/ci-font-entry.ts'), 'utf8');
    const nextConfig = readFileSync(join(root, 'next.config.ts'), 'utf8');

    expect(production).toContain("from 'next/font/google'");
    expect(production).toContain("weight: ['400', '500', '600', '700']");
    expect(barrel).toContain("from './root-fonts-production'");
    expect(ciEntry).not.toMatch(/from ['"]next\/font\/google['"]/);
    expect(nextConfig).toContain('useDeterministicCiFonts()');
    expect(nextConfig).toContain('"@/lib/fonts": "./src/lib/fonts/ci-font-entry.ts"');
    expect(nextConfig).toContain(': {},');
  });

  test('the Playwright dev server renders the deterministic font classes', async ({ page }) => {
    await page.goto('/login');
    const className = await page.locator('html').getAttribute('class');
    expect(className).toContain('font-ci-poppins');
    expect(className).toContain('font-ci-inter');
    expect(className).toContain('antialiased');
    expect(className ?? '').not.toMatch(/__Poppins|__Inter|__className/);
  });
});
