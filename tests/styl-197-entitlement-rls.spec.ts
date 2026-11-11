import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * STYL-197: usage_logs and tenant_entitlements.
 * A signed-in tenant reads only its own rows. anon and authenticated cannot write.
 * Local Supabase only. The service role is the server writer.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const ACME = '10000000-0000-0000-0000-000000000001';
const GLOBEX = '10000000-0000-0000-0000-000000000002';
const MARKER = 'styl-197-rls';

test.describe('STYL-197 usage_logs and tenant_entitlements RLS', () => {
  test.skip(!anonKey || !serviceKey, 'Requires local Supabase anon + service role keys');

  test('tenant A cannot read tenant B, and no client role can write', async () => {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await admin.from('usage_logs').delete().eq('description', MARKER);
    await admin.from('tenant_entitlements').delete().eq('tenant_id', ACME).eq('feature_id', 'message_allowance');
    await admin.from('tenant_entitlements').delete().eq('tenant_id', GLOBEX).eq('feature_id', 'message_allowance');

    const { error: acmeLogError } = await admin.from('usage_logs').insert({
      tenant_id: ACME,
      feature_id: 'message_allowance',
      amount: 1,
      description: MARKER,
    });
    const { error: globexLogError } = await admin.from('usage_logs').insert({
      tenant_id: GLOBEX,
      feature_id: 'message_allowance',
      amount: 2,
      description: MARKER,
    });
    expect(acmeLogError).toBeNull();
    expect(globexLogError).toBeNull();

    const { error: acmeEntError } = await admin.from('tenant_entitlements').insert({
      tenant_id: ACME,
      feature_id: 'message_allowance',
      is_enabled: true,
      numeric_limit: 10,
    });
    const { error: globexEntError } = await admin.from('tenant_entitlements').insert({
      tenant_id: GLOBEX,
      feature_id: 'message_allowance',
      is_enabled: true,
      numeric_limit: 20,
    });
    expect(acmeEntError).toBeNull();
    expect(globexEntError).toBeNull();

    const { data: anonLogs } = await anon.from('usage_logs').select('tenant_id').eq('description', MARKER);
    expect(anonLogs ?? []).toEqual([]);
    const { data: anonEntitlements } = await anon
      .from('tenant_entitlements')
      .select('tenant_id')
      .eq('feature_id', 'message_allowance');
    expect(anonEntitlements ?? []).toEqual([]);

    const { error: anonInsert } = await anon.from('usage_logs').insert({
      tenant_id: ACME,
      feature_id: 'message_allowance',
      amount: 9,
      description: MARKER,
    });
    expect(anonInsert).toBeTruthy();

    const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({
      email: 'admin@acme.com',
      password: 'password123',
    });
    expect(signErr).toBeNull();
    const acme = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${signIn.session!.access_token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: ownLogs, error: ownLogsErr } = await acme
      .from('usage_logs')
      .select('tenant_id, amount')
      .eq('description', MARKER);
    expect(ownLogsErr).toBeNull();
    expect(ownLogs).toHaveLength(1);
    expect(ownLogs?.[0].tenant_id).toBe(ACME);
    expect(Number(ownLogs?.[0].amount)).toBe(1);

    const { data: otherLogs, error: otherLogsErr } = await acme
      .from('usage_logs')
      .select('tenant_id')
      .eq('tenant_id', GLOBEX);
    expect(otherLogsErr).toBeNull();
    expect(otherLogs ?? []).toEqual([]);

    const { data: ownEnt, error: ownEntErr } = await acme
      .from('tenant_entitlements')
      .select('tenant_id, numeric_limit')
      .eq('feature_id', 'message_allowance');
    expect(ownEntErr).toBeNull();
    expect(ownEnt).toHaveLength(1);
    expect(ownEnt?.[0].tenant_id).toBe(ACME);
    expect(Number(ownEnt?.[0].numeric_limit)).toBe(10);

    const { data: otherEnt, error: otherEntErr } = await acme
      .from('tenant_entitlements')
      .select('tenant_id')
      .eq('tenant_id', GLOBEX);
    expect(otherEntErr).toBeNull();
    expect(otherEnt ?? []).toEqual([]);

    const { error: clientInsert } = await acme.from('usage_logs').insert({
      tenant_id: ACME,
      feature_id: 'message_allowance',
      amount: 9,
      description: MARKER,
    });
    expect(clientInsert).toBeTruthy();

    const { error: clientEntInsert } = await acme.from('tenant_entitlements').insert({
      tenant_id: ACME,
      feature_id: 'sms_messages',
      is_enabled: true,
      numeric_limit: 1,
    });
    expect(clientEntInsert).toBeTruthy();

    await acme.from('usage_logs').update({ amount: 99 }).eq('description', MARKER);
    await acme.from('usage_logs').delete().eq('description', MARKER);
    await acme.from('tenant_entitlements').update({ numeric_limit: 99 }).eq('tenant_id', ACME).eq('feature_id', 'message_allowance');
    await acme.from('tenant_entitlements').delete().eq('tenant_id', ACME).eq('feature_id', 'message_allowance');

    const { data: logsAfter } = await admin
      .from('usage_logs')
      .select('tenant_id, amount')
      .eq('description', MARKER);
    expect((logsAfter || []).map((row) => `${row.tenant_id}:${Number(row.amount)}`).sort()).toEqual([
      `${ACME}:1`,
      `${GLOBEX}:2`,
    ].sort());
    const { data: entAfter } = await admin
      .from('tenant_entitlements')
      .select('tenant_id, numeric_limit')
      .eq('feature_id', 'message_allowance')
      .in('tenant_id', [ACME, GLOBEX]);
    expect((entAfter || []).map((row) => `${row.tenant_id}:${Number(row.numeric_limit)}`).sort()).toEqual([
      `${ACME}:10`,
      `${GLOBEX}:20`,
    ].sort());

    await admin.from('usage_logs').delete().eq('description', MARKER);
    await admin.from('tenant_entitlements').delete().eq('tenant_id', ACME).eq('feature_id', 'message_allowance');
    await admin.from('tenant_entitlements').delete().eq('tenant_id', GLOBEX).eq('feature_id', 'message_allowance');
    await anon.auth.signOut();
  });
});
