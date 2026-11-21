import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * STYL-397: service-only tables must not expose grants to anon/authenticated.
 * Local Supabase only.
 */

function localDbContainer(): string | null {
  try {
    const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
    return names.split('\n').map((name) => name.trim()).find((name) => name.startsWith('supabase_db_')) || null;
  } catch {
    return null;
  }
}

function runLocalSql(sql: string): string {
  const container = localDbContainer();
  if (!container) throw new Error('Local Supabase database container is not running');
  return execFileSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-t', '-A'],
    { input: sql, encoding: 'utf8' },
  ).trim();
}

const REVOKED_TABLES: { schema: string; table: string }[] = [
  { schema: 'public', table: 'appointment_manage_tokens' },
  { schema: 'public', table: 'vapi_call_ingest' },
  { schema: 'public', table: 'meta_data_deletion_requests' },
  { schema: 'public', table: 'booking_audit_log' },
  { schema: 'public', table: 'stripe_webhook_processed_events' },
];

test.describe('STYL-397 service-role table grants', () => {
  test('anon and authenticated have no grants on revoked service-only tables', () => {
    for (const { schema, table } of REVOKED_TABLES) {
      const schemaLit = schema.replace(/'/g, "''");
      const tableLit = table.replace(/'/g, "''");
      const grants = runLocalSql(`
        SELECT count(*)::text
        FROM information_schema.role_table_grants
        WHERE table_schema = '${schemaLit}'
          AND table_name = '${tableLit}'
          AND grantee IN ('anon', 'authenticated');
      `);
      expect(grants, `${schema}.${table} must not grant anon/authenticated`).toBe('0');
    }

    const privateDispatch = runLocalSql(`
      SELECT count(*)::text
      FROM information_schema.role_table_grants
      WHERE table_schema = 'private'
        AND table_name = 'tenant_created_webhook_dispatch'
        AND grantee IN ('anon', 'authenticated');
    `);
    expect(privateDispatch).toBe('0');
  });
});