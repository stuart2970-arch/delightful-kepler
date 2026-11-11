import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * STYL-249: Billing shows Cancels [date], and Adjust opens the portal.
 * Local Supabase and the test server only. Checkout is intercepted.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ACME = '10000000-0000-0000-0000-000000000001';
const CANCEL_AT = '2026-12-09T21:41:13Z';

test.describe('STYL-249 billing pending cancel', () => {
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

  async function signIn(page: import('@playwright/test').Page) {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill('admin@acme.com');
    await page.locator('input[type="password"]').fill('password123');
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  }

  test('Already included stays, Cancels 9 Dec 2026 shows, and Adjust opens the portal', async ({ page }) => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', ACME).eq('addon_catalog_id', 'google_calendar_addon');
    const { error } = await admin.from('tenant_active_addons').insert({
      tenant_id: ACME,
      addon_catalog_id: 'google_calendar_addon',
      feature_id: 'google_calendar',
      quantity: 1,
      is_active: true,
      price_paid_pence: 499,
      cancel_at_period_end: true,
      cancel_at: CANCEL_AT,
    });
    expect(error).toBeNull();

    await signIn(page);
    await page.goto('/dashboard?tab=billing');

    const card = page.getByRole('heading', { name: 'Google Calendar Integration' })
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    await expect(card.getByRole('button', { name: 'Already included' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Active bolt-ons' })).toBeVisible();
    await expect(page.getByText('Cancels 9 Dec 2026')).toBeVisible();
    await expect(page.getByRole('button', { name: /cancel this bolt-on/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^cancel$/i })).toHaveCount(0);

    const posts: Array<Record<string, unknown>> = [];
    await page.route('**/api/billing/checkout', async (route) => {
      posts.push(route.request().postDataJSON());
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'portal_not_configured' }),
      });
    });

    await page.getByRole('button', { name: 'Adjust' }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].action).toBe('portal');
    expect(String(posts[0].returnUrl || '')).toContain('tab=billing');
    await expect(page.getByRole('button', { name: 'Subscribe' })).toHaveCount(0);
    await expect(page.getByText(/Subscribe at £/)).toHaveCount(0);
    await expect(page.getByText('portal_not_configured')).toBeVisible();

    await admin.from('tenant_active_addons').update({
      cancel_at_period_end: null,
      cancel_at: null,
    }).eq('tenant_id', ACME).eq('addon_catalog_id', 'google_calendar_addon');

    await page.goto('/dashboard?tab=billing');
    await expect(card.getByRole('button', { name: 'Already included' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Cancels 9 Dec 2026')).toHaveCount(0);

    await page.getByRole('button', { name: 'Adjust' }).click();
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1].action).toBe('portal');
    await expect(page.getByRole('button', { name: 'Subscribe' })).toHaveCount(0);
    await expect(page.getByText(/Subscribe at £/)).toHaveCount(0);
  });
});
