import { test, expect } from '@playwright/test';
import { createTestNormalUser, TestUserSession } from './test-auth-helper';
import { META_MESSAGING_COMING_SOON_LABEL } from '../src/lib/channels/meta-messaging-status';

function panel(page: import('@playwright/test').Page) {
  return page.locator('main.flex-1');
}

test.describe('STYL-219 — Meta channel labels', () => {
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

  test('WhatsApp & Meta page shows Coming soon for WhatsApp, Instagram, and Messenger', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard?tab=whatsapp');

    const whatsappRow = page.getByText('💬 WhatsApp', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    const instagramRow = page.getByText('📸 Instagram', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    const messengerRow = page.getByText('⚡ Messenger', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');

    await expect(whatsappRow).toContainText(META_MESSAGING_COMING_SOON_LABEL, { timeout: 15000 });
    await expect(instagramRow).toContainText(META_MESSAGING_COMING_SOON_LABEL);
    await expect(messengerRow).toContainText(META_MESSAGING_COMING_SOON_LABEL);

    await expect(whatsappRow).not.toContainText('Available');
    await expect(instagramRow).not.toContainText('Available');
    await expect(messengerRow).not.toContainText('Available');
  });

  test('Web Chat & Voice page uses the same Coming soon labels for Meta channels', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard?tab=conversations');

    await expect(panel(page)).toContainText(META_MESSAGING_COMING_SOON_LABEL.toLowerCase(), { timeout: 15000 });
    await expect(panel(page).getByRole('option', { name: `Instagram (${META_MESSAGING_COMING_SOON_LABEL})` })).toBeAttached();
    await expect(panel(page).getByRole('option', { name: `WhatsApp (${META_MESSAGING_COMING_SOON_LABEL})` })).toBeAttached();
    await expect(panel(page)).not.toContainText('Instagram (Available)');
    await expect(panel(page)).not.toContainText('WhatsApp (Available)');
  });
});