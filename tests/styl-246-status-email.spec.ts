import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestUser } from './test-auth-helper';

/**
 * STYL-246: a signed-in member can see that a calendar is connected.
 * Neither Google nor Microsoft status returns account_email.
 */

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

test.describe('STYL-246 calendar status does not leak the account email', () => {
  test('signed-out status is 401 and a member does not receive account_email', async ({ request }) => {
    const stamp = Date.now();
    const tenantId = crypto.randomUUID();
    const secretEmail = `owner-${stamp}@salon.test`;
    const { error: tenantError } = await admin.from('tenants').insert({
      id: tenantId,
      company_name: `Calendar Email ${stamp}`,
      slug: `calendar-email-${stamp}`,
    });
    expect(tenantError).toBeNull();
    const member = await createTestUser({ tenantId, role: 'member' });
    const { error: googleError } = await admin.from('tenant_integrations').insert({
      tenant_id: tenantId,
      provider: 'google_calendar',
      refresh_token: 'mock_refresh',
      account_email: secretEmail,
    });
    expect(googleError).toBeNull();
    const { error: microsoftError } = await admin.from('tenants').update({
      microsoft_refresh_token: `ms-secret-${stamp}`,
    }).eq('id', tenantId);
    expect(microsoftError).toBeNull();

    try {
      const signedOut = await request.get(`/api/integrations/google/status?tenantId=${tenantId}`);
      expect(signedOut.status()).toBe(401);

      const headers = { Authorization: `Bearer ${member.token}` };
      const google = await request.get(`/api/integrations/google/status?tenantId=${tenantId}`, { headers });
      expect(google.status()).toBe(200);
      const googleRaw = await google.text();
      expect(googleRaw).not.toContain(secretEmail);
      expect(googleRaw).not.toContain('account_email');

      const microsoft = await request.get(`/api/integrations/microsoft/status?tenantId=${tenantId}`, { headers });
      expect(microsoft.status()).toBe(200);
      const microsoftRaw = await microsoft.text();
      expect(microsoftRaw).not.toContain(secretEmail);
      expect(microsoftRaw).not.toContain('account_email');
      expect(microsoftRaw).not.toContain(`ms-secret-${stamp}`);
    } finally {
      await member.cleanup();
      await admin.from('tenants').delete().eq('id', tenantId);
    }
  });
});