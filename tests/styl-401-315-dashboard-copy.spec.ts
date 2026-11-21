import { test, expect } from '@playwright/test';
import { createTestNormalUser, TestUserSession } from './test-auth-helper';
import { META_MESSAGING_COMING_SOON_LABEL } from '../src/lib/channels/meta-messaging-status';

test.describe('STYL-401 & STYL-315 — dashboard Meta cards and chat allowance alert', () => {
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

  test('WhatsApp setup tab shows Coming soon without purchase or connect actions', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard?tab=whatsapp');

    await expect(page.getByText('Bolt-on Available')).toHaveCount(0);
    await expect(page.getByText('Subscribe to WhatsApp Bolt-on')).toHaveCount(0);
    await expect(page.getByText('Connect WhatsApp with Meta')).toHaveCount(0);
    await expect(page.getByText('Test / Connect Now')).toHaveCount(0);
    await expect(page.getByText('WhatsApp AI Channel')).toBeVisible();
    await expect(page.getByText(META_MESSAGING_COMING_SOON_LABEL).first()).toBeVisible();
  });

  test('Instagram setup tab shows Coming soon without activation controls', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard?tab=whatsapp');
    await page.getByRole('button', { name: /Instagram Setup/i }).click();

    await expect(page.getByRole('heading', { name: 'Instagram Messaging' })).toBeVisible();
    await expect(page.getByText(META_MESSAGING_COMING_SOON_LABEL).first()).toBeVisible();
    await expect(page.getByText('Save Instagram Settings')).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });

  test('billing monthly bolt-ons show Coming soon for WhatsApp and Instagram without prices', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard?tab=billing');

    const whatsappCard = page
      .getByRole('heading', { name: 'WhatsApp', exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    const instagramCard = page
      .getByRole('heading', { name: 'Instagram', exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');

    await expect(whatsappCard).toContainText(META_MESSAGING_COMING_SOON_LABEL);
    await expect(instagramCard).toContainText(META_MESSAGING_COMING_SOON_LABEL);
    await expect(whatsappCard.getByRole('button', { name: /Get WhatsApp/i })).toHaveCount(0);
    await expect(instagramCard.getByRole('button', { name: /Get Instagram/i })).toHaveCount(0);
    await expect(whatsappCard).not.toContainText('£');
    await expect(instagramCard).not.toContainText('£');
  });
});