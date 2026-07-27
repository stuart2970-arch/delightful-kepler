import { test, expect } from '@playwright/test';

test.describe('Authentication Flows', () => {
  test('login page loads correctly', async ({ page }) => {
    await page.goto('/login');

    // Verify the title or heading
    await expect(page.locator('h1')).toHaveText('Welcome to StyleFlo');

    // Verify inputs exist
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    // Verify sign in button exists
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('can toggle to signup form', async ({ page }) => {
    await page.goto('/login');

    // Click the toggle button
    await page.getByRole('button', { name: "Don't have an account? Sign up" }).click();

    // Verify we are on signup form
    await expect(page.locator('h1')).toHaveText('Welcome to StyleFlo');
    await expect(page.getByText('Create an account to get started')).toBeVisible();

    // Verify additional inputs appear
    await expect(page.locator('input[placeholder="Jane Doe"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Rosser Hairdressing"]')).toBeVisible();
    await expect(page.locator('input[placeholder="https://example.com"]')).toBeVisible();
    
    // Verify submit button changed
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
  });
});
