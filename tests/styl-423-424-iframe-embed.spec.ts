import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestNormalUser, TestUserSession } from './test-auth-helper';

const root = process.cwd();

test.describe('STYL-423 iframe embed guards', () => {
  test('source files do not assign window.top.location for dashboard escape paths', () => {
    const files = [
      'src/app/login/page.tsx',
      'src/app/register/page.tsx',
      'src/app/onboard/page.tsx',
      'src/components/AddOnUpsellModal.tsx',
      'src/components/DashboardClient.tsx',
      'src/components/dashboard-views/BillingView.tsx',
    ];
    for (const rel of files) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).not.toMatch(/window\.top\.location/);
    }
  });

  test('host page top location stays stable when iframe completes login', async ({ page }) => {
    let session: TestUserSession | undefined;
    try {
      session = await createTestNormalUser();
      await page.goto('/playwright-embed-host.html');
      const frame = page.frameLocator('#sf');
      await frame.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 20000 });
      await frame.locator('input[type="email"]').fill(session.user.email);
      await frame.locator('input[type="password"]').fill('Password123!');
      await frame.locator('form button[type="submit"]').click();
      await expect
        .poll(
          async () => {
            return await page.locator('#sf').evaluate((el: HTMLIFrameElement) => {
              try {
                return el.contentWindow?.location.pathname || '';
              } catch {
                return '';
              }
            });
          },
          { timeout: 25000 },
        )
        .toMatch(/\/dashboard/);
      const topNav = await page.evaluate(() => (window as any).__topNav || []);
      expect(topNav.length).toBe(0);
    } finally {
      await session?.cleanup();
    }
  });

  test('stale checkout auth surfaces session-expired helper instead of raw Authentication required', () => {
    const modal = readFileSync(join(root, 'src/components/AddOnUpsellModal.tsx'), 'utf8');
    const helper = readFileSync(join(root, 'src/lib/navigation/billing-checkout.ts'), 'utf8');
    expect(modal).toContain('openBillingCheckoutFromApi');
    expect(helper).toContain('DASHBOARD_SESSION_EXPIRED_MESSAGE');
    expect(helper).not.toContain('Authentication required');
  });
});