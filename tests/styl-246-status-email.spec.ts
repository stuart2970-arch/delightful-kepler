import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * STYL-246: the unauthenticated Google status route must not return account_email.
 * The signed-in dashboard still loads that address for the owner.
 */

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

test.describe('STYL-246 Google status does not leak the account email', () => {
  test('GET /api/integrations/google/status omits account_email', async ({ request }) => {
    const stamp = Date.now();
    const tenantId = crypto.randomUUID();
    const secretEmail = `owner-${stamp}@salon.test`;
    const { error: tenantError } = await admin.from('tenants').insert({
      id: tenantId,
      company_name: `Calendar Email ${stamp}`,
      slug: `calendar-email-${stamp}`,
    });
    expect(tenantError).toBeNull();
    const { error: integrationError } = await admin.from('tenant_integrations').insert({
      tenant_id: tenantId,
      provider: 'google_calendar',
      refresh_token: 'mock_refresh',
      account_email: secretEmail,
    });
    expect(integrationError).toBeNull();

    try {
      const response = await request.get(`/api/integrations/google/status?tenantId=${tenantId}`);
      expect(response.status()).toBe(200);
      const raw = await response.text();
      expect(raw).not.toContain(secretEmail);
      expect(raw).not.toContain('account_email');
      const body = JSON.parse(raw);
      expect(body.connected).toBe(true);
      expect(body.integration.provider).toBe('google_calendar');
    } finally {
      await admin.from('tenants').delete().eq('id', tenantId);
    }
  });
});
