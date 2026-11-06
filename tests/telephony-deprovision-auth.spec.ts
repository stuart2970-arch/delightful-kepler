import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { createTestUser, TestUserSession } from './test-auth-helper';
import { secretsEqual } from '../src/lib/telephony/release-vendors';

const ACME = '10000000-0000-0000-0000-000000000001';
const GLOBEX = '10000000-0000-0000-0000-000000000002';

function jsonHeaders(token?: string) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

test.describe('Telephony deprovision owner / cron lockdown', () => {
  let owner: TestUserSession;
  let admin: TestUserSession;
  let member: TestUserSession;
  let otherOwner: TestUserSession;
  let superadmin: TestUserSession;

  test.beforeAll(async () => {
    owner = await createTestUser({ tenantId: ACME, role: 'owner' });
    admin = await createTestUser({ tenantId: ACME, role: 'admin' });
    member = await createTestUser({ tenantId: ACME, role: 'member' });
    otherOwner = await createTestUser({ tenantId: GLOBEX, role: 'owner' });
    superadmin = await createTestUser({ tenantId: GLOBEX, role: 'owner', isSuperAdmin: true });
  });

  test.afterAll(async () => {
    await owner?.cleanup();
    await admin?.cleanup();
    await member?.cleanup();
    await otherOwner?.cleanup();
    await superadmin?.cleanup();
  });

  test('owner can call deprovision for the session tenant', async ({ request }) => {
    const res = await request.post('/api/telephony/deprovision', {
      headers: jsonHeaders(owner.token),
      data: { number_type: 'local' },
    });
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.success).toBe(true);
    }
  });

  test('admin is 403', async ({ request }) => {
    const res = await request.post('/api/telephony/deprovision', {
      headers: jsonHeaders(admin.token),
      data: { tenant_id: ACME, number_type: 'local' },
    });
    expect(res.status()).toBe(403);
  });

  test('member is 403', async ({ request }) => {
    const res = await request.post('/api/telephony/deprovision', {
      headers: jsonHeaders(member.token),
      data: { tenant_id: ACME },
    });
    expect(res.status()).toBe(403);
  });

  test('other tenant owner is 403', async ({ request }) => {
    const res = await request.post('/api/telephony/deprovision', {
      headers: jsonHeaders(otherOwner.token),
      data: { tenant_id: ACME },
    });
    expect(res.status()).toBe(403);
  });

  test('unauthenticated is 401', async ({ request }) => {
    const res = await request.post('/api/telephony/deprovision', {
      headers: jsonHeaders(),
      data: { tenant_id: ACME },
    });
    expect(res.status()).toBe(401);
  });

  test('service-role bearer is 401', async ({ request }) => {
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing-service-role';
    const res = await request.post('/api/telephony/deprovision', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${service}`,
      },
      data: { tenant_id: ACME },
    });
    expect(res.status()).toBe(401);
  });

  test('CRON_SECRET bearer is allowed', async ({ request }) => {
    const cron = process.env.CRON_SECRET || 'mock_cron_secret_for_local_testing';
    const res = await request.post('/api/telephony/deprovision', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cron}`,
      },
      data: { tenant_id: ACME, number_type: 'local' },
    });
    expect([200, 404]).toContain(res.status());
  });

  test('wrong CRON_SECRET of the same length is 401', async ({ request }) => {
    const cron = process.env.CRON_SECRET || 'mock_cron_secret_for_local_testing';
    const sameLength = 'x'.repeat(cron.length);
    expect(sameLength.length).toBe(cron.length);
    expect(sameLength).not.toBe(cron);
    const res = await request.post('/api/telephony/deprovision', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sameLength}`,
      },
      data: { tenant_id: ACME, number_type: 'local' },
    });
    expect(res.status()).toBe(401);
  });

  test('wrong CRON_SECRET of a different length is 401', async ({ request }) => {
    const cron = process.env.CRON_SECRET || 'mock_cron_secret_for_local_testing';
    const different = `${cron}x`;
    expect(different.length).not.toBe(cron.length);
    const res = await request.post('/api/telephony/deprovision', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${different}`,
      },
      data: { tenant_id: ACME, number_type: 'local' },
    });
    expect(res.status()).toBe(401);
  });

  test('superadmin targeting another tenant is allowed and audited in source', async ({ request }) => {
    const res = await request.post('/api/telephony/deprovision', {
      headers: jsonHeaders(superadmin.token),
      data: { tenant_id: ACME, number_type: 'local' },
    });
    expect([200, 404]).toContain(res.status());
  });

});

test.describe('Telephony deprovision source audits (no live services)', () => {
  test('route source: vendors run only after owner/cron auth; no service-role bearer path', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/app/api/telephony/deprovision/route.ts'),
      'utf8',
    );
    expect(src).toContain('requireTenantRole');
    expect(src).toContain("['owner']");
    expect(src).toContain('isInternalCronRequest');
    const vendorSrc = fs.readFileSync(
      path.resolve(__dirname, '../src/lib/telephony/release-vendors.ts'),
      'utf8',
    );
    const secretsSrc = fs.readFileSync(
      path.resolve(__dirname, '../src/lib/security/secrets-equal.ts'),
      'utf8',
    );
    expect(secretsSrc).toContain('timingSafeEqual');
    expect(vendorSrc).toContain('secretsEqual');
    expect(vendorSrc).not.toMatch(/token === cronSecret/);
    expect(src).toContain('recordSuperadminAudit');
    expect(src).not.toMatch(/CRON_SECRET \|\| process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
    const cronIdx = src.indexOf('isInternalCronRequest');
    const roleIdx = src.indexOf('requireTenantRole');
    const twilioIdx = src.indexOf('releaseTwilioNumber');
    const vapiIdx = src.indexOf('releaseVapiNumber');
    expect(Math.min(cronIdx, roleIdx)).toBeLessThan(twilioIdx);
    expect(twilioIdx).toBeGreaterThan(-1);
    expect(vapiIdx).toBeGreaterThan(roleIdx);
  });

  test('secretsEqual rejects empty, same-length wrong, and different-length secrets', () => {
    expect(secretsEqual('', 'secret')).toBe(false);
    expect(secretsEqual('secret', '')).toBe(false);
    expect(secretsEqual('abcd', 'abce')).toBe(false);
    expect(secretsEqual('abc', 'abcd')).toBe(false);
    expect(secretsEqual('secret', 'secret')).toBe(true);
  });

  test('Release Dedicated Number is hidden unless the dashboard role is owner', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/components/dashboard-views/TelephonyView.tsx'),
      'utf8',
    );
    expect(src).toContain("role === 'owner'");
    expect(src).toContain('canReleaseDedicatedNumber');
    expect(src).toContain('Release Dedicated Number');
  });
});
