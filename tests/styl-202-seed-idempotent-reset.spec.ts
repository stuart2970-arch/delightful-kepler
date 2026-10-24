import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * STYL-202 follow-up: unique tenant_active_addons, helper EXECUTE, SQL reset guard.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ACME_TENANT = '10000000-0000-0000-0000-000000000001';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', 'supabase_db_workspace', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  ).trim();
}

function canPsql(): boolean {
  try {
    psql('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

test.describe('STYL-202 follow-up: seed idempotency and SQL reset guard', () => {
  test.skip(!anonKey || !serviceKey, 'Requires local Supabase anon + service role keys');

  test('tenant_active_addons rejects duplicate (tenant_id, addon_catalog_id)', async () => {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { count: before } = await admin
      .from('tenant_active_addons')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ACME_TENANT)
      .eq('addon_catalog_id', 'google_calendar_addon');

    expect((before ?? 0) >= 1).toBe(true);

    const { error } = await admin.from('tenant_active_addons').insert({
      tenant_id: ACME_TENANT,
      addon_catalog_id: 'google_calendar_addon',
      is_active: true,
    });
    expect(error).toBeTruthy();
    expect(String(error?.message || error?.code || '')).toMatch(/duplicate|unique|23505/i);

    const { count: after } = await admin
      .from('tenant_active_addons')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ACME_TENANT)
      .eq('addon_catalog_id', 'google_calendar_addon');
    expect(after).toBe(before);
  });

  test('seed ON CONFLICT targets (tenant_id, addon_catalog_id)', () => {
    const seedPath = path.resolve(__dirname, '../supabase/seed.sql');
    const seed = fs.readFileSync(seedPath, 'utf8');
    expect(seed).toContain('ON CONFLICT (tenant_id, addon_catalog_id) DO NOTHING');
    expect(seed).toMatch(
      /tenant_active_addons[\s\S]*google_calendar_addon[\s\S]*ON CONFLICT \(tenant_id, addon_catalog_id\) DO NOTHING/,
    );
  });

  test('reset_staging.sql documents confirm GUC and calls assert guard', () => {
    const resetPath = path.resolve(__dirname, '../supabase/reset_staging.sql');
    const sql = fs.readFileSync(resetPath, 'utf8');
    expect(sql).toContain("app.confirm_staging_reset");
    expect(sql).toContain('styleflo-staging');
    expect(sql).toContain('tkoasyjvrgaglofpzduq');
    expect(sql).toContain('assert_staging_sql_reset_allowed');
    expect(sql).toContain('TRUNCATE TABLE public.tenants');
    expect(sql).toMatch(/seed\.sql/i);
  });

  test('anon cannot EXECUTE get_auth_tenant_id or is_auth_admin via PostgREST', async ({
    request,
  }) => {
    for (const fn of ['get_auth_tenant_id', 'is_auth_admin']) {
      const res = await request.post(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
        },
        data: {},
      });
      // Permission denied / not exposed for anon
      expect(res.status()).toBeGreaterThanOrEqual(400);
    }
  });

  test('assert_staging_sql_reset_allowed refuses without confirm GUC', async () => {
    test.skip(!canPsql(), 'Requires docker exec into supabase_db_workspace');
    let failed = false;
    try {
      psql("SELECT set_config('app.confirm_staging_reset', '', false); SELECT public.assert_staging_sql_reset_allowed();");
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  test('assert_staging_sql_reset_allowed accepts local confirm on this stack', async () => {
    test.skip(!canPsql(), 'Requires docker exec into supabase_db_workspace');
    const out = psql(
      "SELECT set_config('app.confirm_staging_reset', 'local', false); SELECT public.assert_staging_sql_reset_allowed();",
    );
    expect(out.toLowerCase()).not.toContain('refusing');
  });

  test('set_tenant_id has pinned search_path=public', async () => {
    test.skip(!canPsql(), 'Requires docker exec into supabase_db_workspace');
    const out = psql(`
      SELECT coalesce(pg_get_functiondef('public.set_tenant_id()'::regprocedure), '')
    `);
    expect(out).toMatch(/search_path\s*(=|TO)\s*'?public'?/i);
  });
});
