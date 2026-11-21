import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { POST as tenantCreated } from '../src/app/api/webhooks/tenant-created/route';

/**
 * STYL-304: production sign-ups may miss WordPress pages when the DB trigger
 * posts without Authorization. STYL-252 restored vault-driven Bearer posting.
 */

const dbUrl = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const STAGING_WEBHOOK_URL = 'https://staging.styleflo.ai/api/webhooks/tenant-created';
const TEST_BEARER = 'styl304-local-webhook-bearer';

const VAULT_NAMES = [
  'tenant_created_webhook_url',
  'tenant_created_webhook_secret',
  'tenant_created_webhook_environment',
] as const;

function sql(query: string): string {
  const run = (command: string, args: string[]) =>
    spawnSync(command, args, { encoding: 'utf8' });

  let result = run('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-tA', '-c', query]);
  if (result.status !== 0 && result.error?.code === 'ENOENT') {
    result = run('docker', [
      'exec',
      'supabase_db_workspace',
      'psql',
      '-U',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-tA',
      '-c',
      query,
    ]);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `psql exited ${result.status}`).trim());
  }
  return (result.stdout || '').trim();
}

function sqlScalar(query: string): string {
  const output = sql(query);
  return (
    output
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('INSERT')) || ''
  );
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function clearVault(): void {
  const names = VAULT_NAMES.map((name) => sqlLiteral(name)).join(', ');
  sql(`DELETE FROM vault.secrets WHERE name IN (${names});`);
}

function setVault(environment: 'staging' | 'production'): void {
  clearVault();
  sql(`SELECT vault.create_secret(${sqlLiteral(STAGING_WEBHOOK_URL)}, 'tenant_created_webhook_url', 'STYL-304 local test');`);
  sql(`SELECT vault.create_secret(${sqlLiteral(TEST_BEARER)}, 'tenant_created_webhook_secret', 'STYL-304 local test');`);
  sql(
    `SELECT vault.create_secret(${sqlLiteral(environment)}, 'tenant_created_webhook_environment', 'STYL-304 local test');`,
  );
}

const createdTenantIds: string[] = [];

type VaultSnapshotRow = { name: string; value: string; description: string };

let vaultSnapshot: VaultSnapshotRow[] | null = null;

function snapshotVault(): void {
  vaultSnapshot = [];
  for (const name of VAULT_NAMES) {
    const value = sqlScalar(
      `SELECT coalesce(decrypted_secret, '') FROM vault.decrypted_secrets WHERE name = ${sqlLiteral(name)} ORDER BY created_at DESC LIMIT 1;`,
    );
    if (!value) continue;
    const description = sqlScalar(
      `SELECT coalesce(description, '') FROM vault.secrets WHERE name = ${sqlLiteral(name)} ORDER BY created_at DESC LIMIT 1;`,
    );
    vaultSnapshot.push({ name, value, description: description || 'STYL-304 restored' });
  }
}

function restoreVault(): void {
  clearVault();
  if (!vaultSnapshot?.length) return;
  for (const row of vaultSnapshot) {
    sql(
      `SELECT vault.create_secret(${sqlLiteral(row.value)}, ${sqlLiteral(row.name)}, ${sqlLiteral(row.description)});`,
    );
  }
}

test.describe('STYL-304 tenant-created webhook bearer', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    snapshotVault();
  });

  test.afterAll(() => {
    if (createdTenantIds.length) {
      try {
        const ids = createdTenantIds.map((id) => `${sqlLiteral(id)}::uuid`).join(', ');
        sql(`DELETE FROM public.tenants WHERE id IN (${ids});`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'tenant cleanup failed';
        console.warn('[STYL-304] afterAll tenant cleanup:', message);
      }
    }
    try {
      restoreVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'vault restore failed';
      console.warn('[STYL-304] afterAll vault restore:', message);
    }
  });

  test('webhook route requires Bearer TENANT_CREATED_WEBHOOK_SECRET', async () => {
    const previous = process.env.TENANT_CREATED_WEBHOOK_SECRET;
    process.env.TENANT_CREATED_WEBHOOK_SECRET = TEST_BEARER;
    try {
      const denied = await tenantCreated(
        new NextRequest('http://localhost:3001/api/webhooks/tenant-created', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ record: { slug: 'styl304-no-auth', company_name: 'Test' } }),
        }),
      );
      expect(denied.status).toBe(401);

      const allowed = await tenantCreated(
        new NextRequest('http://localhost:3001/api/webhooks/tenant-created', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${TEST_BEARER}`,
          },
          body: JSON.stringify({ record: { slug: 'styl304-auth', company_name: 'Test' } }),
        }),
      );
      expect(allowed.status).not.toBe(401);
    } finally {
      if (previous === undefined) delete process.env.TENANT_CREATED_WEBHOOK_SECRET;
      else process.env.TENANT_CREATED_WEBHOOK_SECRET = previous;
    }
  });

  test('tenant insert posts Authorization Bearer when vault values are set', () => {
    const slug = `styl304-bearer-${Date.now()}`;
    setVault('staging');
    const tenantId = sqlScalar(
      `INSERT INTO public.tenants (company_name, slug) VALUES (${sqlLiteral(slug)}, ${sqlLiteral(slug)}) RETURNING id::text;`,
    );
    createdTenantIds.push(tenantId);

    const dispatch = sql(
      `SELECT request_id::text FROM private.tenant_created_webhook_dispatch WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid ORDER BY id DESC LIMIT 1;`,
    );
    expect(dispatch).not.toBe('');

    const authorizationHeader = sql(
      `SELECT coalesce(headers ->> 'Authorization', '') FROM net.http_request_queue WHERE id = ${dispatch}::bigint;`,
    );
    expect(authorizationHeader, 'pg_net request must remain queued long enough to read outbound headers').not.toBe('');
    expect(authorizationHeader).toBe(`Bearer ${TEST_BEARER}`);
  });

  test('tenant insert does nothing when vault secret is missing', () => {
    clearVault();
    sql(`SELECT vault.create_secret(${sqlLiteral(STAGING_WEBHOOK_URL)}, 'tenant_created_webhook_url', 'STYL-304 local test');`);
    sql(
      `SELECT vault.create_secret('staging', 'tenant_created_webhook_environment', 'STYL-304 local test');`,
    );

    const slug = `styl304-nosecret-${Date.now()}`;
    const tenantId = sqlScalar(
      `INSERT INTO public.tenants (company_name, slug) VALUES (${sqlLiteral(slug)}, ${sqlLiteral(slug)}) RETURNING id::text;`,
    );
    createdTenantIds.push(tenantId);

    expect(
      sql(
        `SELECT count(*) FROM private.tenant_created_webhook_dispatch WHERE tenant_id = ${sqlLiteral(tenantId)}::uuid;`,
      ),
    ).toBe('0');
  });

  test('docs list vault secret names and migration ships Bearer header', () => {
    const docs = readFileSync(join(process.cwd(), 'docs/staging.md'), 'utf8');
    for (const name of VAULT_NAMES) {
      expect(docs).toContain(name);
    }
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/20261111143000_styl252_keep_wp_trigger_styl178_guard.sql'),
      'utf8',
    );
    expect(migration).toContain("'Authorization', 'Bearer ' || webhook_secret");
  });
});