# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: multi-colleague.spec.ts >> Multi-Colleague Dashboard & RBAC Rota Systems >> Role: Account Owner (t0000000-0000-0000-0000-000000000001) >> should allow Owner to invite/create a new Colleague
- Location: tests\multi-colleague.spec.ts:44:9

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/dashboard/
Received string:  "chrome-error://chromewebdata/"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    5 × locator resolved to <html lang="en" class="poppins_39de20a3-module__8LurOG__variable inter_ce929fb-module__qqrwVG__variable antialiased">…</html>
      - unexpected value "http://localhost:3000/login"
    - waiting for "https://styleflo.test/app" navigation to finish...
    4 × locator resolved to <html>…</html>
      - unexpected value "chrome-error://chromewebdata/"

```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | /**
  4   |  * Playwright E2E Integration Suite: Multi-Colleague Dashboard, RBAC, and Calendar Connection
  5   |  * 
  6   |  * This suite verifies the following critical paths of the multi-colleague architecture:
  7   |  * 1. Account Owner (`owner`) inviting a new staff colleague.
  8   |  * 2. New colleague registration matching and linking via database triggers (RBAC 'member' mapping).
  9   |  * 3. Granular RLS & UI visibility guardrails for 'owner' vs 'member' roles.
  10  |  * 4. Colleague self-management of their profile, bio, and local rota shifts.
  11  |  * 5. Google Calendar OAuth flow with `staffId` context state pass-through.
  12  |  * 6. Master schedule side-by-side view combining all colleague availability.
  13  |  */
  14  | 
  15  | test.describe('Multi-Colleague Dashboard & RBAC Rota Systems', () => {
  16  |   
  17  |   // Set up clean database state or bypass auth using custom storageState/cookies
  18  |   test.beforeEach(async ({ page }) => {
  19  |     // Navigate to homepage/login page
  20  |     await page.goto('/');
  21  |   });
  22  | 
  23  |   test.describe('Role: Account Owner (t0000000-0000-0000-0000-000000000001)', () => {
  24  |     test.beforeEach(async ({ page }) => {
  25  |       // Mocking owner login (admin@acme.com)
  26  |       await page.goto('/login');
  27  |       await page.fill('input[type="email"]', 'admin@acme.com');
  28  |       await page.fill('input[type="password"]', 'password123');
  29  |       await page.click('button[type="submit"]');
> 30  |       await expect(page).toHaveURL(/\/dashboard/);
      |                          ^ Error: expect(page).toHaveURL(expected) failed
  31  |     });
  32  | 
  33  |     test('should allow Owner to view all Admin tabs and KPI Metrics', async ({ page }) => {
  34  |       // Verify all administrative tabs are visible in the sidebar navigation
  35  |       await expect(page.locator('text=Master Calendar & Rota')).toBeVisible();
  36  |       await expect(page.locator('text=Chatbot Manager')).toBeVisible();
  37  |       await expect(page.locator('text=KPI Metrics & Revenue')).toBeVisible();
  38  |       await expect(page.locator('text=Subscriptions & Add-ons')).toBeVisible();
  39  |       
  40  |       // Ensure 'My Profile' tab is NOT visible (Owner doesn't need self-management view here)
  41  |       await expect(page.locator('text=My Profile & Calendar')).not.toBeVisible();
  42  |     });
  43  | 
  44  |     test('should allow Owner to invite/create a new Colleague', async ({ page }) => {
  45  |       // Navigate to Scheduling & Staff
  46  |       await page.click('button:has-text("Master Calendar & Rota")');
  47  |       
  48  |       // Open "Add Staff" dialog/modal
  49  |       await page.click('button:has-text("Add Staff Member")');
  50  |       
  51  |       // Fill out colleague invite details
  52  |       await page.fill('input[name="staff-name"]', 'Sarah Miller');
  53  |       await page.fill('input[name="staff-email"]', 'sarah.miller@acme.com');
  54  |       await page.fill('input[name="staff-role"]', 'Stylist');
  55  |       
  56  |       // Select supported services for this colleague
  57  |       await page.check('input[value="service-haircut-id"]');
  58  |       
  59  |       // Submit staff invitation
  60  |       await page.click('button:has-text("Save Staff Profile")');
  61  |       
  62  |       // Verify Sarah Miller appears in the staff grid as an unlinked colleague (gray indicator)
  63  |       const staffCard = page.locator('.border-slate-200', { hasText: 'Sarah Miller' });
  64  |       await expect(staffCard).toBeVisible();
  65  |       await expect(staffCard.locator('text=⚪')).toBeVisible(); // ⚪ indicates unlinked/pending registration
  66  |     });
  67  | 
  68  |     test('should display side-by-side Master Schedule grouping appointments per stylist', async ({ page }) => {
  69  |       await page.click('button:has-text("Master Calendar & Rota")');
  70  |       await expect(page.locator('text=Master Schedule')).toBeVisible();
  71  | 
  72  |       // Verify multiple columns representing different staff columns are present
  73  |       const columns = page.locator('.grid-cols-1 >> div.border-slate-200');
  74  |       const count = await columns.count();
  75  |       expect(count).toBeGreaterThan(0);
  76  | 
  77  |       // Verify that appointments filter correctly under respective stylists
  78  |       const michaelCard = page.locator('div.border-slate-200', { hasText: 'Michael' });
  79  |       await expect(michaelCard.locator('text=Today\'s Bookings')).toBeVisible();
  80  |     });
  81  |   });
  82  | 
  83  |   test.describe('Role: Colleague (sarah.miller@acme.com)', () => {
  84  |     test('should trigger automatic RBAC matching on colleague sign-up', async ({ page }) => {
  85  |       await page.goto('/login?tab=register');
  86  |       
  87  |       // Sign up with the exact email that the owner invited
  88  |       await page.fill('input[name="fullName"]', 'Sarah Miller');
  89  |       await page.fill('input[name="email"]', 'sarah.miller@acme.com');
  90  |       await page.fill('input[name="password"]', 'securepass123!');
  91  |       
  92  |       // Note: Triggers on_auth_user_created trigger which checks pre-invited email
  93  |       await page.click('button:has-text("Create Account")');
  94  |       await expect(page).toHaveURL(/\/dashboard/);
  95  | 
  96  |       // Verify UI changes according to Colleague ('member') role
  97  |       // 1. Core administrative tabs must be hidden
  98  |       await expect(page.locator('text=Chatbot Manager')).not.toBeVisible();
  99  |       await expect(page.locator('text=KPI Metrics & Revenue')).not.toBeVisible();
  100 |       await expect(page.locator('text=Subscriptions & Add-ons')).not.toBeVisible();
  101 | 
  102 |       // 2. Colleague tabs must be visible
  103 |       await expect(page.locator('text=Master Calendar & Rota')).toBeVisible();
  104 |       await expect(page.locator('text=My Profile & Calendar')).toBeVisible();
  105 |     });
  106 | 
  107 |     test.describe('Colleague Dashboard Operations', () => {
  108 |       test.beforeEach(async ({ page }) => {
  109 |         // Log in as the successfully matched colleague
  110 |         await page.goto('/login');
  111 |         await page.fill('input[type="email"]', 'sarah.miller@acme.com');
  112 |         await page.fill('input[type="password"]', 'securepass123!');
  113 |         await page.click('button[type="submit"]');
  114 |         await expect(page).toHaveURL(/\/dashboard/);
  115 |       });
  116 | 
  117 |       test('should prevent colleague from accessing admin endpoints directly (CORS/RLS enforcement)', async ({ page, request }) => {
  118 |         // Verify UI access restriction
  119 |         await expect(page.locator('text=Chatbot Manager')).not.toBeVisible();
  120 |         await expect(page.locator('text=KPI Metrics & Revenue')).not.toBeVisible();
  121 |         
  122 |         // Attempt programmatic bypass of billing API
  123 |         const billingResponse = await request.get('/api/superadmin/entitlements');
  124 |         expect(billingResponse.status()).toBe(403); // Forbidden access boundary check
  125 | 
  126 |         // Attempt programmatic bypass of general tenant settings
  127 |         const tenantResponse = await request.patch('/api/tenants/settings', {
  128 |           data: { booking_mode: 'walk_in_only' }
  129 |         });
  130 |         expect(tenantResponse.status()).toBe(403);
```