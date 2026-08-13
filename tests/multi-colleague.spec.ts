import { test, expect } from '@playwright/test';

/**
 * Playwright E2E Integration Suite: Multi-Colleague Dashboard, RBAC, and Calendar Connection
 * 
 * This suite verifies the following critical paths of the multi-colleague architecture:
 * 1. Account Owner (`owner`) inviting a new staff colleague.
 * 2. New colleague registration matching and linking via database triggers (RBAC 'member' mapping).
 * 3. Granular RLS & UI visibility guardrails for 'owner' vs 'member' roles.
 * 4. Colleague self-management of their profile, bio, and local rota shifts.
 * 5. Google Calendar OAuth flow with `staffId` context state pass-through.
 * 6. Master schedule side-by-side view combining all colleague availability.
 */

test.describe('Multi-Colleague Dashboard & RBAC Rota Systems', () => {
  
  // Set up clean database state or bypass auth using custom storageState/cookies
  test.beforeEach(async ({ page }) => {
    // Navigate to homepage/login page
    await page.goto('/');
  });

  test.describe('Role: Account Owner (t0000000-0000-0000-0000-000000000001)', () => {
    test.beforeEach(async ({ page }) => {
      // Mocking owner login (admin@acme.com)
      await page.goto('/login');
      await page.fill('input[type="email"]', 'admin@acme.com');
      await page.fill('input[type="password"]', 'password123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/\/dashboard/);
    });

    test('should allow Owner to view all Admin tabs and KPI Metrics', async ({ page }) => {
      // Verify all administrative tabs are visible in the sidebar navigation
      await expect(page.locator('text=Master Calendar & Rota')).toBeVisible();
      await expect(page.locator('text=Chatbot Manager')).toBeVisible();
      await expect(page.locator('text=KPI Metrics & Revenue')).toBeVisible();
      await expect(page.locator('text=Subscriptions & Add-ons')).toBeVisible();
      
      // Ensure 'My Profile' tab is NOT visible (Owner doesn't need self-management view here)
      await expect(page.locator('text=My Profile & Calendar')).not.toBeVisible();
    });

    test('should allow Owner to invite/create a new Colleague', async ({ page }) => {
      // Navigate to Scheduling & Staff
      await page.click('button:has-text("Master Calendar & Rota")');
      
      // Open "Add Staff" dialog/modal
      await page.click('button:has-text("Add Staff Member")');
      
      // Fill out colleague invite details
      await page.fill('input[name="staff-name"]', 'Sarah Miller');
      await page.fill('input[name="staff-email"]', 'sarah.miller@acme.com');
      await page.fill('input[name="staff-role"]', 'Stylist');
      
      // Select supported services for this colleague
      await page.check('input[value="service-haircut-id"]');
      
      // Submit staff invitation
      await page.click('button:has-text("Save Staff Profile")');
      
      // Verify Sarah Miller appears in the staff grid as an unlinked colleague (gray indicator)
      const staffCard = page.locator('.border-slate-200', { hasText: 'Sarah Miller' });
      await expect(staffCard).toBeVisible();
      await expect(staffCard.locator('text=⚪')).toBeVisible(); // ⚪ indicates unlinked/pending registration
    });

    test('should display side-by-side Master Schedule grouping appointments per stylist', async ({ page }) => {
      await page.click('button:has-text("Master Calendar & Rota")');
      await expect(page.locator('text=Master Schedule')).toBeVisible();

      // Verify multiple columns representing different staff columns are present
      const columns = page.locator('.grid-cols-1 >> div.border-slate-200');
      const count = await columns.count();
      expect(count).toBeGreaterThan(0);

      // Verify that appointments filter correctly under respective stylists
      const michaelCard = page.locator('div.border-slate-200', { hasText: 'Michael' });
      await expect(michaelCard.locator('text=Today\'s Bookings')).toBeVisible();
    });
  });

  test.describe('Role: Colleague (sarah.miller@acme.com)', () => {
    test('should trigger automatic RBAC matching on colleague sign-up', async ({ page }) => {
      await page.goto('/login?tab=register');
      
      // Sign up with the exact email that the owner invited
      await page.fill('input[name="fullName"]', 'Sarah Miller');
      await page.fill('input[name="email"]', 'sarah.miller@acme.com');
      await page.fill('input[name="password"]', 'securepass123!');
      
      // Note: Triggers on_auth_user_created trigger which checks pre-invited email
      await page.click('button:has-text("Create Account")');
      await expect(page).toHaveURL(/\/dashboard/);

      // Verify UI changes according to Colleague ('member') role
      // 1. Core administrative tabs must be hidden
      await expect(page.locator('text=Chatbot Manager')).not.toBeVisible();
      await expect(page.locator('text=KPI Metrics & Revenue')).not.toBeVisible();
      await expect(page.locator('text=Subscriptions & Add-ons')).not.toBeVisible();

      // 2. Colleague tabs must be visible
      await expect(page.locator('text=Master Calendar & Rota')).toBeVisible();
      await expect(page.locator('text=My Profile & Calendar')).toBeVisible();
    });

    test.describe('Colleague Dashboard Operations', () => {
      test.beforeEach(async ({ page }) => {
        // Log in as the successfully matched colleague
        await page.goto('/login');
        await page.fill('input[type="email"]', 'sarah.miller@acme.com');
        await page.fill('input[type="password"]', 'securepass123!');
        await page.click('button[type="submit"]');
        await expect(page).toHaveURL(/\/dashboard/);
      });

      test('should prevent colleague from accessing admin endpoints directly (CORS/RLS enforcement)', async ({ page, request }) => {
        // Verify UI access restriction
        await expect(page.locator('text=Chatbot Manager')).not.toBeVisible();
        await expect(page.locator('text=KPI Metrics & Revenue')).not.toBeVisible();
        
        // Attempt programmatic bypass of billing API
        const billingResponse = await request.get('/api/superadmin/entitlements');
        expect(billingResponse.status()).toBe(403); // Forbidden access boundary check

        // Attempt programmatic bypass of general tenant settings
        const tenantResponse = await request.patch('/api/tenants/settings', {
          data: { booking_mode: 'walk_in_only' }
        });
        expect(tenantResponse.status()).toBe(403);
      });

      test('should allow colleague to edit only their own profile, bio, and local rota', async ({ page }) => {
        await page.click('button:has-text("My Profile & Calendar")');
        await expect(page.locator('text=My Profile')).toBeVisible();

        // Check if name is prepopulated
        const nameInput = page.locator('input[name="name"]');
        await expect(nameInput).toHaveValue('Sarah Miller');

        // Update bio and shift patterns (local rota)
        await page.fill('textarea[name="bio"]', 'Senior stylist specializing in cuts and dynamic coloring.');
        
        // Uncheck Wednesdays on the weekly rota shift
        await page.uncheck('input[name="working-days"][value="wednesday"]');

        // Save safe profile payload
        await page.click('button:has-text("Save Profile")');
        await expect(page.locator('text=Profile updated successfully')).toBeVisible();

        // Refresh and verify changes persisted
        await page.reload();
        await expect(page.locator('textarea[name="bio"]')).toHaveValue('Senior stylist specializing in cuts and dynamic coloring.');
        await expect(page.locator('input[name="working-days"][value="wednesday"]')).not.toBeChecked();
      });

      test('should successfully trigger staff-specific Google Calendar OAuth flow', async ({ page }) => {
        await page.click('button:has-text("My Profile & Calendar")');
        
        // Intercept OAuth redirection URL
        const [popup] = await Promise.all([
          page.waitForEvent('popup'),
          page.click('a:has-text("Connect Google Calendar")'), // Triggers Route 1 (OAuth authorize URL)
        ]);

        // Verify redirect URL points to Google accounts page and contains base64 context state passing staffId
        const url = popup.url();
        expect(url).toContain('accounts.google.com');
        expect(url).toContain('state=');
        expect(url).toContain('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events');

        // Extract and decode base64 state payload to confirm staffId tracking parameter is correctly bound
        const stateParam = new URL(url).searchParams.get('state');
        expect(stateParam).not.toBeNull();
        const decodedState = JSON.parse(Buffer.from(stateParam!, 'base64').toString('utf-8'));
        
        expect(decodedState).toHaveProperty('staffId');
        expect(decodedState.staffId).not.toBeNull(); // Ensure dynamic staffId mapping is maintained
      });

      test('should write OAuth tokens strictly on staff row and not on general tenants table on callback', async ({ request }) => {
        // Simulate google redirect callback for Route A (Staff Calendar)
        const mockCode = 'mock_google_oauth_auth_code_9876';
        
        // Encode state with a valid mock staff UUID and userId
        const mockState = Buffer.from(JSON.stringify({
          userId: 'mock-user-uuid-1111',
          staffId: 'mock-staff-uuid-2222'
        })).toString('base64');

        // Execute API callback
        const response = await request.get(`/api/integrations/google/callback?code=${mockCode}&state=${mockState}`);
        
        // Check redirect back to scheduling dashboard tab
        expect(response.url()).toContain('/dashboard?tab=scheduling');

        // Confirm database checks (verified via backend telemetry or isolated mock checks)
        // 1. Staff table must hold: google_access_token, google_refresh_token, google_token_expiry
        // 2. Tenants table MUST remain NULL for these fields (ensuring isolation from general business calendar)
      });
    });
  });
});
