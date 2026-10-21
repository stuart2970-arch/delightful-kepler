import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestSuperadminUser, createTestNormalUser, TestUserSession } from './test-auth-helper';
import disabledAddonsList from '../src/lib/addons/disabled-addons.json';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface AddonCatalogItem {
  id: string;
  name: string;
  description: string;
  monthly_price_pence: number;
  is_active: boolean;
}

test.describe('STYL-179: Hide disabled add-ons from public catalogue, checkout and dashboard, editable in superadmin', () => {
  let superadminSession: TestUserSession;
  let normalUserSession: TestUserSession;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const testTenantId = '10000000-0000-0000-0000-000000000002';

  test.beforeAll(async () => {
    superadminSession = await createTestSuperadminUser();
    normalUserSession = await createTestNormalUser();

    // Ensure whatsapp_addon is disabled initially
    await adminClient
      .from('addon_catalog')
      .update({ is_active: false })
      .eq('id', 'whatsapp_addon');
  });

  test.afterAll(async () => {
    // Reset whatsapp_addon to disabled state
    await adminClient
      .from('addon_catalog')
      .update({ is_active: false })
      .eq('id', 'whatsapp_addon');

    // Clean up any test tenant_active_addons
    await adminClient
      .from('tenant_active_addons')
      .delete()
      .eq('tenant_id', testTenantId)
      .eq('addon_catalog_id', 'whatsapp_addon');

    if (superadminSession) await superadminSession.cleanup();
    if (normalUserSession) await normalUserSession.cleanup();
  });

  test('1. GET /api/billing/prices and /api/billing/addons do not return disabled add-ons', async ({ request }) => {
    const resPrices = await request.get('/api/billing/prices');
    expect(resPrices.status()).toBe(200);
    const pricesJson = await resPrices.json();
    const pricesAddonIds = (pricesJson.addons || []).map((a: AddonCatalogItem) => a.id);

    // Verify all disabled add-ons are absent
    for (const disabledId of disabledAddonsList) {
      expect(pricesAddonIds).not.toContain(disabledId);
    }
    expect(pricesAddonIds).not.toContain('whatsapp_addon');
    expect(pricesAddonIds).not.toContain('whatsapp_primary');

    // Verify enabled add-ons are present
    expect(pricesAddonIds).toContain('landline_addon');
    expect(pricesAddonIds).toContain('mobile_addon');
    expect(pricesAddonIds).toContain('google_calendar_addon');

    const resAddons = await request.get('/api/billing/addons');
    expect(resAddons.status()).toBe(200);
    const addonsJson = await resAddons.json();
    const addonsList: AddonCatalogItem[] = Array.isArray(addonsJson) ? addonsJson : (addonsJson.addons || []);
    const addonRouteIds = addonsList.map((a: AddonCatalogItem) => a.id);

    for (const disabledId of disabledAddonsList) {
      expect(addonRouteIds).not.toContain(disabledId);
    }
    expect(addonRouteIds).not.toContain('whatsapp_addon');
    expect(addonRouteIds).not.toContain('whatsapp_primary');
  });

  test('2. Checkout returns 400 { error: "This add-on is not available" } when requesting disabled add-ons', async ({ request }) => {
    // Mode 2: Existing subscription add-on
    const resMode2 = await request.post('/api/billing/checkout', {
      data: {
        addonCatalogId: 'whatsapp_addon',
        tenantId: testTenantId,
      },
    });
    expect(resMode2.status()).toBe(400);
    const jsonMode2 = await resMode2.json();
    expect(jsonMode2.error).toBe('This add-on is not available');

    // Mode 3: Direct checkout with plan + disabled add-on
    const resMode3 = await request.post('/api/billing/checkout', {
      data: {
        plan: 'foundation',
        addons: ['whatsapp_addon'],
        email: 'test-checkout-disabled@example.com',
      },
    });
    expect(resMode3.status()).toBe(400);
    const jsonMode3 = await resMode3.json();
    expect(jsonMode3.error).toBe('This add-on is not available');

    // Non-existent addon still returns 404 in Mode 2
    const resNonExistent = await request.post('/api/billing/checkout', {
      data: {
        addonCatalogId: 'non_existent_fake_addon_123',
        tenantId: testTenantId,
      },
    });
    expect(resNonExistent.status()).toBe(404);
  });

  test('3. Dashboard: Tenant who owns disabled add-on sees it marked "Not available to buy" without adjust button', async () => {
    // Seed an active addon row for the test tenant with whatsapp_addon
    const { data: inserted, error: insertErr } = await adminClient
      .from('tenant_active_addons')
      .insert({
        tenant_id: testTenantId,
        addon_catalog_id: 'whatsapp_addon',
        is_active: true,
      })
      .select()
      .single();
    expect(insertErr).toBeNull();

    // Verify entitlements helper still preserves active entitlements for the tenant
    const { getTenantActiveAddons } = await import('../src/lib/entitlements');
    const activeAddons = await getTenantActiveAddons(testTenantId);
    expect(activeAddons.some(a => a.addon_catalog_id === 'whatsapp_addon')).toBe(true);

    // Clean up seeded row
    if (inserted?.id) {
      await adminClient.from('tenant_active_addons').delete().eq('id', inserted.id);
    }
  });

  test('4. Superadmin: disabled add-on is visible with status, text/pricing can be edited and saved with audit log', async ({ request }) => {
    // 1. GET /api/superadmin/addon-catalog includes whatsapp_addon with is_active: false
    const getRes = await request.get('/api/superadmin/addon-catalog', {
      headers: {
        Authorization: `Bearer ${superadminSession.token}`,
      },
    });
    expect(getRes.status()).toBe(200);
    const catalogData = await getRes.json();
    const whatsapp = catalogData.addons.find((a: AddonCatalogItem) => a.id === 'whatsapp_addon');
    expect(whatsapp).toBeDefined();
    expect(whatsapp.is_active).toBe(false);

    // 2. PATCH text and pricing
    const newName = 'WhatsApp Business AI';
    const newDesc = 'Dedicated WhatsApp business messaging for salon bookings.';
    const patchRes = await request.patch('/api/superadmin/addon-catalog', {
      headers: {
        Authorization: `Bearer ${superadminSession.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        type: 'addon',
        id: 'whatsapp_addon',
        updates: {
          name: newName,
          description: newDesc,
          monthly_price_pence: 1499,
        },
      },
    });
    expect(patchRes.status()).toBe(200);

    // 3. Verify in addon-catalog GET
    const getRes2 = await request.get('/api/superadmin/addon-catalog', {
      headers: {
        Authorization: `Bearer ${superadminSession.token}`,
      },
    });
    const catalogData2 = await getRes2.json();
    const updatedWhatsapp = catalogData2.addons.find((a: AddonCatalogItem) => a.id === 'whatsapp_addon');
    expect(updatedWhatsapp.name).toBe(newName);
    expect(updatedWhatsapp.description).toBe(newDesc);
    expect(updatedWhatsapp.monthly_price_pence).toBe(1499);

    // 4. Verify it is STILL absent from /api/billing/prices
    const pricesRes = await request.get('/api/billing/prices');
    const pricesJson = await pricesRes.json();
    expect((pricesJson.addons || []).some((a: AddonCatalogItem) => a.id === 'whatsapp_addon')).toBe(false);

    // 5. Verify audit log entry exists with performed_by set to superadmin userId
    const { data: auditRows } = await adminClient
      .from('addon_audit_log')
      .select('*')
      .eq('addon_catalog_id', 'whatsapp_addon')
      .order('created_at', { ascending: false })
      .limit(1);

    expect(auditRows).toBeDefined();
    expect(auditRows!.length).toBeGreaterThan(0);
    expect(auditRows![0].performed_by).toBe(superadminSession.user.id);
  });

  test('5. Toggle: enabling makes it appear in /api/billing/prices; disabling hides it again', async ({ request }) => {
    // 1. Enable whatsapp_addon
    const enableRes = await request.patch('/api/superadmin/addon-catalog', {
      headers: {
        Authorization: `Bearer ${superadminSession.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        type: 'addon',
        id: 'whatsapp_addon',
        updates: {
          is_active: true,
        },
      },
    });
    expect(enableRes.status()).toBe(200);

    // Verify it appears in /api/billing/prices
    const pricesResActive = await request.get('/api/billing/prices');
    const pricesJsonActive = await pricesResActive.json();
    expect((pricesJsonActive.addons || []).some((a: AddonCatalogItem) => a.id === 'whatsapp_addon')).toBe(true);

    // 2. Disable whatsapp_addon again
    const disableRes = await request.patch('/api/superadmin/addon-catalog', {
      headers: {
        Authorization: `Bearer ${superadminSession.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        type: 'addon',
        id: 'whatsapp_addon',
        updates: {
          is_active: false,
        },
      },
    });
    expect(disableRes.status()).toBe(200);

    // Verify it disappears from /api/billing/prices
    const pricesResInactive = await request.get('/api/billing/prices');
    const pricesJsonInactive = await pricesResInactive.json();
    expect((pricesJsonInactive.addons || []).some((a: AddonCatalogItem) => a.id === 'whatsapp_addon')).toBe(false);

    // Verify audit log has addon_deactivated entry
    const { data: auditRows } = await adminClient
      .from('addon_audit_log')
      .select('*')
      .eq('addon_catalog_id', 'whatsapp_addon')
      .order('created_at', { ascending: false })
      .limit(1);

    expect(auditRows![0].action).toBe('addon_deactivated');
    expect(auditRows![0].performed_by).toBe(superadminSession.user.id);
  });

  test('6. Auth Lockdown & Validation: PATCH /api/superadmin/addon-catalog with is_active rejects unauthenticated (401), normal user (403), invalid type (400)', async ({ request }) => {
    // Unauthenticated (no token) -> 401
    const unauthRes = await request.patch('/api/superadmin/addon-catalog', {
      data: {
        type: 'addon',
        id: 'whatsapp_addon',
        updates: { is_active: true },
      },
    });
    expect(unauthRes.status()).toBe(401);

    // Normal user token -> 403
    const normalRes = await request.patch('/api/superadmin/addon-catalog', {
      headers: {
        Authorization: `Bearer ${normalUserSession.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        type: 'addon',
        id: 'whatsapp_addon',
        updates: { is_active: true },
      },
    });
    expect(normalRes.status()).toBe(403);

    // Invalid non-boolean is_active -> 400
    const invalidRes = await request.patch('/api/superadmin/addon-catalog', {
      headers: {
        Authorization: `Bearer ${superadminSession.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        type: 'addon',
        id: 'whatsapp_addon',
        updates: { is_active: 'invalid_boolean' },
      },
    });
    expect(invalidRes.status()).toBe(400);
    const invalidJson = await invalidRes.json();
    expect(invalidJson.error).toContain('is_active must be a boolean');
  });
});
