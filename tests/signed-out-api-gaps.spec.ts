import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestSuperadminUser, createTestUser, TestUserSession } from './test-auth-helper';
import { assertPublicHttpUrl, fetchPublic, isBlockedAddress, OutboundUrlError } from '../src/lib/security/safe-outbound';

const ACME = '10000000-0000-0000-0000-000000000001';
const GLOBEX = '10000000-0000-0000-0000-000000000002';
const ACME_STAFF = '30000000-0000-0000-0000-000000000003';
const ACME_SERVICE = '40000000-0000-0000-0000-000000000001';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

test.describe('signed-out API gaps', () => {
  let acmeOwner: TestUserSession;
  let acmeMember: TestUserSession;
  let globexMember: TestUserSession;
  let superadmin: TestUserSession;
  let appointmentId = '';
  let createdStaffId = '';

  test.beforeAll(async () => {
    acmeOwner = await createTestUser({ tenantId: ACME, role: 'owner' });
    acmeMember = await createTestUser({ tenantId: ACME, role: 'member' });
    globexMember = await createTestUser({ tenantId: GLOBEX, role: 'member' });
    superadmin = await createTestSuperadminUser();
    const { data, error } = await admin().from('appointments').insert({
      tenant_id: ACME,
      staff_id: ACME_STAFF,
      service_id: ACME_SERVICE,
      customer_name: 'Gap Test',
      customer_email: 'gap@example.test',
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 3600000).toISOString(),
    }).select('id').single();
    if (error) throw new Error(error.message);
    appointmentId = data.id;
  });

  test.afterAll(async () => {
    const db = admin();
    if (appointmentId) await db.from('appointments').delete().eq('id', appointmentId);
    if (createdStaffId) await db.from('staff').delete().eq('id', createdStaffId);
    await acmeOwner?.cleanup();
    await acmeMember?.cleanup();
    await globexMember?.cleanup();
    await superadmin?.cleanup();
  });

  test('staff, appointments, test journey, sitemap and places reject signed-out callers', async ({ request }) => {
    const staff = await request.get(`/api/staff?tenantId=${ACME}`);
    const created = await request.post('/api/staff', { data: { name: 'Nope', email: 'nope@example.test' } });
    const updated = await request.put('/api/staff', { data: { id: ACME_STAFF, name: 'Nope', email: 'nope@example.test' } });
    const removed = await request.delete(`/api/staff?id=${ACME_STAFF}&tenantId=${ACME}`);
    const appointment = await request.patch(`/api/appointments/${appointmentId}`, { data: { customer_phone: '07700900999' } });
    const journey = await request.post('/api/integrations/meta/test-journey', { data: { tenantId: ACME } });
    const sitemap = await request.post('/api/sitemap/discover', { data: { websiteUrl: 'https://example.com' } });
    const places = await request.post('/api/integrations/google/places', { data: { url: 'https://example.com' } });
    for (const res of [staff, created, updated, removed, appointment, journey, sitemap, places]) {
      expect(res.status()).toBe(401);
    }
  });

  test('a member of another tenant is forbidden', async ({ request }) => {
    const headers = { Authorization: `Bearer ${globexMember.token}` };
    const staff = await request.get(`/api/staff?tenantId=${ACME}`, { headers });
    const created = await request.post('/api/staff', {
      headers,
      data: { tenant_id: ACME, name: 'Cross', email: 'cross@example.test' },
    });
    const appointment = await request.patch(`/api/appointments/${appointmentId}`, {
      headers,
      data: { customer_phone: '07700900888' },
    });
    expect(staff.status()).toBe(403);
    expect(created.status()).toBe(403);
    expect(appointment.status()).toBe(403);

    const { data } = await admin().from('appointments').select('customer_phone').eq('id', appointmentId).maybeSingle();
    expect(data?.customer_phone).not.toBe('07700900888');
  });

  test('a member can read staff and amend their salon booking; writes need owner or admin', async ({ request }) => {
    const memberHeaders = { Authorization: `Bearer ${acmeMember.token}` };
    const listed = await request.get(`/api/staff?tenantId=${ACME}`, { headers: memberHeaders });
    expect(listed.status()).toBe(200);
    const body = await listed.json();
    expect((body.staff || []).every((row: { tenant_id?: string }) => row.tenant_id === ACME)).toBe(true);

    const memberWrite = await request.post('/api/staff', {
      headers: memberHeaders,
      data: { name: 'Member hire', email: `hire-${Date.now()}@example.test` },
    });
    expect(memberWrite.status()).toBe(403);

    const ownerHeaders = { Authorization: `Bearer ${acmeOwner.token}` };
    const spoofed = await request.post('/api/staff', {
      headers: ownerHeaders,
      data: { tenant_id: GLOBEX, name: 'Spoof hire', email: `spoof-${Date.now()}@example.test` },
    });
    expect(spoofed.status()).toBe(403);

    const hired = await request.post('/api/staff', {
      headers: ownerHeaders,
      data: { name: 'Owner hire', email: `owner-hire-${Date.now()}@example.test` },
    });
    expect(hired.status()).toBe(200);
    const hiredBody = await hired.json();
    createdStaffId = hiredBody.staff.id;
    expect(hiredBody.staff.tenant_id).toBe(ACME);

    const foreignBot = await request.post('/api/staff', {
      headers: ownerHeaders,
      data: {
        name: 'Foreign bot',
        email: `foreign-bot-${Date.now()}@example.test`,
        chatbot_id: 'e0000000-0000-0000-0000-000000000002',
      },
    });
    expect(foreignBot.status()).toBe(403);

    const amended = await request.patch(`/api/appointments/${appointmentId}`, {
      headers: memberHeaders,
      data: { customer_phone: '07700900777' },
    });
    expect(amended.status()).toBe(200);
    expect((await amended.json()).appointment.customer_phone).toBe('07700900777');
  });

  test('the test journey is superadmin only', async ({ request }) => {
    const owner = await request.post('/api/integrations/meta/test-journey', {
      headers: { Authorization: `Bearer ${acmeOwner.token}` },
      data: { tenantId: ACME, messageText: 'Hello' },
    });
    expect(owner.status()).toBe(403);

    const allowed = await request.post('/api/integrations/meta/test-journey', {
      headers: { Authorization: `Bearer ${superadmin.token}` },
      data: { tenantId: ACME, messageText: 'Hello from the superadmin check' },
    });
    expect(allowed.status()).not.toBe(401);
    expect(allowed.status()).not.toBe(403);
  });

  test('sitemap and places block private addresses and rate-limit a tenant', async ({ request }) => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('10.1.2.3')).toBe(true);
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('192.168.0.8')).toBe(true);
    expect(isBlockedAddress('::1')).toBe(true);
    expect(isBlockedAddress('172.16.0.1')).toBe(true);
    expect(isBlockedAddress('100.64.0.1')).toBe(true);
    expect(isBlockedAddress('fe80::1')).toBe(true);
    expect(isBlockedAddress('::ffff:7f00:1')).toBe(true);
    expect(isBlockedAddress('[::1]')).toBe(true);
    expect(isBlockedAddress('0:0:0:0:0:0:0:1')).toBe(true);
    expect(isBlockedAddress('64:ff9b::7f00:1')).toBe(true);
    expect(isBlockedAddress('2002:7f00:1::')).toBe(true);
    expect(isBlockedAddress('fc00::1')).toBe(true);
    expect(isBlockedAddress('ff02::1')).toBe(true);
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
    await expect(assertPublicHttpUrl('http://[::ffff:127.0.0.1]/')).rejects.toBeInstanceOf(OutboundUrlError);
    await expect(assertPublicHttpUrl('http://[::1]/')).rejects.toBeInstanceOf(OutboundUrlError);
    await expect(assertPublicHttpUrl('http://127.0.0.1/latest/meta-data')).rejects.toBeInstanceOf(OutboundUrlError);
    await expect(assertPublicHttpUrl('http://metadata.google.internal/')).rejects.toBeInstanceOf(OutboundUrlError);
    await expect(fetchPublic('http://1.1.1.1/start', {}, 3, async () => new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data' },
    }))).rejects.toBeInstanceOf(OutboundUrlError);

    const rateTenantId = '10000000-0000-0000-0000-000000000099';
    const { error: tenantError } = await admin().from('tenants').insert({
      id: rateTenantId,
      company_name: 'Rate Limit Salon',
    });
    if (tenantError && !tenantError.message.includes('duplicate')) throw new Error(tenantError.message);
    const limitedUser = await createTestUser({
      role: 'member',
      tenantId: rateTenantId,
    });
    try {
      const headers = {
        Authorization: `Bearer ${limitedUser.token}`,
        'x-test-outbound-rate-limit': '1',
      };
      const blocked = await request.post('/api/sitemap/discover', {
        headers,
        data: { websiteUrl: 'http://127.0.0.1' },
      });
      expect(blocked.status()).toBe(400);
      const limited = await request.post('/api/integrations/google/places', {
        headers,
        data: { url: 'http://169.254.169.254/latest/meta-data' },
      });
      expect(limited.status()).toBe(429);
    } finally {
      await limitedUser.cleanup();
      await admin().from('tenants').delete().eq('id', rateTenantId);
    }
  });
});
