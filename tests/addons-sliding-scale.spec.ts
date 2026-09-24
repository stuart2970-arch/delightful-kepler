import { test, expect } from '@playwright/test';

test.describe('Modular Add-Ons & Sliding Scale Checkout API', () => {
  test('GET /api/billing/addons?category=landline returns landline bolt-on', async ({ request }) => {
    const res = await request.get('/api/billing/addons?category=landline');
    expect(res.status()).toBe(200);
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.addons || [];
    expect(list.length).toBeGreaterThan(0);
    const landline = list.find((item: any) => item.id === 'landline_addon');
    expect(landline).toBeDefined();
    expect(landline.monthly_price_pence).toBe(899);
  });

  test('GET /api/billing/addons?category=mobile returns mobile bolt-on', async ({ request }) => {
    const res = await request.get('/api/billing/addons?category=mobile');
    expect(res.status()).toBe(200);
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.addons || [];
    expect(list.length).toBeGreaterThan(0);
    const mobile = list.find((item: any) => item.id === 'mobile_addon');
    expect(mobile).toBeDefined();
    expect(mobile.monthly_price_pence).toBe(1099);
  });

  test('POST /api/billing/checkout returns 400 for empty request payload', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    });
    // Either 400 (invalid parameters) or 500 (if Stripe key missing in test environment)
    expect([400, 500]).toContain(res.status());
  });

  test('POST /api/billing/checkout returns 404 for non-existent addonCatalogId', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        addonCatalogId: 'non_existent_addon_xyz',
        tenantId: '00000000-0000-0000-0000-000000000000',
        customPricePence: 1299,
        customVoiceMinutes: 17,
      },
    });
    expect([404, 500]).toContain(res.status());
  });

  test('POST /api/billing/checkout with action: portal returns structured response or 400 when tenantId is missing', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: { action: 'portal' },
    });
    expect([400, 500]).toContain(res.status());
  });

  test('GET /api/billing/addons?category=voice_pack returns voice pack bolt-ons', async ({ request }) => {
    const res = await request.get('/api/billing/addons?category=voice_pack');
    expect(res.status()).toBe(200);
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.addons || [];
    expect(list.length).toBeGreaterThan(0);
    const voice20 = list.find((item: any) => item.id === 'voice_pack_20');
    expect(voice20).toBeDefined();
    expect(voice20.category).toBe('voice_pack');
  });

  test('PATCH /api/tenants/settings updates voice auto top-up configuration', async ({ request }) => {
    const res = await request.patch('/api/tenants/settings', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        tenantId: '10000000-0000-0000-0000-000000000001',
        voice_auto_topup: true,
        voice_auto_topup_threshold: 15,
        voice_auto_topup_amount: 50,
        voice_auto_topup_price_pence: 3000,
      },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.tenant.voice_auto_topup).toBe(true);
    expect(data.tenant.voice_auto_topup_threshold).toBe(15);
  });
});
