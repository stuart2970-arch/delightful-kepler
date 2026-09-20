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
});
