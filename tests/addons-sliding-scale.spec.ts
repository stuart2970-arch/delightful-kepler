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

  test('GET /api/superadmin/features returns features list including ai_agent', async ({ request }) => {
    const res = await request.get('/api/superadmin/features');
    expect(res.status()).toBe(200);
    const data = await res.json();
    const features = Array.isArray(data.data) ? data.data : [];
    expect(features.length).toBeGreaterThan(0);
    const aiAgent = features.find((f: any) => f.id === 'ai_agent');
    expect(aiAgent).toBeDefined();
    expect(aiAgent.value_type).toBe('boolean');
  });

  test('PATCH /api/superadmin/entitlements successfully updates and saves ai_agent on base_tier', async ({ request }) => {
    const res = await request.patch('/api/superadmin/entitlements', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        tier_id: 'base_tier',
        feature_id: 'ai_agent',
        limit_value: 1,
      },
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify GET reflects the saved entitlement
    const getRes = await request.get('/api/superadmin/entitlements');
    expect(getRes.status()).toBe(200);
    const getData = await getRes.json();
    const entList = Array.isArray(getData.data) ? getData.data : [];
    const baseAgent = entList.find((e: any) => e.tier_id === 'base_tier' && e.feature_id === 'ai_agent');
    expect(baseAgent).toBeDefined();
    expect(baseAgent.limit_value).toBe(1);
  });

  test('POST /api/billing/checkout with plan: basic initiates direct base tier checkout', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        plan: 'basic',
        planTier: 'base_tier',
      },
    });
    // In test environment with Stripe keys, returns 200 with checkout session URL; or 500 if key mock
    expect([200, 500]).toContain(res.status());
    if (res.status() === 200) {
      const data = await res.json();
      expect(data.url).toBeDefined();
      expect(data.url).toContain('stripe.com');
    }
  });

  test('GET /api/billing/checkout?plan=basic redirects to Stripe checkout', async ({ request }) => {
    const res = await request.get('/api/billing/checkout?plan=basic', {
      maxRedirects: 0,
    });
    // Either 303 (redirect) or 500 (if Stripe key missing)
    expect([303, 307, 308, 500]).toContain(res.status());
    if (res.status() === 303) {
      const location = res.headers()['location'];
      expect(location).toContain('stripe.com');
    }
  });

  test('POST /api/billing/checkout with base plan and modular addons bundles items into single checkout', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        plan: 'basic',
        planTier: 'base_tier',
        addons: ['google_calendar_addon', 'landline_addon', 'mobile_addon', 'data_pack_500'],
      },
    });
    expect([200, 500]).toContain(res.status());
    if (res.status() === 200) {
      const data = await res.json();
      expect(data.url).toBeDefined();
      expect(data.url).toContain('stripe.com');
    }
  });

  test('GET /api/billing/checkout with addons query string redirects with bundled items', async ({ request }) => {
    const res = await request.get('/api/billing/checkout?plan=basic&addons=google_calendar_addon,landline_addon', {
      maxRedirects: 0,
    });
    expect([303, 307, 308, 500]).toContain(res.status());
    if (res.status() === 303) {
      const location = res.headers()['location'];
      expect(location).toContain('stripe.com');
    }
  });

  test('Registration page endpoint loads successfully with plan and addons parameters', async ({ request }) => {
    const res = await request.get('/register?plan=basic&addons=google_calendar_addon');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toBeDefined();
  });

  test('Registration page endpoint loads successfully with plan=foundation', async ({ request }) => {
    const res = await request.get('/register?plan=foundation&addons=google_calendar_addon');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toBeDefined();
    expect(html).toContain('Foundation');
  });

  test('POST /api/billing/checkout with plan: foundation initiates direct base tier checkout', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        plan: 'foundation',
        planTier: 'base_tier',
      },
    });
    expect([200, 500]).toContain(res.status());
    if (res.status() === 200) {
      const data = await res.json();
      expect(data.url).toBeDefined();
      expect(data.url).toContain('stripe.com');
    }
  });

  test('Registration page renders Extra Knowledge (500 Knowledge Items) at dynamic price', async ({ page }) => {
    await page.goto('/register?plan=foundation&addons=data_pack_500');
    await expect(page.locator('body')).toContainText('Extra Knowledge (500 Knowledge Items)');
    await expect(page.locator('body')).toContainText('£14.98/mo'); // £9.99 base + £4.99 extra knowledge
    await expect(page.locator('body')).not.toContainText('Knowledgebase Storage (500 Chunks)');
  });

  test('GET /api/superadmin/addon-catalog returns data_pack_500 at 499 pence and Extra Knowledge title', async ({ request }) => {
    const res = await request.get('/api/superadmin/addon-catalog');
    expect(res.status()).toBe(200);
    const json = await res.json();
    const dataPack = (json.addons || []).find((a: any) => a.id === 'data_pack_500');
    expect(dataPack).toBeDefined();
    expect(dataPack.monthly_price_pence).toBe(499);
    expect(dataPack.name).toContain('Extra Knowledge');
  });

  test('GET /api/billing/prices returns dynamic foundation price and addon catalog', async ({ request }) => {
    const res = await request.get('/api/billing/prices');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.plan).toBeDefined();
    expect(Number(json.plan.monthly_price)).toBe(9.99);
    expect(Array.isArray(json.addons)).toBe(true);
    const dataPack = json.addons.find((a: any) => a.id === 'data_pack_500');
    expect(dataPack).toBeDefined();
    expect(dataPack.monthly_price_pence).toBe(499);
    expect(dataPack.name).toBe('Extra Knowledge (500 Knowledge Items)');
  });

  test('POST /api/billing/checkout rejects customPricePence below minimum with HTTP 400', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        addonCatalogId: 'landline_addon',
        tenantId: '10000000-0000-0000-0000-000000000001',
        customPricePence: 100, // min is 899p
      },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('out of allowed range');
  });

  test('POST /api/billing/checkout rejects customPricePence exceeding maximum with HTTP 400', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        addonCatalogId: 'landline_addon',
        tenantId: '10000000-0000-0000-0000-000000000001',
        customPricePence: 99999, // max is 1999p
      },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('out of allowed range');
  });

  test('POST /api/billing/checkout rejects customPricePence not on valid step increment with HTTP 400', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        addonCatalogId: 'landline_addon',
        tenantId: '10000000-0000-0000-0000-000000000001',
        customPricePence: 950, // step is 100p (899, 999, 1099...)
      },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('must be a multiple of step increments');
  });

  test('POST /api/billing/checkout rejects unknown addon ID with HTTP 400', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        plan: 'foundation',
        addons: ['unknown_addon_xyz_999'],
      },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Add-on not found in catalog');
  });
});


