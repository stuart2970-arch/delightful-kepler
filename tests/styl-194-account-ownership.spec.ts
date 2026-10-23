import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestNormalUser, createTestSuperadminUser, TestUserSession } from './test-auth-helper';
import {
  buildAccountOwnership,
  formatPounds,
  resolvePricePaidPence,
  type CatalogAddon,
} from '../src/lib/billing/account-ownership';

const PLAN = { name: 'Foundation Subscription', price_pence: 999 };

const CATALOG: CatalogAddon[] = [
  {
    id: 'google_calendar_addon',
    name: 'Google Calendar',
    category: 'google_calendar',
    monthly_price_pence: 499,
    is_active: true,
    display_order: 1,
  },
  {
    id: 'landline_addon',
    name: 'Landline',
    category: 'landline',
    monthly_price_pence: 899,
    is_active: true,
    display_order: 2,
  },
  {
    id: 'voice_pack_20',
    name: 'Voice Minutes Pack',
    category: 'voice_pack',
    monthly_price_pence: 1500,
    is_active: true,
    is_sliding: true,
    display_order: 3,
  },
  {
    id: 'sms_pack_100',
    name: 'SMS Text Pack',
    category: 'sms_pack',
    monthly_price_pence: 599,
    is_active: true,
    display_order: 4,
  },
];

function ownership(partial: {
  purchases?: { addon_catalog_id: string; is_active: boolean; price_paid_pence: number | null }[];
  inclusions?: { addon_catalog_id: string; included: boolean; price_paid_pence: number }[];
}) {
  return buildAccountOwnership({
    plan: PLAN,
    catalog: CATALOG,
    purchases: partial.purchases || [],
    inclusions: partial.inclusions || [],
  });
}

