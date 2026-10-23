import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestNormalUser, createTestSuperadminUser, TestUserSession } from './test-auth-helper';
import {
  resolveChatFooter,
  DEFAULT_STYLEFLO_BRANDING_HTML,
  REMOVE_STYLEFLO_BRANDING_ADDON_ID,
} from '../src/lib/billing/branding';

const AI_NOTICE = 'This conversation uses an AI assistant and may be transcribed.';
const WIDGET_ID = 'styl193-widget';

function widgetConfig(hide: boolean) {
  return {
    name: 'Test Salon',
    primaryColor: '#260475',
    agentName: 'Flo',
    agentRole: 'AI Assistant',
    welcomeMessage: 'Hello',
    brandingHtml: '',
    hideStyleFloBranding: hide,
    globalVoiceDisclaimer: AI_NOTICE,
    voiceEnabled: false,
    fileUploadEnabled: false,
    requireClientName: false,
    termsVersion: '1.0',
  };
}

async function openWidget(page: import('@playwright/test').Page, hide: boolean) {
  await page.route(`**/api/chatbots/${WIDGET_ID}*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(widgetConfig(hide)),
    });
  });
  await page.goto('/login');
  await page.evaluate((id) => {
    const script = document.createElement('script');
    script.src = '/widget.js';
    script.setAttribute('data-chatbot-id', id);
    script.setAttribute('data-api-host', window.location.origin);
    document.body.appendChild(script);
  }, WIDGET_ID);
  const host = page.locator('#styleflo-chat-widget');
  await expect(host).toBeAttached({ timeout: 10000 });
  await host.locator('button').first().evaluate((button: HTMLButtonElement) => button.click());
  await expect(host.locator('.styleflo-chat-window')).toBeVisible({ timeout: 10000 });
  const html = await host.evaluate((element) => (element as HTMLElement).shadowRoot?.innerHTML || '');
  return { host, html };
}

test.describe('STYL-193 chat footer', () => {
  test('an empty branding value still shows the footer, and the hide flag removes only that footer', () => {
    const shown = resolveChatFooter({ hideStyleFloBranding: false, brandingHtml: '' });
    expect(shown.hide).toBe(false);
    expect(shown.html).toBe(DEFAULT_STYLEFLO_BRANDING_HTML);
    expect(shown.html).toContain('Powered by');

    const hidden = resolveChatFooter({ hideStyleFloBranding: true, brandingHtml: '' });
    expect(hidden.hide).toBe(true);
    expect(hidden.html).toContain('Powered by');
  });

  test('the footer and its tracking link show when the salon has not bought the bolt-on', async ({ page }) => {
    const { host, html } = await openWidget(page, false);
    expect(html).toContain('id="styleflo-branding-footer"');
    expect(html).toContain('/api/track');
    expect(html).toContain('Powered by');
    expect(html).toContain('Terms');
    expect(html).toContain('Privacy Policy');
    expect(html).toContain('Please read before you start');
    expect(html).toContain(AI_NOTICE);
    await expect(host.getByText('Powered by')).toBeVisible();
    await expect(host.getByRole('link', { name: 'Terms' })).toBeVisible();
    await expect(host.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
    await expect(host.getByText(AI_NOTICE)).toBeVisible();
  });

  test('the bolt-on hides the footer and tracking link, and the legal and AI notice stay', async ({ page }) => {
    const { host, html } = await openWidget(page, true);
    expect(html).not.toContain('styleflo-branding-footer');
    expect(html).not.toContain('/api/track');
    expect(html).not.toContain('Powered by');
    expect(html).toContain('Terms');
    expect(html).toContain('Privacy Policy');
    expect(html).toContain('Please read before you start');
    expect(html).toContain(AI_NOTICE);
    await expect(host.getByRole('link', { name: 'Terms' })).toBeVisible();
    await expect(host.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
    await expect(host.getByText(AI_NOTICE)).toBeVisible();
    await expect(host.getByText('Powered by')).toHaveCount(0);
  });
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GLOBEX = '10000000-0000-0000-0000-000000000002';
const CHATBOT = 'c1930000-0000-4000-8000-000000000193';

test.describe('STYL-193 branding bolt-on ownership and catalogue price', () => {
  let user: TestUserSession;
  let superadmin: TestUserSession;
  let originalPrice = 499;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  test.beforeAll(async () => {
    user = await createTestNormalUser(GLOBEX);
    superadmin = await createTestSuperadminUser();
    const { data: catalog } = await admin
      .from('addon_catalog')
      .select('monthly_price_pence')
      .eq('id', REMOVE_STYLEFLO_BRANDING_ADDON_ID)
      .maybeSingle();
    if (catalog?.monthly_price_pence != null) originalPrice = catalog.monthly_price_pence;
    await admin.from('chatbots').delete().eq('id', CHATBOT);
    const { error } = await admin.from('chatbots').insert({
      id: CHATBOT,
      tenant_id: GLOBEX,
      name: 'Branding test',
      configuration_json: {},
      primary_color: '#260475',
    });
    if (error) throw new Error(error.message);
  });

  test.afterAll(async () => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', REMOVE_STYLEFLO_BRANDING_ADDON_ID);
    await admin.from('tenant_addon_inclusions').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', REMOVE_STYLEFLO_BRANDING_ADDON_ID);
    await admin.from('chatbots').delete().eq('id', CHATBOT);
    await admin.from('addon_catalog').update({
      monthly_price_pence: originalPrice,
      max_price_pence: originalPrice,
      is_sliding: false,
    }).eq('id', REMOVE_STYLEFLO_BRANDING_ADDON_ID);
    if (user) await user.cleanup();
    if (superadmin) await superadmin.cleanup();
  });

  test.beforeEach(async () => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', REMOVE_STYLEFLO_BRANDING_ADDON_ID);
    await admin.from('tenant_addon_inclusions').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', REMOVE_STYLEFLO_BRANDING_ADDON_ID);
  });

  test('a Foundation salon keeps the footer until they buy the bolt-on or it is included', async ({ request }) => {
    const { data: tenant } = await admin.from('tenants').select('plan_tier').eq('id', GLOBEX).single();
    const { error: tierError } = await admin.from('tenants').update({ plan_tier: 'premium' }).eq('id', GLOBEX);
    expect(tierError).toBeNull();
    try {
      const premium = await request.get(`/api/chatbots/${CHATBOT}`);
      expect(premium.status()).toBe(200);
      const premiumBody = await premium.json();
      expect(premiumBody.hideStyleFloBranding).toBe(false);
      expect(premiumBody.brandingHtml).toContain('Powered by');
    } finally {
      await admin.from('tenants').update({ plan_tier: tenant?.plan_tier || 'foundation' }).eq('id', GLOBEX);
    }

    const plain = await request.get(`/api/chatbots/${CHATBOT}`);
    const plainBody = await plain.json();
    expect(plainBody.hideStyleFloBranding).toBe(false);

    const { error: purchaseError } = await admin.from('tenant_active_addons').insert({
      tenant_id: GLOBEX,
      addon_catalog_id: REMOVE_STYLEFLO_BRANDING_ADDON_ID,
      feature_id: 'remove_branding',
      quantity: 1,
      is_active: true,
      price_paid_pence: 350,
    });
    expect(purchaseError).toBeNull();

    const bought = await request.get(`/api/chatbots/${CHATBOT}`);
    const boughtBody = await bought.json();
    expect(boughtBody.hideStyleFloBranding).toBe(true);
    expect(boughtBody.brandingHtml).toContain('Powered by');

    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', REMOVE_STYLEFLO_BRANDING_ADDON_ID);
    const { error: includeError } = await admin.from('tenant_addon_inclusions').insert({
      tenant_id: GLOBEX,
      addon_catalog_id: REMOVE_STYLEFLO_BRANDING_ADDON_ID,
      included: true,
      price_paid_pence: 0,
    });
    expect(includeError).toBeNull();
    const included = await request.get(`/api/chatbots/${CHATBOT}`);
    expect((await included.json()).hideStyleFloBranding).toBe(true);

    await admin.from('tenant_addon_inclusions').update({ included: false }).eq('tenant_id', GLOBEX).eq('addon_catalog_id', REMOVE_STYLEFLO_BRANDING_ADDON_ID);
    const off = await request.get(`/api/chatbots/${CHATBOT}`);
    expect((await off.json()).hideStyleFloBranding).toBe(false);
  });

  test('the price comes from the catalogue, including after a superadmin edit, and checkout uses it', async ({ request }) => {
    const listed = await request.get('/api/billing/addons?category=remove_branding');
    expect(listed.status()).toBe(200);
    const addons = await listed.json();
    const row = (Array.isArray(addons) ? addons : []).find((item: { id: string }) => item.id === REMOVE_STYLEFLO_BRANDING_ADDON_ID);
    expect(row.monthly_price_pence).toBe(499);
    expect(row.name).toBe('Remove StyleFlo branding');

    const accountBefore = await request.get('/api/billing/account', {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    const beforeBody = await accountBefore.json();
    const beforeCard = beforeBody.monthly_bolt_ons.find((item: { id: string }) => item.id === REMOVE_STYLEFLO_BRANDING_ADDON_ID);
    expect(beforeCard.catalogue_price_pence).toBe(499);
    expect(beforeCard.price_label).toBe('£4.99/mo');
    expect(beforeCard.billing).toBe('monthly');
    expect(beforeCard.already_included).toBe(false);

    const patched = await request.patch('/api/superadmin/addon-catalog', {
      headers: { Authorization: `Bearer ${superadmin.token}`, 'Content-Type': 'application/json' },
      data: {
        type: 'addon',
        id: REMOVE_STYLEFLO_BRANDING_ADDON_ID,
        updates: { monthly_price_pence: 650, max_price_pence: 650, is_sliding: false },
        summary: 'Test price change for Remove StyleFlo branding.',
      },
    });
    expect(patched.status()).toBe(200);

    try {
      const relisted = await request.get('/api/billing/addons?category=remove_branding');
      const next = (await relisted.json()).find((item: { id: string }) => item.id === REMOVE_STYLEFLO_BRANDING_ADDON_ID);
      expect(next.monthly_price_pence).toBe(650);

      const account = await request.get('/api/billing/account', {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      const card = (await account.json()).monthly_bolt_ons.find((item: { id: string }) => item.id === REMOVE_STYLEFLO_BRANDING_ADDON_ID);
      expect(card.catalogue_price_pence).toBe(650);
      expect(card.price_label).toBe('£6.50/mo');

      const checkout = await request.post('/api/billing/checkout', {
        data: {
          addonCatalogId: REMOVE_STYLEFLO_BRANDING_ADDON_ID,
          tenantId: GLOBEX,
        },
      });
      expect(checkout.status()).toBe(200);
      const checkoutBody = await checkout.json();
      expect(checkoutBody.cataloguePricePence).toBe(650);
    } finally {
      await admin.from('addon_catalog').update({
        monthly_price_pence: 499,
        max_price_pence: 499,
        is_sliding: false,
      }).eq('id', REMOVE_STYLEFLO_BRANDING_ADDON_ID);
    }
  });
});
