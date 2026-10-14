import { test, expect } from '@playwright/test';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

test.describe('Phases 4 & 5: WhatsApp Embedded Signup v4 UI & Superadmin Telemetry', () => {
  const timestamp = Date.now();
  const testOwnerEmail = `test+salonowner.${timestamp}@styleflo.ai`;
  const testSuperadminEmail = `test+superadmin.${timestamp}@styleflo.ai`;
  let ownerUserId: string | null = null;
  let superadminUserId: string | null = null;
  let testTenantId: string | null = null;

  test.beforeAll(async () => {
    if (!supabaseAdmin) return;

    // 1. Create a test salon tenant
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .insert({
        company_name: `StyleFlo Test Salon ${timestamp}`,
        domain: `testsalon${timestamp}.styleflo.ai`,
        plan_tier: 'base_tier',
        has_whatsapp: true,
      })
      .select('id')
      .single();

    if (tenant) {
      testTenantId = tenant.id;

      // Seed a test whatsapp_account in verifying state
      await supabaseAdmin.from('whatsapp_accounts').insert({
        tenant_id: testTenantId,
        waba_id: `waba_ui_test_${timestamp}`,
        phone_number_id: `phone_ui_test_${timestamp}`,
        display_phone: '+447446900875',
        display_name: `StyleFlo Test Salon ${timestamp}`,
        mode: 'cloud',
        status: 'connected',
        card_missing: true,
        payment_status: 'card_missing',
        quality_rating: 'GREEN',
        messaging_limit: 'TIER_250',
      });

      // Seed daily usage record
      await supabaseAdmin.from('whatsapp_usage_daily').insert({
        tenant_id: testTenantId,
        date: new Date().toISOString().split('T')[0],
        inbound: 12,
        outbound: 8,
        outbound_template: 5,
        by_category: {
          service: 8,
          utility: 5,
          marketing: 0,
          authentication: 0,
        },
      });
    }

    // 2. Create test owner user
    const { data: ownerUser } = await supabaseAdmin.auth.admin.createUser({
      email: testOwnerEmail,
      password: 'password123',
      email_confirm: true,
      user_metadata: { full_name: 'Test Salon Owner' },
    });

    if (ownerUser?.user) {
      ownerUserId = ownerUser.user.id;
      if (testTenantId) {
        await supabaseAdmin.from('profiles').upsert({
          id: ownerUserId,
          role: 'owner',
          tenant_id: testTenantId,
        });
      }
    }

    // 3. Create test superadmin user
    const { data: superUser } = await supabaseAdmin.auth.admin.createUser({
      email: testSuperadminEmail,
      password: 'password123',
      email_confirm: true,
      user_metadata: { full_name: 'Test Superadmin' },
    });

    if (superUser?.user) {
      superadminUserId = superUser.user.id;
      if (testTenantId) {
        await supabaseAdmin.from('profiles').upsert({
          id: superadminUserId,
          role: 'owner',
          tenant_id: testTenantId,
          is_super_admin: true,
        });
      }
    }
  });

  test.afterAll(async () => {
    if (!supabaseAdmin) return;
    try {
      if (ownerUserId) await supabaseAdmin.auth.admin.deleteUser(ownerUserId);
    } catch {}
    try {
      if (superadminUserId) await supabaseAdmin.auth.admin.deleteUser(superadminUserId);
    } catch {}
    try {
      if (testTenantId) {
        await supabaseAdmin.from('whatsapp_usage_daily').delete().eq('tenant_id', testTenantId);
        await supabaseAdmin.from('whatsapp_accounts').delete().eq('tenant_id', testTenantId);
        await supabaseAdmin.from('tenants').delete().eq('id', testTenantId);
      }
    } catch {}
  });

  test('should reject unauthenticated requests to WhatsApp endpoints with 401', async ({ request }) => {
    const onboardRes = await request.get('/api/whatsapp/onboard');
    expect(onboardRes.status()).toBe(401);

    const verifRes = await request.get('/api/whatsapp/verification-code');
    expect(verifRes.status()).toBe(401);

    const superRes = await request.get('/api/superadmin/whatsapp-usage');
    expect(superRes.status()).toBe(401);
  });

  test('superadmin API returns KPI metrics and supports CSV export', async ({ request }) => {
    if (!supabaseAdmin || !superadminUserId) return;

    // Generate session token for superadmin user
    const { data: loginData } = await supabaseAdmin.auth.signInWithPassword({
      email: testSuperadminEmail,
      password: 'password123',
    });

    expect(loginData.session).toBeTruthy();
    const token = loginData.session!.access_token;

    // 1. Test JSON response
    const res = await request.get('/api/superadmin/whatsapp-usage', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.kpis).toBeDefined();
    expect(body.kpis.totalAccounts).toBeGreaterThanOrEqual(1);
    expect(body.accounts).toBeInstanceOf(Array);
    expect(body.dailyUsage).toBeInstanceOf(Array);

    // 2. Test CSV Export format
    const csvRes = await request.get('/api/superadmin/whatsapp-usage?export=csv', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(csvRes.status()).toBe(200);
    expect(csvRes.headers()['content-type']).toContain('text/csv');
    const csvText = await csvRes.text();
    expect(csvText).toContain('Date,Tenant ID,Salon Name,Inbound,Outbound Freeform');
  });

  test('dashboard renders WhatsApp & Meta channel with Embedded Signup v4 and starter templates', async ({ page }) => {
    // 1. Sign in as the salon owner
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(testOwnerEmail);
    await page.locator('input[type="password"]').fill('password123');
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // 2. Verify sidebar shows active WhatsApp & Meta navigation item (not locked or unavailable)
    const whatsappNav = page.locator('button', { hasText: /WhatsApp & Meta/i });
    await expect(whatsappNav).toBeVisible();
    await whatsappNav.click();

    // 3. Verify WhatsApp Setup sub-tab and header elements
    await expect(page.getByText('Meta Messaging Channels')).toBeVisible();
    await expect(page.getByText('Embedded Signup v4').first()).toBeVisible();

    // 4. Verify 3 pre-approved starter templates (en_GB)
    await expect(page.getByText('Pre-Approved Starter Templates (en_GB)')).toBeVisible();
    await expect(page.getByText('appointment_reminder')).toBeVisible();
    await expect(page.getByText('booking_link')).toBeVisible();
    await expect(page.getByText('missed_call_followup')).toBeVisible();

    // 5. Verify 24-Hour Free-Form Customer Service Window notice
    await expect(page.getByText('24-Hour Free-Form Customer Service Window Active')).toBeVisible();

    // 6. Verify missing payment card alert banner (since test account has card_missing: true)
    await expect(page.getByText('Payment Card Required in Meta WhatsApp Manager')).toBeVisible();
    await expect(page.getByRole('link', { name: /Add Card in WhatsApp Manager/i })).toBeVisible();
  });

  test('superadmin god mode displays WhatsApp Intelligence tab and usage tables', async ({ page }) => {
    // 1. Sign in as superadmin
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(testSuperadminEmail);
    await page.locator('input[type="password"]').fill('password123');
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // 2. Navigate to /superadmin
    await page.goto('/superadmin');
    await expect(page).toHaveURL(/\/superadmin/, { timeout: 10000 });

    // 3. Click the "💬 WhatsApp" tab
    const whatsappTab = page.locator('button', { hasText: '💬 WhatsApp' });
    await expect(whatsappTab).toBeVisible();
    await whatsappTab.click();

    // 4. Verify WhatsApp Intelligence dashboard
    await expect(page.getByText('WhatsApp Business Platform Intelligence')).toBeVisible();
    await expect(page.getByText('Connected Salons')).toBeVisible();
    await expect(page.getByText('Card Missing (Meta)')).toBeVisible();
    await expect(page.getByText('Active WhatsApp Salon Accounts')).toBeVisible();
    await expect(page.getByText('Daily Usage & Category Breakdown')).toBeVisible();

    // 5. Verify CSV export button is present
    await expect(page.getByRole('button', { name: /Export to CSV/i })).toBeVisible();
  });
});