test.describe('STYL-194 monthly total, Already included, and one-off packs', () => {
  test('grandfathered price paid is what enters the monthly total', () => {
    const result = ownership({
      purchases: [{ addon_catalog_id: 'google_calendar_addon', is_active: true, price_paid_pence: 350 }],
    });
    const google = result.monthly_bolt_ons.find((item) => item.id === 'google_calendar_addon');
    expect(google?.already_included).toBe(true);
    expect(google?.ownership).toBe('purchased');
    expect(google?.price_paid_pence).toBe(350);
    expect(google?.catalogue_price_pence).toBe(499);
    expect(google?.price_label).toBe('£3.50/mo');
    expect(result.monthly_total_pence).toBe(999 + 350);
    expect(result.heading).toBe('Current plan = Foundation + Google Calendar = £13.49');
    expect(result.heading).not.toContain('£4.99');
  });

  test('a Stripe purchase is Already included, and a superadmin include switch is too', () => {
    const bought = ownership({
      purchases: [{ addon_catalog_id: 'landline_addon', is_active: true, price_paid_pence: 899 }],
    });
    const landline = bought.monthly_bolt_ons.find((item) => item.id === 'landline_addon');
    expect(landline?.already_included).toBe(true);
    expect(landline?.ownership).toBe('purchased');

    const included = ownership({
      inclusions: [{ addon_catalog_id: 'google_calendar_addon', included: true, price_paid_pence: 0 }],
    });
    const google = included.monthly_bolt_ons.find((item) => item.id === 'google_calendar_addon');
    expect(google?.already_included).toBe(true);
    expect(google?.ownership).toBe('included');
    expect(google?.price_paid_pence).toBe(0);
    expect(included.monthly_total_pence).toBe(999);
    expect(included.heading).toContain('Google Calendar');
    expect(included.heading).toContain(formatPounds(999));
  });

  test('nothing owned leaves the total at Foundation, and a connected calendar is not an input', () => {
    const result = ownership({});
    expect(result.monthly_total_pence).toBe(999);
    expect(result.heading).toBe('Current plan = Foundation = £9.99');
    expect(result.monthly_bolt_ons.every((item) => item.already_included === false)).toBe(true);
    expect(result.active_bolt_ons).toEqual([]);
  });

  test('an inactive purchase and a switched-off include do not count', () => {
    const result = ownership({
      purchases: [{ addon_catalog_id: 'google_calendar_addon', is_active: false, price_paid_pence: 350 }],
      inclusions: [{ addon_catalog_id: 'landline_addon', included: false, price_paid_pence: 100 }],
    });
    expect(result.monthly_bolt_ons.every((item) => item.already_included === false)).toBe(true);
    expect(result.monthly_total_pence).toBe(999);
    expect(result.included_flags).toEqual([
      { addon_catalog_id: 'landline_addon', included: false, price_paid_pence: 100 },
    ]);
  });

  test('a purchase and an include switch for the same bolt-on are counted once, at the purchase price', () => {
    const result = ownership({
      purchases: [{ addon_catalog_id: 'google_calendar_addon', is_active: true, price_paid_pence: 350 }],
      inclusions: [{ addon_catalog_id: 'google_calendar_addon', included: true, price_paid_pence: 0 }],
    });
    const google = result.monthly_bolt_ons.find((item) => item.id === 'google_calendar_addon');
    expect(google?.ownership).toBe('purchased');
    expect(google?.price_paid_pence).toBe(350);
    expect(result.monthly_total_pence).toBe(999 + 350);
  });

  test('one-off voice and SMS packs stay out of the monthly total and can be bought again', () => {
    const result = ownership({
      purchases: [
        { addon_catalog_id: 'google_calendar_addon', is_active: true, price_paid_pence: 350 },
        { addon_catalog_id: 'voice_pack_20', is_active: true, price_paid_pence: 2200 },
        { addon_catalog_id: 'sms_pack_100', is_active: true, price_paid_pence: 599 },
      ],
    });
    expect(result.monthly_total_pence).toBe(999 + 350);
    expect(result.one_off_packs.map((item) => item.id)).toEqual(['voice_pack_20', 'sms_pack_100']);
    expect(result.one_off_packs.every((item) => item.already_included === false && item.billing === 'one_off')).toBe(true);
    expect(result.one_off_packs.find((item) => item.id === 'voice_pack_20')?.price_label).toBe('From £15.00');
    expect(result.active_bolt_ons.map((item) => item.addon_catalog_id)).toEqual(['google_calendar_addon']);
    expect(result.heading).not.toContain('Voice Minutes Pack');
    expect(result.heading).not.toContain('SMS Text Pack');
  });

  test('checkout price resolution prefers the custom price, then Stripe, then the catalogue', () => {
    expect(resolvePricePaidPence({ customPricePence: 350, stripeUnitAmount: 499, cataloguePricePence: 899 })).toBe(350);
    expect(resolvePricePaidPence({ stripeUnitAmount: 499, cataloguePricePence: 899 })).toBe(499);
    expect(resolvePricePaidPence({ cataloguePricePence: 899 })).toBe(899);
    expect(resolvePricePaidPence({})).toBe(0);
  });
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GLOBEX = '10000000-0000-0000-0000-000000000002';
const ACME = '10000000-0000-0000-0000-000000000001';

test.describe('STYL-196 account ownership endpoint', () => {
  let globexUser: TestUserSession;
  let superadmin: TestUserSession;
  let acmeCalendar: Record<string, unknown> | null = null;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  test.beforeAll(async () => {
    const { data } = await admin
      .from('tenant_active_addons')
      .select('*')
      .eq('tenant_id', ACME)
      .eq('addon_catalog_id', 'google_calendar_addon')
      .maybeSingle();
    acmeCalendar = data;
    globexUser = await createTestNormalUser(GLOBEX);
    superadmin = await createTestSuperadminUser();
  });

  test.afterAll(async () => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).in('addon_catalog_id', ['google_calendar_addon', 'voice_pack_20', 'landline_addon']);
    await admin.from('tenant_active_addons').delete().eq('tenant_id', ACME).eq('addon_catalog_id', 'google_calendar_addon');
    if (acmeCalendar) {
      await admin.from('tenant_active_addons').insert(acmeCalendar);
    }
    await admin.from('tenant_addon_inclusions').delete().eq('tenant_id', GLOBEX).in('addon_catalog_id', ['google_calendar_addon', 'landline_addon']);
    if (globexUser) await globexUser.cleanup();
    if (superadmin) await superadmin.cleanup();
  });

  test.beforeEach(async () => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).in('addon_catalog_id', ['google_calendar_addon', 'voice_pack_20', 'landline_addon']);
    await admin.from('tenant_active_addons').delete().eq('tenant_id', ACME).eq('addon_catalog_id', 'google_calendar_addon');
    await admin.from('tenant_addon_inclusions').delete().eq('tenant_id', GLOBEX).in('addon_catalog_id', ['google_calendar_addon', 'landline_addon']);
  });

  test('rejects a caller with no login', async ({ request }) => {
    const res = await request.get('/api/billing/account');
    expect(res.status()).toBe(401);
  });

  test('returns this login only, even when another account id is supplied', async ({ request }) => {
    const { error } = await admin.from('tenant_active_addons').insert({
      tenant_id: ACME,
      addon_catalog_id: 'google_calendar_addon',
      feature_id: 'google_calendar',
      quantity: 1,
      is_active: true,
      price_paid_pence: 111,
    });
    expect(error).toBeNull();

    const res = await request.get(`/api/billing/account?tenant_id=${ACME}`, {
      headers: { Authorization: `Bearer ${globexUser.token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.tenant_id).toBe(GLOBEX);
    const google = body.monthly_bolt_ons.find((item: { id: string }) => item.id === 'google_calendar_addon');
    expect(google.already_included).toBe(false);
    expect(body.active_bolt_ons.some((item: { addon_catalog_id: string; price_paid_pence: number }) => item.price_paid_pence === 111)).toBe(false);
  });

  test('a login with no profile gets 404', async ({ request }) => {
    const orphan = await createTestNormalUser(GLOBEX);
    await admin.from('profiles').delete().eq('id', orphan.user.id);
    const res = await request.get('/api/billing/account', {
      headers: { Authorization: `Bearer ${orphan.token}` },
    });
    expect(res.status()).toBe(404);
    await orphan.cleanup();
  });

  test('grandfathered price, one-off pack, and a calendar flag do not get mixed up', async ({ request }) => {
    const before = await request.get('/api/billing/account', {
      headers: { Authorization: `Bearer ${globexUser.token}` },
    });
    const beforeBody = await before.json();
    const beforeTotal = beforeBody.monthly_total_pence as number;

    const { data: flagRow } = await admin.from('tenants').select('has_google_calendar').eq('id', GLOBEX).single();
    await admin.from('tenants').update({ has_google_calendar: true }).eq('id', GLOBEX);

    const flagged = await request.get('/api/billing/account', {
      headers: { Authorization: `Bearer ${globexUser.token}` },
    });
    const flaggedGoogle = (await flagged.json()).monthly_bolt_ons.find((item: { id: string }) => item.id === 'google_calendar_addon');
    expect(flaggedGoogle.already_included).toBe(false);

    const { error } = await admin.from('tenant_active_addons').insert([
      {
        tenant_id: GLOBEX,
        addon_catalog_id: 'google_calendar_addon',
        feature_id: 'google_calendar',
        quantity: 1,
        is_active: true,
        price_paid_pence: 350,
      },
      {
        tenant_id: GLOBEX,
        addon_catalog_id: 'voice_pack_20',
        feature_id: 'voice_minutes',
        quantity: 1,
        is_active: true,
        price_paid_pence: 2200,
      },
    ]);
    expect(error).toBeNull();

    const res = await request.get('/api/billing/account', {
      headers: { Authorization: `Bearer ${globexUser.token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const google = body.monthly_bolt_ons.find((item: { id: string }) => item.id === 'google_calendar_addon');
    const voice = body.one_off_packs.find((item: { id: string }) => item.id === 'voice_pack_20');
    expect(google.already_included).toBe(true);
    expect(google.ownership).toBe('purchased');
    expect(google.price_paid_pence).toBe(350);
    expect(google.price_label).toBe('£3.50/mo');
    expect(google.catalogue_price_pence).not.toBe(350);
    expect(voice.billing).toBe('one_off');
    expect(voice.already_included).toBe(false);
    expect(body.monthly_total_pence).toBe(beforeTotal + 350);
    expect(body.heading).toContain(formatPounds(beforeTotal + 350));
    expect(body.heading).not.toContain(formatPounds(google.catalogue_price_pence));
    expect(body.heading).not.toContain(voice.name);

    await admin.from('tenants').update({ has_google_calendar: flagRow?.has_google_calendar ?? false }).eq('id', GLOBEX);
  });

  test('a normal user cannot set an include switch, and a superadmin switch shows as Already included', async ({ request }) => {
    const denied = await request.put('/api/superadmin/tenant-addon-inclusions', {
      headers: { Authorization: `Bearer ${globexUser.token}`, 'Content-Type': 'application/json' },
      data: {
        tenant_id: GLOBEX,
        addon_catalog_id: 'landline_addon',
        included: true,
        price_paid_pence: 250,
      },
    });
    expect(denied.status()).toBe(403);

    const before = await request.get('/api/billing/account', {
      headers: { Authorization: `Bearer ${globexUser.token}` },
    });
    const beforeTotal = (await before.json()).monthly_total_pence as number;

    const saved = await request.put('/api/superadmin/tenant-addon-inclusions', {
      headers: { Authorization: `Bearer ${superadmin.token}`, 'Content-Type': 'application/json' },
      data: {
        tenant_id: GLOBEX,
        addon_catalog_id: 'landline_addon',
        included: true,
        price_paid_pence: 250,
      },
    });
    expect(saved.status()).toBe(200);

    const res = await request.get('/api/billing/account', {
      headers: { Authorization: `Bearer ${globexUser.token}` },
    });
    const body = await res.json();
    const landline = body.monthly_bolt_ons.find((item: { id: string }) => item.id === 'landline_addon');
    expect(landline.already_included).toBe(true);
    expect(landline.ownership).toBe('included');
    expect(landline.price_paid_pence).toBe(250);
    expect(body.monthly_total_pence).toBe(beforeTotal + 250);
    expect(body.included_flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ addon_catalog_id: 'landline_addon', included: true, price_paid_pence: 250 }),
      ])
    );
  });
});
