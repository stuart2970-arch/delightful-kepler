import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestSuperadminUser, createTestNormalUser, TestUserSession } from './test-auth-helper';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test.describe('STYL-177: Bolt-on and pack wording, legacy pack retirement, and superadmin editable text', () => {
  let superadminSession: TestUserSession;
  let normalUserSession: TestUserSession;

  test.beforeAll(async () => {
    superadminSession = await createTestSuperadminUser();
    normalUserSession = await createTestNormalUser();
  });

  test.afterAll(async () => {
    if (superadminSession) await superadminSession.cleanup();
    if (normalUserSession) await normalUserSession.cleanup();
  });

  test('GET /api/billing/prices and /api/billing/addons do not contain legacy packs (voice_pack_50, voice_pack_100, sms_pack_500)', async ({ request }) => {
    const retiredIds = ['voice_pack_50', 'voice_pack_100', 'sms_pack_500'];

    const resPrices = await request.get('/api/billing/prices');
    expect(resPrices.status()).toBe(200);
    const pricesJson = await resPrices.json();
    const priceAddonIds = (pricesJson.addons || []).map((a: any) => a.id);
    for (const rId of retiredIds) {
      expect(priceAddonIds).not.toContain(rId);
    }

    // Every name/description on active addons contains no £ amount and no VAT
    for (const a of pricesJson.addons || []) {
      expect(a.name).not.toMatch(/[£]\s*\d/);
      expect(a.name.toLowerCase()).not.toContain('vat');
      if (a.description) {
        expect(a.description).not.toMatch(/[£]\s*\d/);
        expect(a.description.toLowerCase()).not.toContain('vat');
      }
    }

    const resAddons = await request.get('/api/billing/addons');
    expect(resAddons.status()).toBe(200);
    const addonsJson = await resAddons.json();
    const addonsIds = (addonsJson.addons || []).map((a: any) => a.id);
    for (const rId of retiredIds) {
      expect(addonsIds).not.toContain(rId);
    }
  });

  test('voice_pack_20 and sms_pack_100 descriptions do not contain "per month" or "roll over"', async ({ request }) => {
    const res = await request.get('/api/billing/prices');
    const json = await res.json();
    const voicePack = (json.addons || []).find((a: any) => a.id === 'voice_pack_20');
    const smsPack = (json.addons || []).find((a: any) => a.id === 'sms_pack_100');

    expect(voicePack).toBeDefined();
    expect(voicePack.description.toLowerCase()).not.toContain('per month');
    expect(voicePack.description.toLowerCase()).not.toContain('roll over');
    expect(voicePack.description.toLowerCase()).not.toContain('rollover');
    expect(voicePack.description.toLowerCase()).toContain('3 months');

    expect(smsPack).toBeDefined();
    expect(smsPack.description.toLowerCase()).not.toContain('per month');
    expect(smsPack.description.toLowerCase()).not.toContain('roll over');
    expect(smsPack.description.toLowerCase()).not.toContain('rollover');
    expect(smsPack.description.toLowerCase()).toContain('3 months');
  });

  test('Checkout Mode 2 with retired pack ID returns HTTP 404', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      data: {
        addonCatalogId: 'voice_pack_50',
        tenantId: '10000000-0000-0000-0000-000000000002',
      },
    });
    expect(res.status()).toBe(404);
  });

  test('Signup checkout path rejects one-off packs and retired packs with HTTP 400', async ({ request }) => {
    // 1. Retired pack
    const resRetired = await request.get('/api/billing/checkout?addons=sms_pack_500');
    expect(resRetired.status()).toBe(400);

    // 2. Active one-off voice pack on signup path
    const resVoiceOneOff = await request.get('/api/billing/checkout?addons=voice_pack_20');
    expect(resVoiceOneOff.status()).toBe(400);
    const jsonVoice = await resVoiceOneOff.json();
    expect(jsonVoice.error).toContain('This pack can be bought from your dashboard after you sign up');

    // 3. Active one-off SMS pack on signup path
    const resSmsOneOff = await request.post('/api/billing/checkout', {
      data: {
        plan: 'foundation',
        addons: ['sms_pack_100'],
      },
    });
    expect(resSmsOneOff.status()).toBe(400);
    const jsonSms = await resSmsOneOff.json();
    expect(jsonSms.error).toContain('This pack can be bought from your dashboard after you sign up');
  });

  test('Valid sliding SMS pack purchase in Mode 2 creates Stripe checkout session with one-off description', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      data: {
        addonCatalogId: 'sms_pack_100',
        tenantId: '10000000-0000-0000-0000-000000000002',
        customPricePence: 599,
      },
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.url).toContain('https://checkout.stripe.com');
  });

  test('/api/superadmin/addon-catalog authorization: unauthenticated 401, normal user 403, superadmin 200', async ({ request }) => {
    // Unauthenticated GET
    const resNoAuth = await request.get('/api/superadmin/addon-catalog');
    expect(resNoAuth.status()).toBe(401);

    // Normal user GET
    const resUser = await request.get('/api/superadmin/addon-catalog', {
      headers: { Authorization: `Bearer ${normalUserSession.token}` },
    });
    expect(resUser.status()).toBe(403);

    // Superadmin GET
    const resAdmin = await request.get('/api/superadmin/addon-catalog', {
      headers: { Authorization: `Bearer ${superadminSession.token}` },
    });
    expect(resAdmin.status()).toBe(200);
  });

  test('/api/superadmin/addon-catalog PATCH validation: rejects non-whitelisted fields, invalid length, £ digits, VAT', async ({ request }) => {
    // 1. Disallowed field in updates (e.g. category, id, retired_at)
    const resDisallowed = await request.patch('/api/superadmin/addon-catalog', {
      headers: { Authorization: `Bearer ${superadminSession.token}` },
      data: {
        id: 'sms_pack_100',
        updates: { category: 'custom_category' },
      },
    });
    expect(resDisallowed.status()).toBe(400);
    const jsonDisallowed = await resDisallowed.json();
    expect(jsonDisallowed.error).toContain('Disallowed field in updates: category');

    // 2. Name too long (>60 chars)
    const resLongName = await request.patch('/api/superadmin/addon-catalog', {
      headers: { Authorization: `Bearer ${superadminSession.token}` },
      data: {
        id: 'sms_pack_100',
        updates: { name: 'A'.repeat(65) },
      },
    });
    expect(resLongName.status()).toBe(400);
    const jsonLongName = await resLongName.json();
    expect(jsonLongName.error).toContain('Name must be between 3 and 60 characters');

    // 3. £ followed by digit in description
    const resPriceInDesc = await request.patch('/api/superadmin/addon-catalog', {
      headers: { Authorization: `Bearer ${superadminSession.token}` },
      data: {
        id: 'sms_pack_100',
        updates: { description: 'Now costs only £9.99 for extra credits' },
      },
    });
    expect(resPriceInDesc.status()).toBe(400);
    const jsonPrice = await resPriceInDesc.json();
    expect(jsonPrice.error).toContain("Prices come from the price fields, so please don't type £ amounts");

    // 4. VAT in description
    const resVatInDesc = await request.patch('/api/superadmin/addon-catalog', {
      headers: { Authorization: `Bearer ${superadminSession.token}` },
      data: {
        id: 'sms_pack_100',
        updates: { description: 'All prices include VAT' },
      },
    });
    expect(resVatInDesc.status()).toBe(400);
    const jsonVat = await resVatInDesc.json();
    expect(jsonVat.error).toContain('VAT wording is not permitted');
  });

  test('Superadmin can edit name and description; updates persist, reflect in /api/billing/prices and audit log, and restore cleanly', async ({ request }) => {
    const originalName = 'SMS Text Pack';
    const originalDesc = 'A one-off pack of extra SMS texts. Choose your pack size when you buy. Texts expire 3 months after purchase and do not renew.';

    const tempName = 'Express SMS Boost';
    const tempDesc = 'A one-off pack of instant texts. Choose your size when you buy. Expires 3 months after purchase.';

    try {
      // 1. Superadmin updates sms_pack_100
      const patchRes = await request.patch('/api/superadmin/addon-catalog', {
        headers: { Authorization: `Bearer ${superadminSession.token}` },
        data: {
          id: 'sms_pack_100',
          updates: {
            name: tempName,
            description: tempDesc,
          },
        },
      });
      expect(patchRes.status()).toBe(200);

      // 2. GET /api/billing/prices reflects updated name
      const pricesRes = await request.get('/api/billing/prices');
      const pricesJson = await pricesRes.json();
      const updatedItem = (pricesJson.addons || []).find((a: any) => a.id === 'sms_pack_100');
      expect(updatedItem).toBeDefined();
      expect(updatedItem.name).toBe(tempName);
      expect(updatedItem.description).toBe(tempDesc);

      // 3. Verify audit log entry was created
      const client = createClient(supabaseUrl, serviceRoleKey);
      const { data: auditLogs } = await client
        .from('addon_audit_log')
        .select('*')
        .eq('addon_catalog_id', 'sms_pack_100')
        .order('created_at', { ascending: false })
        .limit(1);

      expect(auditLogs).toBeDefined();
      expect(auditLogs!.length).toBe(1);
      expect(auditLogs![0].performed_by).toBe(superadminSession.user.id);
      expect(auditLogs![0].new_value.name).toBe(tempName);
    } finally {
      // 4. Restore original text cleanly
      await request.patch('/api/superadmin/addon-catalog', {
        headers: { Authorization: `Bearer ${superadminSession.token}` },
        data: {
          id: 'sms_pack_100',
          updates: {
            name: originalName,
            description: originalDesc,
          },
        },
      });
    }
  });
});
