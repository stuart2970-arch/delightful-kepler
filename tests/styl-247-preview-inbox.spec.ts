import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * STYL-247: the inbox poll must not bring preview chats back.
 * Auth on this route is intentionally unchanged.
 */

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

test.describe('STYL-247 preview conversations stay out of the inbox', () => {
  test('GET /api/conversations omits preview sessions and keeps the others', async ({ request }) => {
    const stamp = Date.now();
    const tenantId = crypto.randomUUID();
    const botId = crypto.randomUUID();
    const { error: tenantError } = await admin.from('tenants').insert({
      id: tenantId,
      company_name: `Preview Inbox ${stamp}`,
      slug: `preview-inbox-${stamp}`,
    });
    expect(tenantError).toBeNull();
    const { error: botError } = await admin.from('chatbots').insert({
      id: botId,
      tenant_id: tenantId,
      name: 'Inbox Bot',
    });
    expect(botError).toBeNull();

    const { error: insertError } = await admin.from('conversations').insert([
      { tenant_id: tenantId, chatbot_id: botId, user_session_id: `customer-${stamp}` },
      { tenant_id: tenantId, chatbot_id: botId, user_session_id: `preview-owner-${stamp}` },
    ]);
    expect(insertError).toBeNull();

    try {
      const response = await request.get(`/api/conversations?tenantId=${tenantId}`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      const sessions = (body.conversations || []).map((row: { user_session_id: string }) => row.user_session_id);
      expect(sessions).toContain(`customer-${stamp}`);
      expect(sessions.some((session: string) => session.startsWith('preview-'))).toBe(false);
    } finally {
      await admin.from('tenants').delete().eq('id', tenantId);
    }
  });
});
