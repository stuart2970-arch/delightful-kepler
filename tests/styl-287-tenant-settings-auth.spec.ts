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

  test('saving hours keeps an existing acceptance and does not re-stamp it', async ({ request }) => {
    const keptBy = 'kept-owner@salon.test';
    const keptAt = '2026-11-01T12:00:00.000Z';
    const { error } = await admin().from('tenants').update({
      holiday_settings: {
        behavior: 'follow_general',
        staff_hours_outside_opening_accepted: true,
        staff_hours_outside_opening_accepted_by: keptBy,
        staff_hours_outside_opening_accepted_at: keptAt,
      },
    }).eq('id', ACME);
    expect(error).toBeNull();

    const hours = await request.patch('/api/tenants/settings', {
      headers: { Authorization: `Bearer ${acmeOwner.token}` },
      data: { tenantId: ACME, holiday_settings: { behavior: 'closed' } },
    });
    expect(hours.status()).toBe(200);
    const saved = (await hours.json()).tenant.holiday_settings;
    expect(saved.behavior).toBe('closed');
    expect(saved.staff_hours_outside_opening_accepted).toBe(true);
    expect(saved.staff_hours_outside_opening_accepted_by).toBe(keptBy);
    expect(saved.staff_hours_outside_opening_accepted_at).toBe(keptAt);

    const again = await request.patch('/api/tenants/settings', {
      headers: { Authorization: `Bearer ${acmeOwner.token}` },
      data: {
        tenantId: ACME,
        holiday_settings: {
          behavior: 'closed',
          staff_hours_outside_opening_accepted: true,
          staff_hours_outside_opening_accepted_by: 'someone-else@salon.test',
          staff_hours_outside_opening_accepted_at: '2020-01-01T00:00:00.000Z',
        },
      },
    });
    expect(again.status()).toBe(200);
    const kept = (await again.json()).tenant.holiday_settings;
    expect(kept.staff_hours_outside_opening_accepted_by).toBe(keptBy);
    expect(kept.staff_hours_outside_opening_accepted_at).toBe(keptAt);
  });

  test('an owner cannot set Twilio numbers or auto top-up prices', async ({ request }) => {
    const { error } = await admin().from('tenants').update({
      voice_auto_topup_amount: 7,
      voice_auto_topup_price_pence: 900,
    }).eq('id', ACME);
    expect(error).toBeNull();

    const numbers = await request.patch('/api/tenants/settings', {
      headers: { Authorization: `Bearer ${acmeOwner.token}` },
      data: { tenantId: ACME, twilioShadowNumber: '+441619460000', twilioMobileNumber: '+447700900111' },
    });
    expect(numbers.status()).toBe(403);

    const bothKeys = await request.patch('/api/tenants/settings', {
      headers: { Authorization: `Bearer ${acmeOwner.token}` },
      data: { tenantId: ACME, twilio_shadow_number: null, twilioShadowNumber: '+441619460000' },
    });
    expect(bothKeys.status()).toBe(403);

    const disconnect = await request.patch('/api/tenants/settings', {
      headers: { Authorization: `Bearer ${acmeOwner.token}` },
      data: { tenantId: ACME, twilio_shadow_number: null, twilio_mobile_number: null },
    });
    expect(disconnect.status()).toBe(200);

    const topup = await request.patch('/api/tenants/settings', {
      headers: { Authorization: `Bearer ${acmeOwner.token}` },
      data: {
        tenantId: ACME,
        voice_auto_topup: true,
        voice_auto_topup_threshold: 15,
        voice_auto_topup_amount: 50,
        voice_auto_topup_price_pence: 3000,
      },
    });
    expect(topup.status()).toBe(200);
    const body = await topup.json();
    expect(body.tenant.voice_auto_topup).toBe(true);
    expect(body.tenant.voice_auto_topup_threshold).toBe(15);
    expect(body.tenant.voice_auto_topup_amount).toBe(7);
    expect(body.tenant.voice_auto_topup_price_pence).toBe(900);
  });
});
