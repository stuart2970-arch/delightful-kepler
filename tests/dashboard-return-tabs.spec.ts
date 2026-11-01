import { test, expect } from '@playwright/test';
import { createTestNormalUser, TestUserSession } from './test-auth-helper';

const DASHBOARD_TABS = [
  { tab: 'billing', heading: /Current plan =|Billing Receipts & Invoices/ },
  { tab: 'scheduling', heading: /Services & Treatment Catalog/ },
  { tab: 'crawler', heading: /Add Knowledge to Chatbot/ },
  { tab: 'telephony', heading: /Phone Calls & AI Receptionist|Phone Channel Required/ },
] as const;

function panel(page: import('@playwright/test').Page) {
  return page.locator('main.flex-1');
}

test.describe('Dashboard return tabs after checkout', () => {
  let session: TestUserSession;

  test.beforeAll(async () => {
    session = await createTestNormalUser();
  });

  test.afterAll(async () => {
    if (session) await session.cleanup();
  });

  async function signIn(page: import('@playwright/test').Page) {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(session.user.email);
    await page.locator('input[type="password"]').fill('Password123!');
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  }

  for (const { tab, heading } of DASHBOARD_TABS) {
    test(`signed-in /dashboard?tab=${tab} renders the ${tab} panel`, async ({ page }) => {
      await signIn(page);
      await page.goto(`/dashboard?tab=${tab}`);
      await expect(page).toHaveURL(new RegExp(`/dashboard\\?tab=${tab}`));
      await expect(panel(page)).toContainText(heading, { timeout: 15000 });
    });
  }

  test('Extra Knowledge success return opens the Knowledge Base tab, not a blank panel', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard?tab=knowledge&checkout_status=success&addon=data_pack_500');
    await expect(panel(page)).toContainText('Add Knowledge to Chatbot', { timeout: 15000 });
    await expect(panel(page)).toContainText('Knowledge Base Capacity');
    await expect(panel(page)).not.toContainText('Google Calendar Integration payment successful');
  });

  test('Microsoft Calendar success banner does not say Google Calendar', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard?tab=scheduling&checkout_status=success&addon=microsoft_calendar_addon');
    await expect(panel(page)).toContainText('Microsoft Calendar Integration payment successful', { timeout: 15000 });
    await expect(panel(page)).not.toContainText('Google Calendar Integration payment successful');
    await expect(panel(page)).toContainText('Services & Treatment Catalog');
  });
});
