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
});
