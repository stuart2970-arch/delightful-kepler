import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * STYL-242: a signed-in salon member can read their own bolt-on purchases.
 * Local Supabase only. Writes stay service-role.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const ACME = '10000000-0000-0000-0000-000000000001';
const GLOBEX = '10000000-0000-0000-0000-000000000002';

test.describe('STYL-242 entitlement SELECT policies', () => {
  test.skip(!anonKey || !serviceKey, 'Requires local Supabase anon + service role keys');

  test('Acme reads its own addons, not Globex; anon and writes are refused; superadmin reads both', async () => {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: fixtureError } = await admin.from('tenant_active_addons').upsert({
      tenant_id: GLOBEX,
      addon_catalog_id: 'microsoft_calendar_addon',
      feature_id: 'microsoft_calendar',
      quantity: 1,
      is_active: true,
    }, { onConflict: 'tenant_id,addon_catalog_id' });
    expect(fixtureError).toBeNull();

    const { error: acmeOverrideError } = await admin.from('tenant_feature_overrides').upsert({
      tenant_id: ACME,
      feature_id: 'google_calendar',
      override_limit_value: 1,
      reason: 'styl-242-acme',
    }, { onConflict: 'tenant_id,feature_id' });
    const { error: globexOverrideError } = await admin.from('tenant_feature_overrides').upsert({
      tenant_id: GLOBEX,
      feature_id: 'google_calendar',
      override_limit_value: 1,
      reason: 'styl-242-globex',
    }, { onConflict: 'tenant_id,feature_id' });
    expect(acmeOverrideError).toBeNull();
    expect(globexOverrideError).toBeNull();

    const { data: anonAddons } = await anon.from('tenant_active_addons').select('tenant_id').limit(5);
    expect(anonAddons ?? []).toEqual([]);
    const { data: anonTiers } = await anon.from('tier_entitlements').select('tier_id').limit(5);
    expect(anonTiers ?? []).toEqual([]);

    const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({
      email: 'admin@acme.com',
      password: 'password123',
    });
    expect(signErr).toBeNull();
    const acme = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${signIn.session!.access_token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: own, error: ownErr } = await acme
      .from('tenant_active_addons')
      .select('tenant_id')
      .eq('tenant_id', ACME);
    expect(ownErr).toBeNull();
    expect((own ?? []).length).toBeGreaterThan(0);

    const { data: other, error: otherErr } = await acme
      .from('tenant_active_addons')
      .select('tenant_id')
      .eq('tenant_id', GLOBEX);
    expect(otherErr).toBeNull();
    expect(other ?? []).toEqual([]);

    const { data: tiers, error: tierErr } = await acme.from('tier_entitlements').select('tier_id').limit(3);
    expect(tierErr).toBeNull();
    expect((tiers ?? []).length).toBeGreaterThan(0);

    const { data: ownOverrides, error: ownOverrideErr } = await acme
      .from('tenant_feature_overrides')
      .select('tenant_id')
      .eq('tenant_id', ACME);
    expect(ownOverrideErr).toBeNull();
    expect((ownOverrides ?? []).length).toBeGreaterThan(0);
    const { data: otherOverrides, error: otherOverrideErr } = await acme
      .from('tenant_feature_overrides')
      .select('tenant_id')
      .eq('tenant_id', GLOBEX);
    expect(otherOverrideErr).toBeNull();
    expect(otherOverrides ?? []).toEqual([]);

    const { data: acmeRow } = await admin
      .from('tenant_active_addons')
      .select('id, price_paid_pence, is_active')
      .eq('tenant_id', ACME)
      .eq('addon_catalog_id', 'google_calendar_addon')
      .single();
    expect(acmeRow?.id).toBeTruthy();

    const { error: insertErr } = await acme.from('tenant_active_addons').insert({
      tenant_id: ACME,
      addon_catalog_id: 'landline_addon',
      feature_id: 'telephone_number',
      quantity: 1,
      is_active: true,
    });
    expect(insertErr).toBeTruthy();

    await acme.from('tenant_active_addons').update({ price_paid_pence: 1 }).eq('id', acmeRow!.id);
    await acme.from('tenant_active_addons').delete().eq('id', acmeRow!.id);

    const { data: unchanged } = await admin
      .from('tenant_active_addons')
      .select('id, price_paid_pence, is_active')
      .eq('id', acmeRow!.id)
      .single();
    expect(unchanged?.id).toBe(acmeRow!.id);
    expect(unchanged?.is_active).toBe(true);
    expect(unchanged?.price_paid_pence ?? null).toBe(acmeRow!.price_paid_pence ?? null);

    await anon.auth.signOut();
    const { data: superSignIn, error: superErr } = await anon.auth.signInWithPassword({
      email: 'superadmin@styleflo.test',
      password: 'password123',
    });
    expect(superErr).toBeNull();
    const superadmin = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${superSignIn.session!.access_token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: superAcme, error: superAcmeErr } = await superadmin
      .from('tenant_active_addons')
      .select('tenant_id')
      .eq('tenant_id', ACME);
    const { data: superGlobex, error: superGlobexErr } = await superadmin
      .from('tenant_active_addons')
      .select('tenant_id')
      .eq('tenant_id', GLOBEX);
    expect(superAcmeErr).toBeNull();
    expect(superGlobexErr).toBeNull();
    expect((superAcme ?? []).length).toBeGreaterThan(0);
    expect((superGlobex ?? []).length).toBeGreaterThan(0);

    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', 'microsoft_calendar_addon');
    await admin.from('tenant_feature_overrides').delete().eq('reason', 'styl-242-acme');
    await admin.from('tenant_feature_overrides').delete().eq('reason', 'styl-242-globex');
    await anon.auth.signOut();
  });
});
