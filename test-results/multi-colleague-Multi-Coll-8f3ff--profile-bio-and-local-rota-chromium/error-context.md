# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: multi-colleague.spec.ts >> Multi-Colleague Dashboard & RBAC Rota Systems >> Role: Colleague (sarah.miller@acme.com) >> Colleague Dashboard Operations >> should allow colleague to edit only their own profile, bio, and local rota
- Location: tests\multi-colleague.spec.ts:133:11

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/dashboard/
Received string:  "http://localhost:3000/login"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    14 × locator resolved to <html lang="en" class="poppins_a9eef06b-module__e3suya__variable inter_4d9b5f00-module__5ifLia__variable antialiased">…</html>
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
  - textbox "you@example.com": sarah.miller@acme.com
  - text: Password
  - textbox "••••••••": securepass123!
  - button "Sign In"
  - button "Don't have an account? Sign up"
- alert
```

# Test source

```ts
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
  30  |       await expect(page).toHaveURL(/\/dashboard/);
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
> 114 |         await expect(page).toHaveURL(/\/dashboard/);
      |                            ^ Error: expect(page).toHaveURL(expected) failed
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
  131 |       });
  132 | 
  133 |       test('should allow colleague to edit only their own profile, bio, and local rota', async ({ page }) => {
  134 |         await page.click('button:has-text("My Profile & Calendar")');
  135 |         await expect(page.locator('text=My Profile')).toBeVisible();
  136 | 
  137 |         // Check if name is prepopulated
  138 |         const nameInput = page.locator('input[name="name"]');
  139 |         await expect(nameInput).toHaveValue('Sarah Miller');
  140 | 
  141 |         // Update bio and shift patterns (local rota)
  142 |         await page.fill('textarea[name="bio"]', 'Senior stylist specializing in cuts and dynamic coloring.');
  143 |         
  144 |         // Uncheck Wednesdays on the weekly rota shift
  145 |         await page.uncheck('input[name="working-days"][value="wednesday"]');
  146 | 
  147 |         // Save safe profile payload
  148 |         await page.click('button:has-text("Save Profile")');
  149 |         await expect(page.locator('text=Profile updated successfully')).toBeVisible();
  150 | 
  151 |         // Refresh and verify changes persisted
  152 |         await page.reload();
  153 |         await expect(page.locator('textarea[name="bio"]')).toHaveValue('Senior stylist specializing in cuts and dynamic coloring.');
  154 |         await expect(page.locator('input[name="working-days"][value="wednesday"]')).not.toBeChecked();
  155 |       });
  156 | 
  157 |       test('should successfully trigger staff-specific Google Calendar OAuth flow', async ({ page }) => {
  158 |         await page.click('button:has-text("My Profile & Calendar")');
  159 |         
  160 |         // Intercept OAuth redirection URL
  161 |         const [popup] = await Promise.all([
  162 |           page.waitForEvent('popup'),
  163 |           page.click('a:has-text("Connect Google Calendar")'), // Triggers Route 1 (OAuth authorize URL)
  164 |         ]);
  165 | 
  166 |         // Verify redirect URL points to Google accounts page and contains base64 context state passing staffId
  167 |         const url = popup.url();
  168 |         expect(url).toContain('accounts.google.com');
  169 |         expect(url).toContain('state=');
  170 |         expect(url).toContain('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events');
  171 | 
  172 |         // Extract and decode base64 state payload to confirm staffId tracking parameter is correctly bound
  173 |         const stateParam = new URL(url).searchParams.get('state');
  174 |         expect(stateParam).not.toBeNull();
  175 |         const decodedState = JSON.parse(Buffer.from(stateParam!, 'base64').toString('utf-8'));
  176 |         
  177 |         expect(decodedState).toHaveProperty('staffId');
  178 |         expect(decodedState.staffId).not.toBeNull(); // Ensure dynamic staffId mapping is maintained
  179 |       });
  180 | 
  181 |       test('should write OAuth tokens strictly on staff row and not on general tenants table on callback', async ({ request }) => {
  182 |         // Simulate google redirect callback for Route A (Staff Calendar)
  183 |         const mockCode = 'mock_google_oauth_auth_code_9876';
  184 |         
  185 |         // Encode state with a valid mock staff UUID and userId
  186 |         const mockState = Buffer.from(JSON.stringify({
  187 |           userId: 'mock-user-uuid-1111',
  188 |           staffId: 'mock-staff-uuid-2222'
  189 |         })).toString('base64');
  190 | 
  191 |         // Execute API callback
  192 |         const response = await request.get(`/api/integrations/google/callback?code=${mockCode}&state=${mockState}`);
  193 |         
  194 |         // Check redirect back to scheduling dashboard tab
  195 |         expect(response.url()).toContain('/dashboard?tab=scheduling');
  196 | 
  197 |         // Confirm database checks (verified via backend telemetry or isolated mock checks)
  198 |         // 1. Staff table must hold: google_access_token, google_refresh_token, google_token_expiry
  199 |         // 2. Tenants table MUST remain NULL for these fields (ensuring isolation from general business calendar)
  200 |       });
  201 |     });
  202 |   });
  203 | });
  204 | 
```