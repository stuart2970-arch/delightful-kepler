import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createTestUser, TestUserSession } from './test-auth-helper';

const ACME = '10000000-0000-0000-0000-000000000001';
const GLOBEX = '10000000-0000-0000-0000-000000000002';

function admin(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe('STYL-289 integration status auth', () => {
  let acmeMember: TestUserSession;
  let acmeAdmin: TestUserSession;
  let globexMember: TestUserSession;
  let originalMicrosoftToken: string | null;

  test.beforeAll(async () => {
    acmeMember = await createTestUser({ tenantId: ACME, role: 'member' });
    acmeAdmin = await createTestUser({ tenantId: ACME, role: 'admin' });
    globexMember = await createTestUser({ tenantId: GLOBEX, role: 'member' });

    const db = admin();
    const { data: tenant } = await db
      .from('tenants')
      .select('microsoft_refresh_token')
      .eq('id', ACME)
      .single();
    originalMicrosoftToken = tenant?.microsoft_refresh_token ?? null;

    const { error: googleError } = await db.from('tenant_integrations').upsert({
      tenant_id: ACME,
      provider: 'google_calendar',
      refresh_token: 'styl289-google-refresh',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,provider' });
    if (googleError) throw new Error(googleError.message);

    const { error: msError } = await db
      .from('tenants')
      .update({ microsoft_refresh_token: 'styl289-ms-refresh' })
      .eq('id', ACME);
    if (msError) throw new Error(msError.message);
  });

  test.afterAll(async () => {
    const db = admin();
    await db.from('tenant_integrations').delete().eq('tenant_id', ACME).eq('provider', 'google_calendar');
    await db.from('tenants').update({ microsoft_refresh_token: originalMicrosoftToken }).eq('id', ACME);
    await acmeMember?.cleanup();
    await acmeAdmin?.cleanup();
    await globexMember?.cleanup();
  });

  test('unauthenticated Google and Microsoft status reads are 401', async ({ request }) => {
    const google = await request.get(`/api/integrations/google/status?tenantId=${ACME}`);
    const microsoft = await request.get(`/api/integrations/microsoft/status?tenantId=${ACME}`);
    expect(google.status()).toBe(401);
    expect(microsoft.status()).toBe(401);
  });

  test('a member of another tenant is 403 on GET and DELETE', async ({ request }) => {
    const headers = { Authorization: `Bearer ${globexMember.token}` };
    const googleGet = await request.get(`/api/integrations/google/status?tenantId=${ACME}`, { headers });
    const msGet = await request.get(`/api/integrations/microsoft/status?tenantId=${ACME}`, { headers });
    const googleDel = await request.delete(`/api/integrations/google/status?tenantId=${ACME}`, { headers });
    const msDel = await request.delete(`/api/integrations/microsoft/status?tenantId=${ACME}`, { headers });
    expect(googleGet.status()).toBe(403);
    expect(msGet.status()).toBe(403);
    expect(googleDel.status()).toBe(403);
    expect(msDel.status()).toBe(403);

    const { data } = await admin()
      .from('tenant_integrations')
      .select('refresh_token')
      .eq('tenant_id', ACME)
      .eq('provider', 'google_calendar')
      .maybeSingle();
    expect(data?.refresh_token).toBe('styl289-google-refresh');
  });

  test('a member can read status and cannot disconnect', async ({ request }) => {
    const headers = { Authorization: `Bearer ${acmeMember.token}` };
    const google = await request.get(`/api/integrations/google/status?tenantId=${ACME}`, { headers });
    expect(google.status()).toBe(200);
    const googleBody = await google.json();
    expect(googleBody.connected).toBe(true);

    const microsoft = await request.get(`/api/integrations/microsoft/status?tenantId=${ACME}`, { headers });
    expect(microsoft.status()).toBe(200);
    const msBody = await microsoft.json();
    expect(msBody.connected).toBe(true);

    const googleDel = await request.delete(`/api/integrations/google/status?tenantId=${ACME}`, { headers });
    const msDel = await request.delete(`/api/integrations/microsoft/status?tenantId=${ACME}`, { headers });
    expect(googleDel.status()).toBe(403);
    expect(msDel.status()).toBe(403);
  });

  test('unauthenticated DELETE is 401', async ({ request }) => {
    const google = await request.delete(`/api/integrations/google/status?tenantId=${ACME}`);
    const microsoft = await request.delete(`/api/integrations/microsoft/status?tenantId=${ACME}`);
    expect(google.status()).toBe(401);
    expect(microsoft.status()).toBe(401);
  });

  test('an admin can disconnect their own salon calendars', async ({ request }) => {
    const headers = { Authorization: `Bearer ${acmeAdmin.token}` };
    const google = await request.delete(`/api/integrations/google/status?tenantId=${ACME}`, { headers });
    const microsoft = await request.delete(`/api/integrations/microsoft/status?tenantId=${ACME}`, { headers });
    expect(google.status()).toBe(200);
    expect(microsoft.status()).toBe(200);

    const status = await request.get(`/api/integrations/google/status?tenantId=${ACME}`, { headers });
    expect(status.status()).toBe(200);
    const body = await status.json();
    expect(body.connected).toBe(false);

    const { data } = await admin().from('tenants').select('microsoft_refresh_token').eq('id', ACME).single();
    expect(data?.microsoft_refresh_token).toBeNull();
  });
});
