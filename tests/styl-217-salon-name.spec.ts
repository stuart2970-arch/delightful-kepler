import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { TENANT_PROFILE_SELECT, salonNameFromTenant } from '../src/lib/tenant-profile';

/**
 * STYL-217: a new sign-up's salon name is stored on the tenant and shown
 * on the dashboard, Account Settings, and Integrations.
 */

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

test.describe('STYL-217 salon name', () => {
  test('the dashboard tenant select succeeds against the local schema', async () => {
    const { data, error } = await admin.from('tenants').select(TENANT_PROFILE_SELECT).limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(salonNameFromTenant(data?.[0]?.company_name).length).toBeGreaterThan(0);
  });

  test('sign-up stores the salon name and the first dashboard shows it in all three places', async ({ page }) => {
    const stamp = Date.now();
    const salon = `Willow Thread ${stamp}`;
    const email = `styl217-${stamp}@example.test`;
    const password = 'password123';
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: 'Sam Test',
        company_name: salon,
        slug: `willow-thread-${stamp}`,
      },
    });
    expect(error).toBeNull();
    const userId = data.user?.id;
    expect(userId).toBeTruthy();

    try {
      const { data: profile, error: profileError } = await admin
        .from('profiles')
        .select('tenant_id')
        .eq('id', userId!)
        .single();
      expect(profileError).toBeNull();
      const { data: tenant, error: tenantError } = await admin
        .from('tenants')
        .select('company_name')
        .eq('id', profile!.tenant_id)
        .single();
      expect(tenantError).toBeNull();
      expect(tenant?.company_name).toBe(salon);

      await page.goto('/login');
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill(password);
      await page.locator('form button[type="submit"]').click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
      await expect(page.getByTestId('salon-name')).toHaveText(salon);

      await page.getByRole('button', { name: 'Account Settings' }).click();
      await expect(page.getByTestId('account-salon-name')).toHaveValue(salon);

      await page.getByRole('button', { name: 'Integrations' }).click();
      await expect(page.getByTestId('official-business-name')).toHaveValue(salon);
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
