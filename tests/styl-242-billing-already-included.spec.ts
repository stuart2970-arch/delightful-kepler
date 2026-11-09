import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * STYL-242: the dashboard Billing tab reads tenant_active_addons with the
 * user session. A paid Google Calendar bolt-on shows Already included.
 * Local Supabase and the test server only.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ACME = '10000000-0000-0000-0000-000000000001';

test.describe('STYL-242 billing tab shows a paid bolt-on', () => {
  test.skip(!serviceKey, 'Requires the local Supabase service role key');

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  test.afterAll(async () => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', ACME).eq('addon_catalog_id', 'google_calendar_addon');
    await admin.from('tenant_active_addons').insert({
      tenant_id: ACME,
      addon_catalog_id: 'google_calendar_addon',
      is_active: true,
    });
  });

  test('Already included with a purchase row, and the Get button without one', async ({ page }) => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', ACME).eq('addon_catalog_id', 'google_calendar_addon');
    const { error } = await admin.from('tenant_active_addons').insert({
      tenant_id: ACME,
      addon_catalog_id: 'google_calendar_addon',
      feature_id: 'google_calendar',
      quantity: 1,
      is_active: true,
      price_paid_pence: 499,
    });
    expect(error).toBeNull();

    await page.goto('/login');
    await page.locator('input[type="email"]').fill('admin@acme.com');
    await page.locator('input[type="password"]').fill('password123');
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
    await page.goto('/dashboard?tab=billing');

    const card = page.getByRole('heading', { name: 'Google Calendar Integration' })
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    await expect(card.getByRole('button', { name: 'Already included' })).toBeVisible({ timeout: 20000 });
    await expect(card.getByRole('button', { name: /Get Google Calendar Bolt-on/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Active bolt-ons' })).toBeVisible();
    await expect(page.getByText('Google Calendar Integration').first()).toBeVisible();

    await admin.from('tenant_active_addons').delete().eq('tenant_id', ACME).eq('addon_catalog_id', 'google_calendar_addon');
    await page.goto('/dashboard?tab=billing');
    const emptyCard = page.getByRole('heading', { name: 'Google Calendar Integration' })
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    await expect(emptyCard.getByRole('button', { name: /Get Google Calendar Bolt-on/ })).toBeVisible({ timeout: 20000 });
    await expect(emptyCard.getByRole('button', { name: 'Already included' })).toHaveCount(0);
  });
});
