import { test, expect } from '@playwright/test';

/**
 * Playwright E2E Integration Suite: Conversational Onboarding Handshake & RLS Isolation Verification (v2)
 * Integrated into delightful-kepler codebase.
 */

test.describe('StyleFlo Conversational Onboarding & Security Boundary Tests (v2)', () => {

  test.beforeEach(async ({ page }) => {
    const targetUrl = process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/onboard` : '/onboard';
    await page.goto(targetUrl);
  });

  // PATH A: STANDARD GOOGLE AUTO-FILL
  test('should successfully complete the onboarding journey via Google Places auto-fill', async ({ page }) => {
    const chatWidget = page.locator('#styleflo-chat-inline');
    await expect(chatWidget.locator('text=Flo')).toBeVisible();
    await expect(chatWidget.locator('text=Let’s build your AI assistant')).toBeVisible();

    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('https://maps.app.goo.gl/WP123Liverpool');
    await page.keyboard.press('Enter');

    const loader = page.locator('.animate-pulse, text=Flo is reading your website');
    await expect(loader).toBeVisible();

    const profileCard = page.locator('.border-slate-200', { hasText: 'STYLEFLO IDENTITY CONFIGURATOR' });
    await expect(profileCard).toBeVisible();

    const businessNameInput = profileCard.locator('input[placeholder="Business Name"]');
    await expect(businessNameInput).toHaveValue('Rosser Hairdressing');

    await profileCard.locator('button:has-text("Confirm & Continue")').click();

    const ingestionCard = page.locator('.border-slate-200', { hasText: 'AI KNOWLEDGE INGESTION PANEL' });
    await expect(ingestionCard).toBeVisible();

    await expect(ingestionCard.locator('text=/services-and-prices')).toBeVisible();
    await ingestionCard.locator('input[type="checkbox"][value="/services-and-prices"]').check();

    await ingestionCard.locator('button:has-text("Feed My Assistant")').click();

    const bookingCard = page.locator('.border-slate-200', { hasText: 'CHOOSE YOUR BOOKING ENGINE' });
    await expect(bookingCard).toBeVisible();
    await bookingCard.locator('input[type="radio"][value="external"]').check();
    await bookingCard.locator('button:has-text("Link & Lock Booking")').click();

    const enrollmentCard = page.locator('.border-slate-200', { hasText: 'SECURE YOUR STYLEFLO ACCOUNT' });
    await expect(enrollmentCard).toBeVisible();

    await enrollmentCard.locator('input[type="email"]').fill('team@rosserhairdressing.co.uk');
    await enrollmentCard.locator('input[type="password"]').fill('LiverpoolSecurePass2026!');
    await enrollmentCard.locator('input[type="checkbox"]').check();

    await enrollmentCard.locator('button:has-text("Launch My Assistant")').click();

    await expect(page.locator('text=You’re all set!')).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  // PATH B: DROP-OFF ONBOARDING RESUMPTION VIA CODE
  test('should restore abandoned onboarding progress when user inputs FLO resumption code', async ({ page }) => {
    const chatWidget = page.locator('#styleflo-chat-inline');
    await expect(chatWidget.locator('text=Flo')).toBeVisible();

    const chatInput = page.locator('textarea[placeholder*="Type your message"]');
    await chatInput.fill('FLO-8921');
    await page.keyboard.press('Enter');

    await expect(page.locator('text=Welcome back')).toBeVisible();
    const ingestionCard = page.locator('.border-slate-200', { hasText: 'AI KNOWLEDGE INGESTION PANEL' });
    await expect(ingestionCard).toBeVisible();
  });

  // PATH C: SUPABASE ROW-LEVEL SECURITY (RLS) PENETRATION CHECKS
  test.describe('Supabase Row-Level Security (RLS) Isolation Checks', () => {

    test.beforeEach(async ({ page }) => {
      const loginUrl = process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/login` : '/login';
      await page.goto(loginUrl);
      await page.fill('input[type="email"]', 'team@rosserhairdressing.co.uk');
      await page.fill('input[type="password"]', 'LiverpoolSecurePass2026!');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/\/dashboard/);
    });

    test('should prevent Tenant A from accessing or mutating Tenant B data via API injection', async ({ request }) => {
      const crossTenantStaffFetch = await request.get('/api/staff?tenantId=b0000000-0000-0000-0000-000000000002');
      expect(crossTenantStaffFetch.status()).toBe(403);

      const crossTenantHoursPatch = await request.patch('/api/tenants/settings', {
        headers: { 'Content-Type': 'application/json' },
        data: {
          tenantId: 'b0000000-0000-0000-0000-000000000002',
          general_operating_hours: {
            monday: { open: "00:00", close: "23:59", closed: false }
          }
        }
      });
      expect(crossTenantHoursPatch.status()).toBe(403);
    });
  });

});
