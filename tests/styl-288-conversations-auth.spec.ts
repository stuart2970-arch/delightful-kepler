import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestUser, TestUserSession } from './test-auth-helper';

const ACME = '10000000-0000-0000-0000-000000000001';
const GLOBEX = '10000000-0000-0000-0000-000000000002';
const ACME_BOT = 'e0000000-0000-0000-0000-000000000001';
const GLOBEX_BOT = 'e0000000-0000-0000-0000-000000000002';

const acmeSession = `styl288-acme-${Date.now()}`;
const globexSession = `styl288-globex-${Date.now()}`;
const acmeCaller = '+447700900287';
const globexCaller = '+447700900288';

function admin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe('STYL-288 conversations auth', () => {
  let acmeMember: TestUserSession;
  let globexMember: TestUserSession;
  let acmeConversationId = '';

  test.beforeAll(async () => {
    acmeMember = await createTestUser({ tenantId: ACME, role: 'member' });
    globexMember = await createTestUser({ tenantId: GLOBEX, role: 'member' });
    const db = admin();
    const { data, error } = await db.from('conversations').insert([
      {
        tenant_id: ACME,
        chatbot_id: ACME_BOT,
        user_session_id: acmeSession,
        channel: 'phone',
        caller_number: acmeCaller,
        transcript: 'Acme customer asked about a colour appointment',
      },
      {
        tenant_id: GLOBEX,
        chatbot_id: GLOBEX_BOT,
        user_session_id: globexSession,
        channel: 'phone',
        caller_number: globexCaller,
        transcript: 'Globex customer left a private callback number',
      },
    ]).select('id, tenant_id');
    if (error) throw new Error(error.message);
    acmeConversationId = data.find((row) => row.tenant_id === ACME)?.id || '';
    const { error: messageError } = await db.from('messages').insert({
      tenant_id: ACME,
      conversation_id: acmeConversationId,
      sender_type: 'user',
      text_content: 'Please keep this Acme message private',
    });
    if (messageError) throw new Error(messageError.message);
  });

  test.afterAll(async () => {
    await admin().from('conversations').delete().in('user_session_id', [acmeSession, globexSession]);
    await acmeMember?.cleanup();
    await globexMember?.cleanup();
  });

  test('unauthenticated GET is 401', async ({ request }) => {
    const res = await request.get(`/api/conversations?tenantId=${ACME}`);
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(acmeCaller);
  });

  test('a member of another tenant is 403', async ({ request }) => {
    const res = await request.get(`/api/conversations?tenantId=${ACME}`, {
      headers: { Authorization: `Bearer ${globexMember.token}` },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(acmeCaller);
    expect(JSON.stringify(body)).not.toContain(globexCaller);
  });

  test('a member sees only their tenant transcripts', async ({ request }) => {
    const res = await request.get(`/api/conversations?tenantId=${ACME}`, {
      headers: { Authorization: `Bearer ${acmeMember.token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const sessions = (body.conversations || []).map((row: { user_session_id?: string }) => row.user_session_id);
    expect(sessions).toContain(acmeSession);
    expect(sessions).not.toContain(globexSession);
    const acmeRow = body.conversations.find((row: { user_session_id?: string }) => row.user_session_id === acmeSession);
    expect(acmeRow.caller_number).toBe(acmeCaller);
    expect(JSON.stringify(body)).not.toContain(globexCaller);
  });

  test('messages are 401 signed out, 404 for another salon, and limited columns for a member', async ({ request }) => {
    const unsigned = await request.get(`/api/messages?conversationId=${acmeConversationId}`);
    expect(unsigned.status()).toBe(401);

    const otherSalon = await request.get(`/api/messages?conversationId=${acmeConversationId}`, {
      headers: { Authorization: `Bearer ${globexMember.token}` },
    });
    expect(otherSalon.status()).toBe(404);
    expect(JSON.stringify(await otherSalon.json())).not.toContain('Please keep this Acme message private');

    const sameSalon = await request.get(`/api/messages?conversationId=${acmeConversationId}&tenantId=${ACME}`, {
      headers: { Authorization: `Bearer ${acmeMember.token}` },
    });
    expect(sameSalon.status()).toBe(200);
    const body = await sameSalon.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].text_content).toBe('Please keep this Acme message private');
    expect(body.messages[0].sender_type).toBe('user');
    expect(body.messages[0].tenant_id).toBeUndefined();
    expect(Object.keys(body.messages[0]).sort()).toEqual(['created_at', 'id', 'sender_type', 'text_content']);
  });
});
