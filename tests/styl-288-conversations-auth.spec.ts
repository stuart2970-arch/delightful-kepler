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

  test.beforeAll(async () => {
    acmeMember = await createTestUser({ tenantId: ACME, role: 'member' });
    globexMember = await createTestUser({ tenantId: GLOBEX, role: 'member' });
    const db = admin();
    const { error } = await db.from('conversations').insert([
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
    ]);
    if (error) throw new Error(error.message);
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
});
