import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * STYL-202: entitlement table RLS against the local Supabase stack.
 * CI boots local Supabase and runs db reset before Playwright.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const ACME_TENANT = '10000000-0000-0000-0000-000000000001';
const GLOBEX_TENANT = '10000000-0000-0000-0000-000000000002';

test.describe('STYL-202: entitlement tables RLS (local stack)', () => {
  test.skip(!anonKey || !serviceKey, 'Requires local Supabase anon + service role keys');

  test('anon cannot read tenant_active_addons; service role can', async () => {
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: anonRows, error: anonErr } = await anon
      .from('tenant_active_addons')
      .select('tenant_id')
      .limit(5);

    expect(anonErr || (anonRows ?? []).length === 0).toBeTruthy();

    const { data: adminRows, error: adminErr } = await admin
      .from('tenant_active_addons')
      .select('tenant_id')
      .eq('tenant_id', ACME_TENANT)
      .limit(5);
    expect(adminErr).toBeNull();
    expect((adminRows ?? []).length).toBeGreaterThan(0);
  });

  test('Acme owner can read own active addons but not Globex rows', async () => {
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({
      email: 'admin@acme.com',
      password: 'password123',
    });
    expect(signErr).toBeNull();
    expect(signIn.session?.access_token).toBeTruthy();

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${signIn.session!.access_token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: own, error: ownErr } = await userClient
      .from('tenant_active_addons')
      .select('tenant_id, addon_catalog_id')
      .eq('tenant_id', ACME_TENANT);
    expect(ownErr).toBeNull();
    expect((own ?? []).length).toBeGreaterThan(0);

    const { data: other, error: otherErr } = await userClient
      .from('tenant_active_addons')
      .select('tenant_id, addon_catalog_id')
      .eq('tenant_id', GLOBEX_TENANT);
    expect(otherErr).toBeNull();
    expect(other ?? []).toEqual([]);

    const { data: tiers, error: tierErr } = await userClient
      .from('tier_entitlements')
      .select('tier_id, feature_id')
      .limit(3);
    expect(tierErr).toBeNull();
    expect((tiers ?? []).length).toBeGreaterThan(0);

    const { error: insertErr } = await userClient.from('tenant_feature_overrides').insert({
      tenant_id: ACME_TENANT,
      feature_id: 'website_chatbots',
      override_limit_value: 99,
      reason: 'styl-202-rls-probe',
    });
    expect(insertErr).toBeTruthy();

    await anon.auth.signOut();
  });

  test('seed uses foundation tier, superadmin, drama phones, and no ownerless My Workspace', async () => {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: acme } = await admin
      .from('tenants')
      .select('plan_tier, general_operating_hours, company_name')
      .eq('id', ACME_TENANT)
      .single();
    expect(acme?.plan_tier).toBe('foundation');
    expect(acme?.general_operating_hours?.monday).toBeTruthy();

    const { data: superProfile } = await admin
      .from('profiles')
      .select('is_super_admin, id')
      .eq('id', '20000000-0000-0000-0000-000000000099')
      .single();
    expect(superProfile?.is_super_admin).toBe(true);

    const { data: appts } = await admin
      .from('appointments')
      .select('customer_phone, customer_name')
      .eq('tenant_id', ACME_TENANT);
    const phones = (appts ?? []).map((a) => a.customer_phone).filter(Boolean);
    expect(phones.some((p) => String(p).startsWith('07700900'))).toBe(true);

    const { data: workspaces } = await admin
      .from('tenants')
      .select('id, company_name')
      .ilike('company_name', 'My Workspace%');
    expect(workspaces ?? []).toEqual([]);

    const { data: whatsapp } = await admin
      .from('addon_catalog')
      .select('is_active')
      .eq('id', 'whatsapp_addon')
      .maybeSingle();
    expect(whatsapp?.is_active).toBe(false);
  });
});
