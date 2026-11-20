import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

/**
 * STYL-250: addon_audit_log is own-tenant plus superadmin SELECT.
 * Local Supabase only. No live project.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const ACME = '10000000-0000-0000-0000-000000000001';
const GLOBEX = '10000000-0000-0000-0000-000000000002';
const ACME_SUMMARY = 'styl-250 acme fixture';
const GLOBEX_SUMMARY = 'styl-250 globex fixture';

function localDbContainer(): string | null {
  try {
    const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
    return names.split('\n').map((name) => name.trim()).find((name) => name.startsWith('supabase_db_')) || null;
  } catch {
    return null;
  }
}

function runLocalSql(sql: string) {
  const container = localDbContainer();
  if (!container) throw new Error('Local Supabase database container is not running');
  return execFileSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-t', '-A'],
    { input: sql, encoding: 'utf8' },
  );
}

test.describe('STYL-250 addon_audit_log RLS', () => {
  test.skip(!anonKey || !serviceKey, 'Requires local Supabase anon + service role keys');

  test('policies are own-tenant and superadmin, and the extra tables stay closed', () => {
    const policies = runLocalSql(`
      SELECT policyname || '|' || coalesce(qual, '')
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'addon_audit_log'
      ORDER BY policyname;
    `).trim();
    const names = policies.split('\n').filter(Boolean);
    expect(names.some((line) => line.startsWith('select_own_addon_audit_log|'))).toBe(true);
    expect(names.some((line) => line.startsWith('select_superadmin_addon_audit_log|'))).toBe(true);
    expect(names.some((line) => line.startsWith('select_addon_audit_log|'))).toBe(false);
    expect(policies).toContain('get_auth_tenant_id');
    expect(policies).toContain('is_super_admin');
    expect(policies).not.toMatch(/\|true$/m);

    const columns = runLocalSql(`
      SELECT column_name || '|' || is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tenant_active_addons'
        AND column_name IN ('cancel_at', 'cancel_at_period_end')
      ORDER BY column_name;
    `).trim();
    expect(columns).toContain('cancel_at|YES');
    expect(columns).toContain('cancel_at_period_end|YES');

    const extras = runLocalSql(`
      SELECT coalesce(to_regclass('public.knowledge_sources')::text, 'absent')
        || '|' || coalesce(to_regclass('public.referral_clicks')::text, 'absent')
        || '|' || (
          SELECT count(*)::text FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename IN ('knowledge_sources', 'referral_clicks')
        );
    `).trim();
    expect(extras).toBe('absent|absent|0');
  });

  test('Acme reads its own audit rows, not Globex; writes are refused; superadmin reads both', async () => {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await admin.from('addon_audit_log').delete().in('summary', [ACME_SUMMARY, GLOBEX_SUMMARY]);
    const { error: seedError } = await admin.from('addon_audit_log').insert([
      {
        tenant_id: ACME,
        addon_catalog_id: 'google_calendar_addon',
        action: 'addon_cancel_scheduled',
        new_value: {
          cancel_at: '2026-12-09T21:41:13.000Z',
          cancel_at_period_end: true,
          stripe_subscription_id: 'sub_test_acme_styl250',
        },
        summary: ACME_SUMMARY,
      },
      {
        tenant_id: GLOBEX,
        addon_catalog_id: 'google_calendar_addon',
        action: 'addon_cancel_scheduled',
        new_value: {
          cancel_at: '2026-12-09T21:41:13.000Z',
          cancel_at_period_end: true,
          stripe_subscription_id: 'sub_test_globex_styl250',
        },
        summary: GLOBEX_SUMMARY,
      },
    ]);
    expect(seedError).toBeNull();

    try {
      const { data: anonRows, error: anonErr } = await anon
        .from('addon_audit_log')
        .select('tenant_id')
        .limit(5);
      expect(anonErr).toBeNull();
      expect(anonRows ?? []).toEqual([]);

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
        .from('addon_audit_log')
        .select('tenant_id, summary')
        .eq('summary', ACME_SUMMARY);
      expect(ownErr).toBeNull();
      expect((own ?? []).length).toBeGreaterThan(0);
      expect(own?.every((row) => row.tenant_id === ACME)).toBe(true);

      const { data: other, error: otherErr } = await acme
        .from('addon_audit_log')
        .select('tenant_id')
        .eq('summary', GLOBEX_SUMMARY);
      expect(otherErr).toBeNull();
      expect(other ?? []).toEqual([]);

      const { error: insertErr } = await acme.from('addon_audit_log').insert({
        tenant_id: ACME,
        addon_catalog_id: 'google_calendar_addon',
        action: 'addon_activated',
        summary: 'styl-250 rejected insert',
      });
      expect(insertErr).toBeTruthy();

      const { data: seeded } = await admin
        .from('addon_audit_log')
        .select('id, summary')
        .eq('summary', ACME_SUMMARY)
        .limit(1)
        .single();
      expect(seeded?.id).toBeTruthy();

      await acme.from('addon_audit_log').update({ summary: 'styl-250 mutated' }).eq('id', seeded!.id);
      await acme.from('addon_audit_log').delete().eq('id', seeded!.id);
      const { data: unchanged } = await admin
        .from('addon_audit_log')
        .select('id, summary')
        .eq('id', seeded!.id)
        .single();
      expect(unchanged?.summary).toBe(ACME_SUMMARY);

      const { data: knowledge, error: knowledgeErr } = await acme.from('knowledge_sources').select('id').limit(1);
      if (knowledgeErr) {
        expect(knowledgeErr.message).toMatch(/does not exist|schema cache|Could not find the table/i);
      } else {
        expect(knowledge ?? []).toEqual([]);
      }
      const { data: clicks, error: clicksErr } = await acme.from('referral_clicks').select('id').limit(1);
      if (clicksErr) {
        expect(clicksErr.message).toMatch(/does not exist|schema cache|Could not find the table/i);
      } else {
        expect(clicks ?? []).toEqual([]);
      }

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
      const { data: superRows, error: superRowsErr } = await superadmin
        .from('addon_audit_log')
        .select('summary')
        .in('summary', [ACME_SUMMARY, GLOBEX_SUMMARY]);
      expect(superRowsErr).toBeNull();
      expect((superRows ?? []).map((row) => row.summary).sort()).toEqual([ACME_SUMMARY, GLOBEX_SUMMARY]);

      const { data: catalogShape, error: catalogErr } = await admin
        .from('addon_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      expect(catalogErr).toBeNull();
      expect((catalogShape ?? []).some((row) => row.summary === ACME_SUMMARY)).toBe(true);
      expect((catalogShape ?? []).some((row) => row.summary === GLOBEX_SUMMARY)).toBe(true);
    } finally {
      await admin.from('addon_audit_log').delete().in('summary', [ACME_SUMMARY, GLOBEX_SUMMARY, 'styl-250 rejected insert', 'styl-250 mutated']);
      await anon.auth.signOut();
    }
  });
});
