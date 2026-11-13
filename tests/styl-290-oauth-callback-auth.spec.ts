import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestUser, TestUserSession } from './test-auth-helper';
import { signOAuthState, verifyOAuthState } from '../src/lib/auth/oauth-state';
import { isMockOAuthCodeAllowed } from '../src/lib/env/allow-mock-oauth';
import { resolveChatSessionSigningSecret } from '../src/lib/chat-session';
import { saveMicrosoftCalendarConnection } from '../src/app/api/integrations/microsoft/callback/route';

const ACME = '10000000-0000-0000-0000-000000000001';
const GLOBEX = '10000000-0000-0000-0000-000000000002';

function admin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe('STYL-290 OAuth callback state', () => {
  let acmeOwner: TestUserSession;
  let globexMember: TestUserSession;

  test.beforeAll(async () => {
    acmeOwner = await createTestUser({ tenantId: ACME, role: 'owner' });
    globexMember = await createTestUser({ tenantId: GLOBEX, role: 'member' });
  });

  test.afterAll(async () => {
    await admin()
      .from('tenant_integrations')
      .delete()
      .eq('tenant_id', ACME)
      .in('refresh_token', ['mock_refresh_token', 'mock_ms_refresh_token']);
    await acmeOwner?.cleanup();
    await globexMember?.cleanup();
  });

  test('mock codes stay off unless the test-only flag is set outside production', () => {
    expect(isMockOAuthCodeAllowed({})).toBe(false);
    expect(isMockOAuthCodeAllowed({ ALLOW_MOCK_OAUTH_CODES: 'false', NODE_ENV: 'test' })).toBe(false);
    expect(isMockOAuthCodeAllowed({ ALLOW_MOCK_OAUTH_CODES: 'true', NODE_ENV: 'test' })).toBe(true);
    expect(isMockOAuthCodeAllowed({ ALLOW_MOCK_OAUTH_CODES: 'true', NODE_ENV: 'production' })).toBe(false);
    expect(isMockOAuthCodeAllowed({
      ALLOW_MOCK_OAUTH_CODES: 'true',
      APP_ENV: 'production',
      NODE_ENV: 'development',
    })).toBe(false);
    expect(isMockOAuthCodeAllowed({
      ALLOW_MOCK_OAUTH_CODES: 'true',
      APP_ENV: 'staging',
      NODE_ENV: 'development',
      NEXT_PUBLIC_SUPABASE_URL: 'https://tkoasyjvrgaglofpzduq.supabase.co',
    })).toBe(false);
    expect(resolveChatSessionSigningSecret({})).toBeNull();
    expect(resolveChatSessionSigningSecret({ CHAT_SESSION_SIGNING_SECRET: '  abc  ' })).toBe('abc');
    expect(resolveChatSessionSigningSecret({ SUPABASE_SERVICE_ROLE_KEY: 'service-role' })).toBeTruthy();
  });

  test('unauthenticated callbacks are 401', async ({ request }) => {
    const state = signOAuthState({ userId: acmeOwner.user.id, tenantId: ACME });
    expect(state).toBeTruthy();
    const google = await request.get(`/api/integrations/google/callback?code=mock_code&state=${encodeURIComponent(state!)}`);
    const microsoft = await request.get(`/api/integrations/microsoft/callback?code=mock_code&state=${encodeURIComponent(state!)}`);
    expect(google.status()).toBe(401);
    expect(microsoft.status()).toBe(401);
  });

  test('a member of another tenant is 403', async ({ request }) => {
    const state = signOAuthState({ userId: globexMember.user.id, tenantId: ACME });
    const headers = { Authorization: `Bearer ${globexMember.token}` };
    const google = await request.get(
      `/api/integrations/google/callback?code=real-code&state=${encodeURIComponent(state!)}`,
      { headers },
    );
    const microsoft = await request.get(
      `/api/integrations/microsoft/callback?code=real-code&state=${encodeURIComponent(state!)}`,
      { headers },
    );
    expect(google.status()).toBe(403);
    expect(microsoft.status()).toBe(403);
  });

  test('legacy plain tenant id and unsigned state are rejected', async ({ request }) => {
    const headers = { Authorization: `Bearer ${acmeOwner.token}` };
    const legacy = await request.get(
      `/api/integrations/google/callback?code=real-code&state=${ACME}`,
      { headers },
    );
    expect(legacy.status()).toBe(400);
    const legacyBody = await legacy.json();
    expect(legacyBody.error).toMatch(/state/i);

    const unsigned = Buffer.from(JSON.stringify({
      userId: acmeOwner.user.id,
      staffId: null,
    })).toString('base64');
    const unsignedRes = await request.get(
      `/api/integrations/microsoft/callback?code=real-code&state=${encodeURIComponent(unsigned)}`,
      { headers },
    );
    expect(unsignedRes.status()).toBe(400);
    const unsignedBody = await unsignedRes.json();
    expect(unsignedBody.error).toMatch(/state/i);
  });

  test('a signed state is accepted and a mock code is still refused', async ({ request }) => {
    const state = signOAuthState({ userId: acmeOwner.user.id, tenantId: ACME });
    const headers = { Authorization: `Bearer ${acmeOwner.token}` };
    const google = await request.get(
      `/api/integrations/google/callback?code=mock_google_code&state=${encodeURIComponent(state!)}`,
      { headers },
    );
    expect(google.status()).toBe(400);
    const body = await google.json();
    expect(body.error).toMatch(/mock/i);

    const { data } = await admin()
      .from('tenant_integrations')
      .select('refresh_token')
      .eq('tenant_id', ACME)
      .eq('provider', 'google_calendar')
      .maybeSingle();
    expect(data?.refresh_token).not.toBe('mock_refresh_token');
  });

  test('authorize issues a signed state bound to the signed-in user and tenant', async ({ request }) => {
    const google = await request.get('/api/integrations/google/authorize', {
      headers: { Authorization: `Bearer ${acmeOwner.token}` },
      maxRedirects: 0,
    });
    expect(google.status()).toBeGreaterThanOrEqual(300);
    expect(google.status()).toBeLessThan(400);
    const googleLocation = google.headers().location || '';
    expect(googleLocation).toContain('accounts.google.com');
    const googleState = new URL(googleLocation).searchParams.get('state');
    const googleClaims = verifyOAuthState(googleState);
    expect(googleClaims?.userId).toBe(acmeOwner.user.id);
    expect(googleClaims?.tenantId).toBe(ACME);

    const microsoft = await request.get('/api/integrations/microsoft/authorize', {
      headers: { Authorization: `Bearer ${acmeOwner.token}` },
      maxRedirects: 0,
    });
    expect(microsoft.status()).toBeGreaterThanOrEqual(300);
    expect(microsoft.status()).toBeLessThan(400);
    const msLocation = microsoft.headers().location || '';
    expect(msLocation).toContain('login.microsoftonline.com');
    const msState = new URL(msLocation).searchParams.get('state');
    const msClaims = verifyOAuthState(msState);
    expect(msClaims?.userId).toBe(acmeOwner.user.id);
    expect(msClaims?.tenantId).toBe(ACME);
  });

  test('a member cannot connect the salon calendar and can connect only their own staff row', async ({ request }) => {
    const member = await createTestUser({ tenantId: ACME, role: 'member' });
    const staffId = '30000000-0000-0000-0000-000000000003';
    const db = admin();
    const { data: previous } = await db.from('staff').select('user_id').eq('id', staffId).maybeSingle();
    try {
      const headers = { Authorization: `Bearer ${member.token}` };
      const salon = await request.get('/api/integrations/microsoft/authorize', {
        headers,
        maxRedirects: 0,
      });
      expect(salon.status()).toBe(403);

      const otherStaff = await request.get(
        `/api/integrations/microsoft/authorize?staffId=${staffId}`,
        { headers, maxRedirects: 0 },
      );
      expect(otherStaff.status()).toBe(403);

      await db.from('staff').update({ user_id: member.user.id }).eq('id', staffId);
      const own = await request.get(
        `/api/integrations/microsoft/authorize?staffId=${staffId}`,
        { headers, maxRedirects: 0 },
      );
      expect(own.status()).toBeGreaterThanOrEqual(300);
      expect(own.status()).toBeLessThan(400);
      const state = new URL(own.headers().location || '').searchParams.get('state');
      expect(verifyOAuthState(state)?.staffId).toBe(staffId);

      const forged = signOAuthState({ userId: member.user.id, tenantId: ACME });
      const callback = await request.get(
        `/api/integrations/google/callback?code=real-code&state=${encodeURIComponent(forged!)}`,
        { headers },
      );
      expect(callback.status()).toBe(403);
    } finally {
      await db.from('staff').update({ user_id: previous?.user_id ?? null }).eq('id', staffId);
      await member.cleanup();
    }
  });

  test('a staff Microsoft connect does not replace the salon refresh token', async () => {
    const staffId = '30000000-0000-0000-0000-000000000003';
    const db = admin();
    const { data: tenantBefore } = await db.from('tenants').select('microsoft_refresh_token').eq('id', ACME).single();
    const { data: staffBefore } = await db.from('staff').select('calendar_provider, microsoft_calendar_id').eq('id', staffId).single();
    const salonToken = tenantBefore?.microsoft_refresh_token ?? 'salon-ms-token';
    await db.from('tenants').update({ microsoft_refresh_token: salonToken }).eq('id', ACME);

    try {
      await saveMicrosoftCalendarConnection(db, {
        staffId,
        tenantId: ACME,
        tokens: {
          access_token: 'staff-access',
          refresh_token: 'staff-personal-token',
          expires_in: 3600,
          account_email: 'colleague@acme.com',
        },
      });

      const { data: tenant } = await db.from('tenants').select('microsoft_refresh_token').eq('id', ACME).single();
      expect(tenant?.microsoft_refresh_token).toBe(salonToken);
      const { data: staff } = await db.from('staff').select('calendar_provider, microsoft_calendar_id').eq('id', staffId).single();
      expect(staff?.calendar_provider).toBe('microsoft');
      expect(staff?.microsoft_calendar_id).toBe('colleague@acme.com');
    } finally {
      await db.from('tenants').update({ microsoft_refresh_token: tenantBefore?.microsoft_refresh_token ?? null }).eq('id', ACME);
      await db.from('staff').update({
        calendar_provider: staffBefore?.calendar_provider ?? null,
        microsoft_calendar_id: staffBefore?.microsoft_calendar_id ?? null,
      }).eq('id', staffId);
    }
  });
});
