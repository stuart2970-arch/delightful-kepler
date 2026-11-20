import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createTestNormalUser, createTestUser, type TestUserSession } from './test-auth-helper';

/**
 * STYL-252: local Supabase only.
 * A normal user cannot set is_super_admin or tenant_id.
 * The service role (superadmin routes) still can.
 * Column UPDATE privileges for those columns are false for authenticated and anon.
 * Sign-up posts the tenant-created webhook only to the configured staging URL.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const dbUrl = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const ACME_TENANT = '10000000-0000-0000-0000-000000000001';
const GLOBEX_TENANT = '10000000-0000-0000-0000-000000000002';

const STAGING_WEBHOOK_URL = 'https://staging.styleflo.ai/api/webhooks/tenant-created';
const PRODUCTION_WEBHOOK_URL = 'https://app.styleflo.ai/api/webhooks/tenant-created';
const TEST_BEARER = 'styl252-local-webhook-bearer';

const VAULT_NAMES = [
  'tenant_created_webhook_url',
  'tenant_created_webhook_secret',
  'tenant_created_webhook_environment',
] as const;

function sql(query: string): string {
  const result = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-tA', '-c', query], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `psql exited ${result.status}`).trim());
  }
  return (result.stdout || '').trim();
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function clearVault(): void {
  const names = VAULT_NAMES.map((name) => sqlLiteral(name)).join(', ');
  sql(`DELETE FROM vault.secrets WHERE name IN (${names});`);
}

const createdTenantIds: string[] = [];

function setVaultUrlAndSecret(url: string): void {
  clearVault();
  sql(`SELECT vault.create_secret(${sqlLiteral(url)}, 'tenant_created_webhook_url', 'STYL-252 local test');`);
  sql(`SELECT vault.create_secret(${sqlLiteral(TEST_BEARER)}, 'tenant_created_webhook_secret', 'STYL-252 local test');`);
}

function setVault(url: string, environment: string): void {
  setVaultUrlAndSecret(url);
  sql(
    `SELECT vault.create_secret(${sqlLiteral(environment)}, 'tenant_created_webhook_environment', 'STYL-252 local test');`,
  );
}

function sqlStdin(script: string): string {
  const result = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-tA'], {
    input: script,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `psql exited ${result.status}`).trim());
  }
  return (result.stdout || '').trim();
}

function productionPairQueuedInsideRollback(): string {
  const slug = `styl252-prod-rollback-${Date.now()}`;
  const script = `
BEGIN;
DELETE FROM vault.secrets WHERE name IN (${VAULT_NAMES.map((name) => sqlLiteral(name)).join(', ')});
SELECT vault.create_secret(${sqlLiteral(PRODUCTION_WEBHOOK_URL)}, 'tenant_created_webhook_url', 'STYL-252 local test');
SELECT vault.create_secret(${sqlLiteral(TEST_BEARER)}, 'tenant_created_webhook_secret', 'STYL-252 local test');
SELECT vault.create_secret('production', 'tenant_created_webhook_environment', 'STYL-252 local test');
CREATE TEMP TABLE styl252_probe (id uuid) ON COMMIT DROP;
WITH created AS (
  INSERT INTO public.tenants (company_name, slug)
  VALUES (${sqlLiteral(slug)}, ${sqlLiteral(slug)})
  RETURNING id
)
INSERT INTO styl252_probe SELECT id FROM created;
SELECT coalesce(d.url, '') || '|' || coalesce(q.url, '')
FROM styl252_probe n
LEFT JOIN private.tenant_created_webhook_dispatch d ON d.tenant_id = n.id
LEFT JOIN net.http_request_queue q ON q.id = d.request_id;
ROLLBACK;
`;
  const output = sqlStdin(script);
  return (
    output
      .split('\n')
      .map((row) => row.trim())
      .find((row) => row.includes(PRODUCTION_WEBHOOK_URL)) ?? ''
  );
}

function adminClient(): SupabaseClient {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe('STYL-252: WordPress tenant-created trigger and STYL-178 column guard', () => {
  test.skip(!anonKey || !serviceKey, 'Requires local Supabase anon + service role keys');

  let normalUser: TestUserSession | undefined;
  const createdUserIds: string[] = [];

  test.afterAll(async () => {
    clearVault();
    if (normalUser) await normalUser.cleanup();
    const admin = adminClient();
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
    if (createdTenantIds.length > 0) {
      const ids = createdTenantIds.map((id) => `${sqlLiteral(id)}::uuid`).join(', ');
      sql(`DELETE FROM public.tenants WHERE id IN (${ids});`);
    }
  });

  test('migration allow-lists the two webhook URLs and does not embed a bearer', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/20261111143000_styl252_keep_wp_trigger_styl178_guard.sql'),
      'utf8',
    );
    expect(migration).toContain(STAGING_WEBHOOK_URL);
    expect(migration).toContain(PRODUCTION_WEBHOOK_URL);
    expect(migration).not.toContain(TEST_BEARER);
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain('tenant_created_webhook_url');
    expect(migration).toContain('tenant_created_webhook_secret');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.sync_tenant_to_wordpress_fn()');
    expect(migration).toContain('EXECUTE FUNCTION public.protect_super_admin_flag()');
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles');
    expect(migration).toContain('DROP POLICY IF EXISTS insert_profiles');
    expect(migration).toContain('DROP POLICY IF EXISTS delete_profiles');
    expect(migration).toContain('DROP POLICY IF EXISTS update_profiles');
    expect(migration.split('\n').some((line) => line.trim().startsWith('GRANT UPDATE (role)'))).toBe(false);
    expect(migration).toContain('IS NOT TRUE');
  });

  test('authenticated and anon lack UPDATE on is_super_admin and tenant_id', () => {
    for (const role of ['authenticated', 'anon']) {
      for (const column of ['is_super_admin', 'tenant_id']) {
        const allowed = sql(
          `SELECT has_column_privilege(${sqlLiteral(role)}, 'public.profiles', ${sqlLiteral(column)}, 'UPDATE');`,
        );
        expect(allowed, `${role} UPDATE ${column}`).toBe('f');
      }
    }

    expect(sql(`SELECT has_column_privilege('service_role', 'public.profiles', 'is_super_admin', 'UPDATE');`)).toBe('t');
    expect(sql(`SELECT has_column_privilege('service_role', 'public.profiles', 'tenant_id', 'UPDATE');`)).toBe('t');
    expect(sql(`SELECT has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE');`)).toBe('f');
    expect(sql(`SELECT has_column_privilege('anon', 'public.profiles', 'role', 'UPDATE');`)).toBe('f');
    for (const role of ['authenticated', 'anon', 'public']) {
      expect(sql(`SELECT has_table_privilege(${sqlLiteral(role)}, 'public.profiles', 'INSERT');`), `${role} INSERT`).toBe('f');
      expect(sql(`SELECT has_table_privilege(${sqlLiteral(role)}, 'public.profiles', 'DELETE');`), `${role} DELETE`).toBe('f');
    }
    expect(
      sql(
        `SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname IN ('insert_profiles', 'delete_profiles', 'update_profiles');`,
      ),
    ).toBe('0');
    expect(
      sql(`SELECT has_function_privilege('authenticated', 'public.sync_tenant_to_wordpress_fn()', 'EXECUTE');`),
    ).toBe('f');
    expect(sql(`SELECT has_function_privilege('anon', 'public.sync_tenant_to_wordpress_fn()', 'EXECUTE');`)).toBe('f');

    const config = sql(
      `SELECT proconfig::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'sync_tenant_to_wordpress_fn';`,
    );
    expect(config).toContain('search_path=');
    expect(config).not.toContain('search_path=public');
    expect(
      sql(
        `SELECT count(*) FROM pg_trigger WHERE tgname = 'trigger_sync_tenant_to_wordpress' AND NOT tgisinternal;`,
      ),
    ).toBe('1');
    expect(
      sql(`SELECT count(*) FROM pg_trigger WHERE tgname = 'tr_protect_super_admin_flag' AND NOT tgisinternal;`),
    ).toBe('1');
  });

  test('a normal user cannot set is_super_admin or tenant_id; service role can', async () => {
    normalUser = await createTestNormalUser(ACME_TENANT);
    const userId = normalUser.user.id as string;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${normalUser.token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const flagAttempt = await userClient.from('profiles').update({ is_super_admin: true }).eq('id', userId);
    expect(flagAttempt.error).toBeTruthy();

    const tenantAttempt = await userClient.from('profiles').update({ tenant_id: GLOBEX_TENANT }).eq('id', userId);
    expect(tenantAttempt.error).toBeTruthy();

    const roleAttempt = await userClient.from('profiles').update({ role: 'admin' }).eq('id', userId);
    expect(roleAttempt.error).toBeTruthy();

    const member = await createTestUser({ tenantId: ACME_TENANT, role: 'member' });
    try {
      const memberClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${member.token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const escalate = await memberClient.from('profiles').update({ role: 'owner' }).eq('id', member.user.id);
      expect(escalate.error).toBeTruthy();
      const colleague = await memberClient
        .from('profiles')
        .update({ role: 'owner' })
        .eq('id', userId);
      expect(colleague.error).toBeTruthy();
    } finally {
      await member.cleanup();
    }

    const admin = adminClient();
    const before = await admin.from('profiles').select('is_super_admin, tenant_id, role').eq('id', userId).single();
    expect(before.error).toBeNull();
    expect(before.data?.is_super_admin).toBe(false);
    expect(before.data?.tenant_id).toBe(ACME_TENANT);
    expect(before.data?.role).toBe('owner');

    const promote = await admin.from('profiles').update({ is_super_admin: true, tenant_id: GLOBEX_TENANT }).eq('id', userId);
    expect(promote.error).toBeNull();

    const after = await admin.from('profiles').select('is_super_admin, tenant_id').eq('id', userId).single();
    expect(after.data?.is_super_admin).toBe(true);
    expect(after.data?.tenant_id).toBe(GLOBEX_TENANT);

    const restore = await admin
      .from('profiles')
      .update({ is_super_admin: false, tenant_id: ACME_TENANT, role: 'owner' })
      .eq('id', userId);
    expect(restore.error).toBeNull();

    const deleted = await userClient.from('profiles').delete().eq('id', userId);
    expect(deleted.error).toBeTruthy();
    const reinserted = await userClient.from('profiles').insert({
      id: userId,
      tenant_id: GLOBEX_TENANT,
      role: 'owner',
      is_super_admin: true,
    });
    expect(reinserted.error).toBeTruthy();

    const still = await admin.from('profiles').select('is_super_admin, tenant_id, role').eq('id', userId).single();
    expect(still.data?.is_super_admin).toBe(false);
    expect(still.data?.tenant_id).toBe(ACME_TENANT);
    expect(still.data?.role).toBe('owner');
  });

  test('sign-up posts tenant-created to the staging endpoint only', async () => {
    clearVault();

    const quietSlug = `styl252-quiet-${Date.now()}`;
    const quiet = await signUpTenant(quietSlug);
    createdUserIds.push(quiet.userId);
    expect(dispatchCount(quiet.tenantId)).toBe('0');
    expect(queueCountForHost('app.styleflo.ai')).toBe('0');

    setVault(PRODUCTION_WEBHOOK_URL, 'staging');
    const blockedSlug = `styl252-blocked-${Date.now()}`;
    const blocked = await signUpTenant(blockedSlug);
    createdUserIds.push(blocked.userId);
    expect(dispatchCount(blocked.tenantId)).toBe('0');
    expect(queueCountForHost('app.styleflo.ai')).toBe('0');

    setVault(STAGING_WEBHOOK_URL, 'staging');
    const slug = `styl252-signup-${Date.now()}`;
    const signedUp = await signUpTenant(slug);
    createdUserIds.push(signedUp.userId);

    const dispatched = sql(
      `SELECT url || '|' || coalesce(request_id::text, '') FROM private.tenant_created_webhook_dispatch WHERE tenant_id = ${sqlLiteral(signedUp.tenantId)}::uuid ORDER BY id DESC LIMIT 1;`,
    );
    expect(dispatched.startsWith(`${STAGING_WEBHOOK_URL}|`)).toBe(true);
    const requestId = dispatched.split('|')[1];
    expect(requestId).not.toBe('');

    const queuedUrl = sql(`SELECT coalesce(url, '') FROM net.http_request_queue WHERE id = ${requestId};`);
    if (queuedUrl) {
      expect(queuedUrl).toBe(STAGING_WEBHOOK_URL);
    } else {
      const responded = sql(`SELECT count(*) FROM net._http_response WHERE id = ${requestId};`);
      expect(responded).toBe('1');
    }

    const signupTenants = [quiet.tenantId, blocked.tenantId, signedUp.tenantId].map((id) => `${sqlLiteral(id)}::uuid`).join(', ');
    expect(
      sql(
        `SELECT count(*) FROM private.tenant_created_webhook_dispatch WHERE tenant_id IN (${signupTenants}) AND (url ILIKE '%app.styleflo.ai%' OR url <> ${sqlLiteral(STAGING_WEBHOOK_URL)});`,
      ),
    ).toBe('0');
    expect(
      sql(
        `SELECT count(*) FROM net.http_request_queue WHERE url ILIKE '%app.styleflo.ai%' AND body::text LIKE ${sqlLiteral(`%${slug}%`)};`,
      ),
    ).toBe('0');
  });

  test('only the exact staging or production webhook URL is posted', async () => {
    const rejected: Array<[string, string]> = [
      ['https://staging.styleflo.ai/api/webhooks/tenant-created', 'Staging'],
      ['https://staging.styleflo.ai/api/webhooks/tenant-created', 'local'],
      ['https://staging.styleflo.ai./api/webhooks/tenant-created', 'staging'],
      ['http://staging.styleflo.ai/api/webhooks/tenant-created', 'staging'],
      ['https://staging.styleflo.ai/api/webhooks/tenant-created?a=b@evil.com', 'staging'],
      ['https://evil.example/@staging.styleflo.ai', 'staging'],
      ['https://app.styleflo.ai/@staging.styleflo.ai/api/webhooks/tenant-created', 'staging'],
      ['https://user@staging.styleflo.ai/api/webhooks/tenant-created', 'staging'],
      [PRODUCTION_WEBHOOK_URL, 'staging'],
      [STAGING_WEBHOOK_URL, 'production'],
    ];

    for (const [url, environment] of rejected) {
      const slug = `styl252-reject-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      setVault(url, environment);
      const tenantId = insertTenant(slug);
      expect(dispatchCount(tenantId), `${environment} ${url}`).toBe('0');
    }

    for (const url of [STAGING_WEBHOOK_URL, PRODUCTION_WEBHOOK_URL]) {
      const slug = `styl252-noenv-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      setVaultUrlAndSecret(url);
      const tenantId = insertTenant(slug);
      expect(dispatchCount(tenantId), `missing environment ${url}`).toBe('0');
    }

    const queued = productionPairQueuedInsideRollback();
    expect(queued).toBe(`${PRODUCTION_WEBHOOK_URL}|${PRODUCTION_WEBHOOK_URL}`);
    expect(sql(`SELECT count(*) FROM public.tenants WHERE slug LIKE 'styl252-prod-rollback-%';`)).toBe('0');
    expect(
      sql(
        `SELECT count(*) FROM net.http_request_queue WHERE url = ${sqlLiteral(PRODUCTION_WEBHOOK_URL)} AND body::text LIKE '%styl252-prod-rollback-%';`,
      ),
    ).toBe('0');
  });
});

function dispatchCount(tenantId: string): string {
  return sql(
    `SELECT count(*) FROM private.tenant_created_webhook_dispatch WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid;`,
  );
}

function queueCountForHost(host: string): string {
  return sql(`SELECT count(*) FROM net.http_request_queue WHERE url ILIKE ${sqlLiteral(`%${host}%`)};`);
}

function insertTenant(slug: string): string {
  const tenantId = sql(
    `INSERT INTO public.tenants (company_name, slug) VALUES (${sqlLiteral(slug)}, ${sqlLiteral(slug)}) RETURNING id::text;`,
  )
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /^[0-9a-f-]{36}$/i.test(line));
  if (!tenantId) throw new Error(`Tenant insert failed for ${slug}`);
  createdTenantIds.push(tenantId);
  return tenantId;
}

async function signUpTenant(slug: string): Promise<{ userId: string; tenantId: string }> {
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `${slug}@test.styleflo.ai`;
  const { data, error } = await anon.auth.signUp({
    email,
    password: 'Password123!',
    options: { data: { company_name: slug, slug } },
  });
  if (error || !data.user) {
    throw new Error(`Sign-up failed: ${error?.message || 'no user'}`);
  }

  const tenantId = sql(`SELECT id::text FROM public.tenants WHERE slug = ${sqlLiteral(slug)};`);
  if (!tenantId) {
    throw new Error(`Sign-up did not create a tenant for slug ${slug}`);
  }
  createdTenantIds.push(tenantId);
  return { userId: data.user.id, tenantId };
}
