import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestUser, TestUserSession } from './test-auth-helper';

const ACME = '10000000-0000-0000-0000-000000000001';
const GLOBEX = '10000000-0000-0000-0000-000000000002';

function admin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe('STYL-287 tenant settings auth', () => {
  let acmeOwner: TestUserSession;
  let acmeAdmin: TestUserSession;
  let acmeMember: TestUserSession;
  let globexOwner: TestUserSession;
  let globexMember: TestUserSession;
  let originalAcmeDomain: string | null;
  let originalGlobexDomain: string | null;
  let originalAcmeHoliday: unknown;

  test.beforeAll(async () => {
    acmeOwner = await createTestUser({ tenantId: ACME, role: 'owner' });
    acmeAdmin = await createTestUser({ tenantId: ACME, role: 'admin' });
    acmeMember = await createTestUser({ tenantId: ACME, role: 'member' });
    globexOwner = await createTestUser({ tenantId: GLOBEX, role: 'owner' });
    globexMember = await createTestUser({ tenantId: GLOBEX, role: 'member' });
    const db = admin();
    const { data } = await db.from('tenants').select('id, domain, holiday_settings').in('id', [ACME, GLOBEX]);
    originalAcmeDomain = data?.find((row) => row.id === ACME)?.domain ?? null;
    originalGlobexDomain = data?.find((row) => row.id === GLOBEX)?.domain ?? null;
    originalAcmeHoliday = data?.find((row) => row.id === ACME)?.holiday_settings ?? {};
  });

  test.afterAll(async () => {
    const db = admin();
    await db.from('tenants').update({ domain: originalAcmeDomain, holiday_settings: originalAcmeHoliday }).eq('id', ACME);
    await db.from('tenants').update({ domain: originalGlobexDomain }).eq('id', GLOBEX);
    await acmeOwner?.cleanup();
    await acmeAdmin?.cleanup();
    await acmeMember?.cleanup();
    await globexOwner?.cleanup();
    await globexMember?.cleanup();
  });

  test('unauthenticated PATCH is 401 and does not write', async ({ request }) => {
    const marker = `unauth-${Date.now()}.example`;
    const res = await request.patch('/api/tenants/settings', {
      data: { domain: marker },
    });
    expect(res.status()).toBe(401);
    const { data } = await admin().from('tenants').select('id').eq('domain', marker);
    expect(data || []).toHaveLength(0);
  });

  test('a member of another tenant is 403', async ({ request }) => {
    const res = await request.patch('/api/tenants/settings', {
      headers: { Authorization: `Bearer ${globexMember.token}` },
      data: { tenantId: ACME, domain: 'other-tenant.example' },
    });
    expect(res.status()).toBe(403);
    const { data } = await admin().from('tenants').select('domain').eq('id', ACME).single();
    expect(data?.domain).not.toBe('other-tenant.example');
  });

  test('a same-tenant member is 403', async ({ request }) => {
    const res = await request.patch('/api/tenants/settings', {
      headers: { Authorization: `Bearer ${acmeMember.token}` },
      data: { tenantId: ACME, domain: 'member-write.example' },
    });
    expect(res.status()).toBe(403);
  });

  test('owner and admin can update their own tenant, including when tenantId is omitted', async ({ request }) => {
    const ownerDomain = `owner-${Date.now()}.example`;
    const ownerRes = await request.patch('/api/tenants/settings', {
      headers: { Authorization: `Bearer ${globexOwner.token}` },
      data: { domain: ownerDomain },
    });
    expect(ownerRes.status()).toBe(200);
    const ownerBody = await ownerRes.json();
    expect(ownerBody.success).toBe(true);
    expect(ownerBody.tenant.id).toBe(GLOBEX);
    expect(ownerBody.tenant.domain).toBe(ownerDomain);

    const { data: acme } = await admin().from('tenants').select('domain').eq('id', ACME).single();
    expect(acme?.domain).not.toBe(ownerDomain);

    const adminDomain = `admin-${Date.now()}.example`;
    const adminRes = await request.patch('/api/tenants/settings', {
      headers: { Authorization: `Bearer ${acmeAdmin.token}` },
      data: { tenantId: ACME, domain: adminDomain },
    });
    expect(adminRes.status()).toBe(200);
    const adminBody = await adminRes.json();
    expect(adminBody.tenant.id).toBe(ACME);
    expect(adminBody.tenant.domain).toBe(adminDomain);
  });

  test('a zero tenant id does not fall back to the first tenant', async ({ request }) => {
    const marker = `zero-${Date.now()}.example`;
    const res = await request.patch('/api/tenants/settings', {
      headers: { Authorization: `Bearer ${acmeOwner.token}` },
      data: { tenantId: '00000000-0000-0000-0000-000000000000', domain: marker },
    });
    expect(res.status()).toBe(403);
    const { data } = await admin().from('tenants').select('id').eq('domain', marker);
    expect(data || []).toHaveLength(0);
  });

  test('a spoofed holiday acceptance email or timestamp is overwritten', async ({ request }) => {
    const before = Date.now();
    const res = await request.patch('/api/tenants/settings', {
      headers: { Authorization: `Bearer ${acmeOwner.token}` },
      data: {
        tenantId: ACME,
        holiday_settings: {
          behavior: 'follow_general',
          staff_hours_outside_opening_accepted: true,
          staff_hours_outside_opening_accepted_by: 'spoofed@example.com',
          staff_hours_outside_opening_accepted_at: '1999-01-01T00:00:00.000Z',
        },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const saved = body.tenant.holiday_settings;
    expect(saved.staff_hours_outside_opening_accepted).toBe(true);
    expect(saved.staff_hours_outside_opening_accepted_by).toBe(acmeOwner.user.email);
    expect(saved.staff_hours_outside_opening_accepted_by).not.toBe('spoofed@example.com');
    expect(saved.staff_hours_outside_opening_accepted_at).not.toBe('1999-01-01T00:00:00.000Z');
    const stamped = Date.parse(saved.staff_hours_outside_opening_accepted_at);
    expect(stamped).toBeGreaterThanOrEqual(before - 2000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 5000);
    expect(saved.behavior).toBe('follow_general');

    const { data } = await admin().from('tenants').select('holiday_settings').eq('id', ACME).single();
    expect(data?.holiday_settings.staff_hours_outside_opening_accepted_by).toBe(acmeOwner.user.email);
    expect(data?.holiday_settings.staff_hours_outside_opening_accepted_at).toBe(
      saved.staff_hours_outside_opening_accepted_at,
    );
  });
});
