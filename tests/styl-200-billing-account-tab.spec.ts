import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestNormalUser, TestUserSession } from './test-auth-helper';
import { REMOVE_STYLEFLO_BRANDING_ADDON_ID } from '../src/lib/billing/branding';
import { formatPounds } from '../src/lib/billing/account-ownership';

/**
 * STYL-200 / STYL-194 / STYL-196 / STYL-193
 * In-app Subscriptions & Bolt-ons tab (SSR ownership) and GET /api/billing/account.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GLOBEX = '10000000-0000-0000-0000-000000000002';

async function loginWithPassword(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
}

test.describe('STYL-200 billing account tab (STYL-194/196 + STYL-193)', () => {
  let user: TestUserSession;
  let email = '';
  const password = 'Password123!';
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  test.beforeAll(async () => {
    user = await createTestNormalUser(GLOBEX);
    email = user.user.email as string;
    // Reset password for UI login, then mint a fresh token (password change invalidates the old one).
    await admin.auth.admin.updateUserById(user.user.id, { password, email_confirm: true });
    const anon = createClient(
      supabaseUrl,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: login, error: loginErr } = await anon.auth.signInWithPassword({ email, password });
    if (loginErr || !login.session) {
      throw new Error(`Failed to refresh test user token: ${loginErr?.message}`);
    }
    user.token = login.session.access_token;
  });

  test.afterAll(async () => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', 'google_calendar_addon');
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', REMOVE_STYLEFLO_BRANDING_ADDON_ID);
    if (user) await user.cleanup();
  });

  test.beforeEach(async () => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', 'google_calendar_addon');
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', REMOVE_STYLEFLO_BRANDING_ADDON_ID);
  });

  test('GET /api/billing/account and the Subscriptions tab show price paid and Remove StyleFlo branding at £4.99', async ({ page, request }) => {
    const { error } = await admin.from('tenant_active_addons').insert({
      tenant_id: GLOBEX,
      addon_catalog_id: 'google_calendar_addon',
      feature_id: 'google_calendar',
      quantity: 1,
      is_active: true,
      price_paid_pence: 350,
    });
    expect(error).toBeNull();

    const account = await request.get('/api/billing/account', {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    expect(account.status()).toBe(200);
    const body = await account.json();
    expect(body.tenant_id).toBe(GLOBEX);
    const google = body.monthly_bolt_ons.find((item: { id: string }) => item.id === 'google_calendar_addon');
    expect(google.already_included).toBe(true);
    expect(google.price_paid_pence).toBe(350);
    expect(google.price_label).toBe('£3.50/mo');
    expect(body.heading).toContain(formatPounds(body.monthly_total_pence));
    expect(body.heading).not.toContain('£4.99');

    const branding = body.monthly_bolt_ons.find((item: { id: string }) => item.id === REMOVE_STYLEFLO_BRANDING_ADDON_ID);
    expect(branding).toBeTruthy();
    expect(branding.catalogue_price_pence).toBe(499);
    expect(branding.price_label).toBe('£4.99/mo');
    expect(branding.already_included).toBe(false);

    await loginWithPassword(page, email, password);
    await page.locator('nav').locator('text=Subscriptions & Bolt-ons').first().click();
    await expect(page.getByRole('heading', { name: /Current plan =/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Remove StyleFlo branding' })).toBeVisible();
    await expect(page.getByText('£4.99/mo').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Already included' }).first()).toBeVisible();
    await expect(page.getByText('£3.50/mo').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'One-off packs' })).toBeVisible();
  });

  test('buying Remove StyleFlo branding via include-switch path hides the widget footer', async ({ request }) => {
    const chatbotId = 'c2000000-0000-4000-8000-000000000200';
    await admin.from('chatbots').delete().eq('id', chatbotId);
    const { error: botErr } = await admin.from('chatbots').insert({
      id: chatbotId,
      tenant_id: GLOBEX,
      name: 'STYL-200 branding',
      configuration_json: {},
      primary_color: '#260475',
    });
    expect(botErr).toBeNull();

    const before = await request.get(`/api/chatbots/${chatbotId}`);
    expect((await before.json()).hideStyleFloBranding).toBe(false);

    const { error } = await admin.from('tenant_active_addons').insert({
      tenant_id: GLOBEX,
      addon_catalog_id: REMOVE_STYLEFLO_BRANDING_ADDON_ID,
      feature_id: 'remove_branding',
      quantity: 1,
      is_active: true,
      price_paid_pence: 499,
    });
    expect(error).toBeNull();

    const after = await request.get(`/api/chatbots/${chatbotId}`);
    expect((await after.json()).hideStyleFloBranding).toBe(true);

    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', REMOVE_STYLEFLO_BRANDING_ADDON_ID);
    await admin.from('chatbots').delete().eq('id', chatbotId);
  });
});
