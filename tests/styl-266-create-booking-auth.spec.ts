import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import dotenv from 'dotenv';
import { signChatSessionToken } from '../src/lib/chat-session';

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true });

/**
 * Callers of POST /api/v3/CreateBooking (confirmed 11 Nov 2026):
 *
 * In-repo HTTP callers: none. Nothing in src/, the widget, or Vapi tool
 * definitions fetches this URL.
 *
 * Intended external caller (not authenticated today):
 * - Reserve with Google Booking Server. Route comments and
 *   artifacts_for_notebooklm.md describe Google POSTing the customer payload.
 *   There is no Google credential check and no feed code that calls this route.
 *
 * Booking paths that do NOT call this route:
 * - Widget chat → POST /api/chat/stream (x-session-token) → bookMeeting()
 * - Vapi custom LLM → POST /api/voice/[chatbotId]/chat/completions and
 *   POST /api/voice/chat/completions → bookMeeting()
 *   Those voice routes do not send or verify X-Vapi-Secret.
 *
 * This suite is the contract for the two callers the route must accept:
 * a Vapi server tool call (shared secret + assistant id) and the widget
 * session (signed session token whose chatbot id is the widget key).
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const vapiSecret = process.env.VAPI_WEBHOOK_SECRET || '';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ACME_TENANT = '10000000-0000-0000-0000-000000000001';
const GLOBEX_TENANT = '10000000-0000-0000-0000-000000000002';
const ACME_BOT = 'e0000000-0000-0000-0000-000000000001';
const STAFF_ID = '30000000-0000-0000-0000-000000000003';
const SERVICE_ID = '40000000-0000-0000-0000-000000000001';
const ASSISTANT_ID = 'styl266-acme-assistant';

let originalBotConfig: unknown = null;

function payload(email: string, startSec: number, merchantId: string = GLOBEX_TENANT) {
  return {
    assistantId: 'body-assistant-must-not-grant-a-tenant',
    user_information: {
      given_name: 'Pat',
      family_name: 'Lee',
      email,
      telephone: '07700900111',
    },
    slot: {
      merchant_id: merchantId,
      service_id: SERVICE_ID,
      start_time_sec: String(startSec),
      duration_sec: '3600',
      resources: { staff_id: STAFF_ID },
    },
  };
}

function startSec(hour: number): number {
  return Math.floor(Date.parse(`2027-06-15T${String(hour).padStart(2, '0')}:00:00Z`) / 1000);
}

async function appointmentsFor(email: string) {
  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select('id, tenant_id, customer_email')
    .eq('customer_email', email);
  expect(error).toBeNull();
  return data || [];
}

async function auditFor(email: string) {
  const { data, error } = await supabaseAdmin
    .from('booking_audit_log')
    .select('tenant_id, source, outcome, reason, http_status, ignored_body_tenant, customer_email')
    .eq('customer_email', email)
    .order('created_at', { ascending: true });
  expect(error).toBeNull();
  return data || [];
}

test.describe('STYL-266: CreateBooking requires Vapi secret or widget session', () => {
  test.beforeAll(async () => {
    expect(serviceRoleKey, 'local service role key').not.toEqual('');
    expect(vapiSecret, 'VAPI_WEBHOOK_SECRET in .env.test').not.toEqual('');
    expect(supabaseUrl).not.toContain('tkoasyjvrgaglofpzduq');

    const { data: bot, error } = await supabaseAdmin
      .from('chatbots')
      .select('configuration_json')
      .eq('id', ACME_BOT)
      .single();
    expect(error).toBeNull();
    originalBotConfig = bot?.configuration_json ?? {};
    const nextConfig = {
      ...(typeof originalBotConfig === 'object' && originalBotConfig ? originalBotConfig : {}),
      vapi_assistant_id: ASSISTANT_ID,
    };
    const { error: updateError } = await supabaseAdmin
      .from('chatbots')
      .update({ configuration_json: nextConfig })
      .eq('id', ACME_BOT);
    expect(updateError).toBeNull();

    // Earlier red runs booked these 2027 slots. Seed appointments are "now", not 2027.
    await supabaseAdmin
      .from('appointments')
      .delete()
      .eq('staff_id', STAFF_ID)
      .gte('start_time', '2027-01-01T00:00:00Z')
      .lt('start_time', '2028-01-01T00:00:00Z');
    await supabaseAdmin.from('auth_rate_limits').delete().like('rate_key', 'create-booking:%');
  });

  test.afterAll(async () => {
    if (originalBotConfig) {
      await supabaseAdmin
        .from('chatbots')
        .update({ configuration_json: originalBotConfig })
        .eq('id', ACME_BOT);
    }
    await supabaseAdmin.from('appointments').delete().like('customer_email', 'styl266-%');
    await supabaseAdmin.from('booking_audit_log').delete().like('customer_email', 'styl266-%');
    await supabaseAdmin.from('auth_rate_limits').delete().like('rate_key', 'create-booking:%');
  });

  test('no auth returns 401 and does not insert', async ({ request }) => {
    const email = `styl266-anon-${Date.now()}@example.test`;
    const res = await request.post('/api/v3/CreateBooking', {
      headers: { 'x-forwarded-for': '203.0.113.10' },
      data: payload(email, startSec(10)),
    });
    expect(res.status()).toBe(401);
    expect(await appointmentsFor(email)).toEqual([]);
    const audit = await auditFor(email);
    expect(audit.some((row) => row.outcome === 'rejected' && row.http_status === 401)).toBe(true);
  });

  test('a wrong Vapi secret returns 401 and does not insert', async ({ request }) => {
    const email = `styl266-wrong-${Date.now()}@example.test`;
    const res = await request.post('/api/v3/CreateBooking', {
      headers: {
        'x-forwarded-for': '203.0.113.11',
        'x-vapi-secret': 'definitely-not-the-secret',
        'x-vapi-assistant-id': ASSISTANT_ID,
      },
      data: payload(email, startSec(11)),
    });
    expect(res.status()).toBe(401);
    expect(await appointmentsFor(email)).toEqual([]);
    const audit = await auditFor(email);
    expect(audit.some((row) => row.source === 'vapi' && row.outcome === 'rejected' && row.http_status === 401)).toBe(true);
  });

  test('a body tenant id is ignored and the widget session tenant is used', async ({ request }) => {
    const email = `styl266-widget-mismatch-${Date.now()}@example.test`;
    const sessionToken = signChatSessionToken({ chatbotId: ACME_BOT, sessionId: `styl266-${Date.now()}` });
    const res = await request.post('/api/v3/CreateBooking', {
      headers: {
        'x-forwarded-for': '203.0.113.12',
        'x-session-token': sessionToken,
      },
      data: payload(email, startSec(12), GLOBEX_TENANT),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.booking?.status).toBe('CONFIRMED');
    const rows = await appointmentsFor(email);
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(ACME_TENANT);
    const audit = await auditFor(email);
    expect(audit.some((row) => row.source === 'widget' && row.outcome === 'accepted' && row.tenant_id === ACME_TENANT && row.ignored_body_tenant === true)).toBe(true);
  });

  test('a busy slot is rejected and no second appointment is inserted', async ({ request }) => {
    const email = `styl266-busy-${Date.now()}@example.test`;
    const start = startSec(13);
    const startIso = new Date(start * 1000).toISOString();
    const endIso = new Date((start + 3600) * 1000).toISOString();
    const { error: seedError } = await supabaseAdmin.from('appointments').insert({
      tenant_id: ACME_TENANT,
      staff_id: STAFF_ID,
      service_id: SERVICE_ID,
      customer_name: 'Existing Guest',
      customer_email: `styl266-existing-${Date.now()}@example.test`,
      customer_phone: '07700900000',
      start_time: startIso,
      end_time: endIso,
    });
    expect(seedError).toBeNull();

    const res = await request.post('/api/v3/CreateBooking', {
      headers: {
        'x-forwarded-for': '203.0.113.13',
        'x-vapi-secret': vapiSecret,
        'x-vapi-assistant-id': ASSISTANT_ID,
      },
      data: payload(email, start, GLOBEX_TENANT),
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.booking_failure?.reason).toBe('SLOT_UNAVAILABLE');
    expect(await appointmentsFor(email)).toEqual([]);
    const audit = await auditFor(email);
    expect(audit.some((row) => row.outcome === 'rejected' && row.reason === 'slot_unavailable')).toBe(true);
  });

  test('Vapi tool call with the shared secret books the assistant tenant', async ({ request }) => {
    const email = `styl266-vapi-${Date.now()}@example.test`;
    const res = await request.post('/api/v3/CreateBooking', {
      headers: {
        'x-forwarded-for': '203.0.113.14',
        'x-vapi-secret': vapiSecret,
        'x-vapi-assistant-id': ASSISTANT_ID,
      },
      data: payload(email, startSec(14), GLOBEX_TENANT),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.booking?.booking_id).toBeTruthy();
    expect(body.booking?.status).toBe('CONFIRMED');
    const rows = await appointmentsFor(email);
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(ACME_TENANT);
    const audit = await auditFor(email);
    expect(audit.some((row) => row.source === 'vapi' && row.outcome === 'accepted' && row.tenant_id === ACME_TENANT && row.ignored_body_tenant === true)).toBe(true);
  });

  test('numeric slot times book the same way as strings', async ({ request }) => {
    const email = `styl266-numeric-${Date.now()}@example.test`;
    const start = startSec(16);
    const body = payload(email, start);
    body.slot.start_time_sec = start as unknown as string;
    body.slot.duration_sec = 1800 as unknown as string;
    const res = await request.post('/api/v3/CreateBooking', {
      headers: {
        'x-forwarded-for': '203.0.113.16',
        'x-vapi-secret': vapiSecret,
        'x-vapi-assistant-id': ASSISTANT_ID,
      },
      data: body,
    });
    expect(res.status()).toBe(200);
    expect(await appointmentsFor(email)).toHaveLength(1);
  });

  test('rate limit triggers per IP and per tenant', async ({ request }) => {
    const ipEmail = `styl266-rate-ip-${Date.now()}@example.test`;
    const ip = '203.0.113.21';
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await request.post('/api/v3/CreateBooking', {
        headers: {
          'x-forwarded-for': ip,
          'x-vapi-secret': vapiSecret,
          'x-vapi-assistant-id': ASSISTANT_ID,
          'x-test-booking-rate-limit': '2',
          'x-test-booking-tenant-rate-limit': '50',
        },
        data: payload(`${i}-${ipEmail}`, startSec(15) + i * 7200, GLOBEX_TENANT),
      });
      statuses.push(res.status());
    }
    expect(statuses.slice(0, 2).every((status) => status === 200)).toBe(true);
    expect(statuses[2]).toBe(429);
    expect(await appointmentsFor(`2-${ipEmail}`)).toEqual([]);

    await supabaseAdmin
      .from('auth_rate_limits')
      .delete()
      .eq('rate_key', `create-booking:tenant:${ACME_TENANT}`);

    const tenantStatuses: number[] = [];
    let blockedTenantEmail = '';
    for (let i = 0; i < 3; i += 1) {
      const email = `styl266-rate-tenant-${i}-${Date.now()}@example.test`;
      if (i === 2) blockedTenantEmail = email;
      const res = await request.post('/api/v3/CreateBooking', {
        headers: {
          'x-forwarded-for': `203.0.113.${30 + i}`,
          'x-vapi-secret': vapiSecret,
          'x-vapi-assistant-id': ASSISTANT_ID,
          'x-test-booking-rate-limit': '50',
          'x-test-booking-tenant-rate-limit': '2',
        },
        data: payload(email, startSec(18) + i * 7200, GLOBEX_TENANT),
      });
      tenantStatuses.push(res.status());
    }
    expect(tenantStatuses.slice(0, 2).every((status) => status === 200)).toBe(true);
    expect(tenantStatuses[2]).toBe(429);
    expect(await appointmentsFor(blockedTenantEmail)).toEqual([]);
  });
});
