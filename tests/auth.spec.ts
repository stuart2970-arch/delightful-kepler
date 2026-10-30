import { test, expect } from '@playwright/test';

test.describe('Authentication Flows', () => {
  test('login page loads correctly', async ({ page }) => {
    await page.goto('/login');

    // Verify the social login buttons exist (new UI design)
    await expect(page.getByRole('button', { name: /Sign In in 1-Click with Google/i })).toBeVisible();

    // Verify inputs exist
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    // Verify sign in with password and magic login buttons exist
    await expect(page.getByRole('button', { name: /Sign In with Password/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Send Magic Login Link/i })).toBeVisible();
  });

  test('can toggle to signup form', async ({ page }) => {
    await page.goto('/login');

    // Click the toggle button
    await page.getByRole('button', { name: /Don't have an account\? Sign up/i }).click();

    // Verify we are on signup form

    // Verify additional inputs appear
    await expect(page.locator('input[placeholder="Sarah Jenkins"]')).toBeVisible();
    await expect(page.locator('input[placeholder="StyleFlo Lounge"]')).toBeVisible();
    
    // Verify submit button changed
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
  });

  test('business name preview uses styleflo.ai/business/[slug]', async ({ page }) => {
    await page.goto('/login?mode=register');

    // Type a business name
    const businessInput = page.locator('input[placeholder="StyleFlo Lounge"]');
    await expect(businessInput).toBeVisible();
    await businessInput.fill('Luxe Locks Lounge');

    // Verify preview URL contains /business/luxe-locks-lounge
    await expect(page.getByText(/business\/luxe-locks-lounge/)).toBeVisible({ timeout: 5000 });
  });

  test('can request magic login link and handles authentication flow', async ({ page }) => {
    await page.goto('/login');

    const emailInput = page.locator('input[type="email"]');
    // Unique address: per-email magic-link limit is 3 per 15 minutes.
    await emailInput.fill(`auth-magic-${Date.now()}@test.styleflo.ai`);

    await page.getByRole('button', { name: /Send Magic Login Link/i }).click();

    // The route emails a link. It must not sign the browser in by itself.
    await expect(page.getByText('Magic Login Link Sent!')).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);
    const cookies = await page.context().cookies();
    expect(cookies.some((cookie) => /auth-token/i.test(cookie.name))).toBe(false);
  });
});
