import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestNormalUser, TestUserSession } from './test-auth-helper';

const GLOBEX = '10000000-0000-0000-0000-000000000002';
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

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
    await expect(panel(page)).toContainText('Payment received. Your bolt-on will switch on in a moment.');
    await expect(panel(page)).toContainText('knowledge items');
    await expect(panel(page)).not.toContainText(/chunk|vector storage|now active/i);
    await expect(panel(page)).not.toContainText('Google Calendar');
  });

  test('Microsoft Calendar success banner does not say Google Calendar', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard?tab=scheduling&checkout_status=success&addon_id=microsoft_calendar_addon');
    await expect(panel(page)).toContainText('Payment received. Your bolt-on will switch on in a moment.', { timeout: 15000 });
    await expect(panel(page)).toContainText('Microsoft Calendar');
    await expect(panel(page)).not.toContainText('Google Calendar Integration payment successful');
    await expect(panel(page)).not.toContainText(/now active/i);
    await expect(panel(page)).toContainText('Services & Treatment Catalog');
  });

  test('Microsoft Calendar bolt-on row reaches the scheduling flag', async ({ page }) => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', 'microsoft_calendar_addon');
    const { error } = await admin.from('tenant_active_addons').insert({
      tenant_id: GLOBEX,
      addon_catalog_id: 'microsoft_calendar_addon',
      feature_id: 'microsoft_calendar',
      quantity: 1,
      is_active: true,
    });
    expect(error).toBeNull();

    try {
      await signIn(page);
      await page.goto('/dashboard?tab=scheduling');
      const microsoftCard = page.locator('h3', { hasText: 'Microsoft Calendar' }).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
      await expect(microsoftCard).toContainText('Connect Outlook Calendar', { timeout: 15000 });
      await expect(microsoftCard).not.toContainText('Option Inactive');
    } finally {
      await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', 'microsoft_calendar_addon');
    }
  });

  test('Extra Knowledge bolt-on raises the knowledge items total on Subscriptions', async ({ page }) => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', 'data_pack_500');
    const { error } = await admin.from('tenant_active_addons').insert({
      tenant_id: GLOBEX,
      addon_catalog_id: 'data_pack_500',
      feature_id: 'data_chunks_addon',
      quantity: 1,
      is_active: true,
    });
    expect(error).toBeNull();

    try {
      await signIn(page);
      await page.goto('/dashboard?tab=billing');
      await expect(panel(page)).toContainText('Knowledge items', { timeout: 15000 });
      await expect(panel(page)).toContainText('1000 total');
      await expect(panel(page)).not.toContainText('50 total');
      await expect(panel(page).getByRole('button', { name: '+ Add knowledge items' })).toBeVisible();
    } finally {
      await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', 'data_pack_500');
    }
  });

  test('knowledge items total drops after Extra Knowledge bolt-on cancel', async ({ page }) => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', 'data_pack_500');
    const { error } = await admin.from('tenant_active_addons').insert({
      tenant_id: GLOBEX,
      addon_catalog_id: 'data_pack_500',
      feature_id: 'data_chunks_addon',
      quantity: 1,
      is_active: true,
    });
    expect(error).toBeNull();

    try {
      await signIn(page);
      await page.goto('/dashboard?tab=billing');
      await expect(panel(page)).toContainText('1000 total', { timeout: 15000 });

      const { error: cancelError } = await admin
        .from('tenant_active_addons')
        .update({ is_active: false, deactivated_at: new Date().toISOString() })
        .eq('tenant_id', GLOBEX)
        .eq('addon_catalog_id', 'data_pack_500');
      expect(cancelError).toBeNull();

      await page.reload();
      await expect(panel(page)).toContainText('Knowledge items', { timeout: 15000 });
      await expect(panel(page)).toContainText('500 total');
      await expect(panel(page)).not.toContainText('1000 total');
    } finally {
      await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', 'data_pack_500');
    }
  });
});
