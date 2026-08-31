# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: styleflo-onboarding-e2e-v2.spec.ts >> StyleFlo Conversational Onboarding & Security Boundary Tests (v2) >> Supabase Row-Level Security (RLS) Isolation Checks >> should prevent Tenant A from accessing or mutating Tenant B data via API injection
- Location: tests\styleflo-onboarding-e2e-v2.spec.ts:88:9

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/dashboard/
Received string:  "http://localhost:3000/login"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    13 × locator resolved to <html lang="en" class="poppins_a9eef06b-module__e3suya__variable inter_4d9b5f00-module__5ifLia__variable antialiased">…</html>
       - unexpected value "http://localhost:3000/login"

```

```yaml
- main:
  - img
  - heading "Welcome to StyleFlo" [level=1]
  - paragraph: Sign in to manage your AI chatbots
  - text: Invalid login credentials
  - button "Continue with Google":
    - img
    - text: Continue with Google
  - paragraph:
    - text: By continuing with Google, you agree to StyleFlo's
    - button "Terms of Service"
    - text: and acknowledge our
    - button "Privacy Policy"
    - text: .
  - text: Or continue with credentials Email Address
  - textbox "you@example.com": team@rosserhairdressing.co.uk
  - text: Password
  - textbox "••••••••": LiverpoolSecurePass2026!
  - button "Sign In"
  - button "Don't have an account? Sign up"
- alert
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | /**
  4   |  * Playwright E2E Integration Suite: Conversational Onboarding Handshake & RLS Isolation Verification (v2)
  5   |  * Integrated into delightful-kepler codebase.
  6   |  */
  7   | 
  8   | test.describe('StyleFlo Conversational Onboarding & Security Boundary Tests (v2)', () => {
  9   | 
  10  |   test.beforeEach(async ({ page }) => {
  11  |     const targetUrl = process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/onboard` : '/onboard';
  12  |     await page.goto(targetUrl);
  13  |   });
  14  | 
  15  |   // PATH A: STANDARD GOOGLE AUTO-FILL
  16  |   test('should successfully complete the onboarding journey via Google Places auto-fill', async ({ page }) => {
  17  |     const chatWidget = page.locator('#styleflo-chat-inline');
  18  |     await expect(chatWidget.locator('text=Flo')).toBeVisible();
  19  |     await expect(chatWidget.locator('text=Let’s build your AI assistant')).toBeVisible();
  20  | 
  21  |     const chatInput = page.locator('textarea[placeholder*="Type your message"]');
  22  |     await chatInput.fill('https://maps.app.goo.gl/WP123Liverpool');
  23  |     await page.keyboard.press('Enter');
  24  | 
  25  |     const loader = page.locator('.animate-pulse, text=Flo is reading your website');
  26  |     await expect(loader).toBeVisible();
  27  | 
  28  |     const profileCard = page.locator('.border-slate-200', { hasText: 'STYLEFLO IDENTITY CONFIGURATOR' });
  29  |     await expect(profileCard).toBeVisible();
  30  | 
  31  |     const businessNameInput = profileCard.locator('input[placeholder="Business Name"]');
  32  |     await expect(businessNameInput).toHaveValue('Rosser Hairdressing');
  33  | 
  34  |     await profileCard.locator('button:has-text("Confirm & Continue")').click();
  35  | 
  36  |     const ingestionCard = page.locator('.border-slate-200', { hasText: 'AI KNOWLEDGE INGESTION PANEL' });
  37  |     await expect(ingestionCard).toBeVisible();
  38  | 
  39  |     await expect(ingestionCard.locator('text=/services-and-prices')).toBeVisible();
  40  |     await ingestionCard.locator('input[type="checkbox"][value="/services-and-prices"]').check();
  41  | 
  42  |     await ingestionCard.locator('button:has-text("Feed My Assistant")').click();
  43  | 
  44  |     const bookingCard = page.locator('.border-slate-200', { hasText: 'CHOOSE YOUR BOOKING ENGINE' });
  45  |     await expect(bookingCard).toBeVisible();
  46  |     await bookingCard.locator('input[type="radio"][value="external"]').check();
  47  |     await bookingCard.locator('button:has-text("Link & Lock Booking")').click();
  48  | 
  49  |     const enrollmentCard = page.locator('.border-slate-200', { hasText: 'SECURE YOUR STYLEFLO ACCOUNT' });
  50  |     await expect(enrollmentCard).toBeVisible();
  51  | 
  52  |     await enrollmentCard.locator('input[type="email"]').fill('team@rosserhairdressing.co.uk');
  53  |     await enrollmentCard.locator('input[type="password"]').fill('LiverpoolSecurePass2026!');
  54  |     await enrollmentCard.locator('input[type="checkbox"]').check();
  55  | 
  56  |     await enrollmentCard.locator('button:has-text("Launch My Assistant")').click();
  57  | 
  58  |     await expect(page.locator('text=You’re all set!')).toBeVisible();
  59  |     await expect(page).toHaveURL(/\/dashboard/);
  60  |   });
  61  | 
  62  |   // PATH B: DROP-OFF ONBOARDING RESUMPTION VIA CODE
  63  |   test('should restore abandoned onboarding progress when user inputs FLO resumption code', async ({ page }) => {
  64  |     const chatWidget = page.locator('#styleflo-chat-inline');
  65  |     await expect(chatWidget.locator('text=Flo')).toBeVisible();
  66  | 
  67  |     const chatInput = page.locator('textarea[placeholder*="Type your message"]');
  68  |     await chatInput.fill('FLO-8921');
  69  |     await page.keyboard.press('Enter');
  70  | 
  71  |     await expect(page.locator('text=Welcome back')).toBeVisible();
  72  |     const ingestionCard = page.locator('.border-slate-200', { hasText: 'AI KNOWLEDGE INGESTION PANEL' });
  73  |     await expect(ingestionCard).toBeVisible();
  74  |   });
  75  | 
  76  |   // PATH C: SUPABASE ROW-LEVEL SECURITY (RLS) PENETRATION CHECKS
  77  |   test.describe('Supabase Row-Level Security (RLS) Isolation Checks', () => {
  78  | 
  79  |     test.beforeEach(async ({ page }) => {
  80  |       const loginUrl = process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/login` : '/login';
  81  |       await page.goto(loginUrl);
  82  |       await page.fill('input[type="email"]', 'team@rosserhairdressing.co.uk');
  83  |       await page.fill('input[type="password"]', 'LiverpoolSecurePass2026!');
  84  |       await page.click('button[type="submit"]');
> 85  |       await expect(page).toHaveURL(/\/dashboard/);
      |                          ^ Error: expect(page).toHaveURL(expected) failed
  86  |     });
  87  | 
  88  |     test('should prevent Tenant A from accessing or mutating Tenant B data via API injection', async ({ request }) => {
  89  |       const crossTenantStaffFetch = await request.get('/api/staff?tenantId=b0000000-0000-0000-0000-000000000002');
  90  |       expect(crossTenantStaffFetch.status()).toBe(403);
  91  | 
  92  |       const crossTenantHoursPatch = await request.patch('/api/tenants/settings', {
  93  |         headers: { 'Content-Type': 'application/json' },
  94  |         data: {
  95  |           tenantId: 'b0000000-0000-0000-0000-000000000002',
  96  |           general_operating_hours: {
  97  |             monday: { open: "00:00", close: "23:59", closed: false }
  98  |           }
  99  |         }
  100 |       });
  101 |       expect(crossTenantHoursPatch.status()).toBe(403);
  102 |     });
  103 |   });
  104 | 
  105 | });
  106 | 
```