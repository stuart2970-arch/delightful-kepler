import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { bookMeeting } from '../src/app/api/chat/stream/calendar';
import {
  hashManageToken,
  issueManageToken,
  MANAGE_TOKEN_TTL_MS,
} from '../src/lib/booking/manage-token';
import { getAvailabilityData } from '../src/app/api/chat/stream/calendar';
import { APPOINTMENT_STATUS_BOOKED, APPOINTMENT_STATUS_CANCELLED } from '../src/lib/booking/appointment-status';

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const seedTenantId = '10000000-0000-0000-0000-000000000001';
const seedStaffId = '30000000-0000-0000-0000-000000000003';
const seedServiceId = '40000000-0000-0000-0000-000000000001';

test.describe('STYL-389 customer booking manage', () => {
  test.beforeAll(async () => {
    process.env.PLAYWRIGHT_TEST = 'true';
    await admin.from('tenant_integrations').upsert(
      {
        tenant_id: seedTenantId,
        provider: 'google_calendar',
        refresh_token: 'mock_google_refresh_token',
      },
      { onConflict: 'tenant_id,provider' },
    );
  });

  test.beforeEach(async () => {
    await admin.from('appointment_manage_tokens').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await admin.from('appointments').delete().eq('tenant_id', seedTenantId);
  });

  test('expired manage token returns generic error', async ({ request }) => {
    const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    start.setUTCHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const { data: appt } = await admin
      .from('appointments')
      .insert({
        tenant_id: seedTenantId,
        staff_id: seedStaffId,
        service_id: seedServiceId,
        customer_name: 'Test User',
        customer_email: 'manage-expire@test.example',
        customer_phone: '07700900123',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        status: APPOINTMENT_STATUS_BOOKED,
        google_event_id: 'mock-evt-expire',
      })
      .select('id')
      .single();

    const issued = await issueManageToken(appt!.id);
    await admin
      .from('appointment_manage_tokens')
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('token_hash', hashManageToken(issued.rawToken));

    const res = await request.get(
      `/api/public/bookings/manage/${encodeURIComponent(issued.rawToken)}`,
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('invalid or has expired');
  });

  test('cancel via manage API frees slot for availability', async ({ request }) => {
    const start = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    start.setUTCHours(11, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const bookResult = await bookMeeting(
      seedTenantId,
      seedStaffId,
      seedServiceId,
      'Cancel Me',
      'cancel-manage@test.example',
      '07700900456',
      startIso,
      endIso,
    );
    expect(bookResult).toContain('Successfully booked');

    const { data: appt } = await admin
      .from('appointments')
      .select('id')
      .eq('tenant_id', seedTenantId)
      .eq('customer_email', 'cancel-manage@test.example')
      .single();

    const issued = await issueManageToken(appt!.id);
    const cancelRes = await request.post(
      `/api/public/bookings/manage/${encodeURIComponent(issued.rawToken)}`,
      { data: { action: 'cancel' } },
    );
    expect(cancelRes.ok()).toBeTruthy();

    const { data: row } = await admin.from('appointments').select('status').eq('id', appt!.id).single();
    expect(row?.status).toBe(APPOINTMENT_STATUS_CANCELLED);

    const windowEnd = new Date(start.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const windowStart = new Date(start.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const avail = await getAvailabilityData(
      seedTenantId,
      seedStaffId,
      seedServiceId,
      windowStart,
      windowEnd,
      'Europe/London',
    );
    expect(avail.outcome).toBe('ok');
    expect(avail.text).toContain(startIso.slice(0, 10));
  });

  test('reschedule via manage API updates appointment times', async ({ request }) => {
    const start = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    start.setUTCHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const newStart = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const newEnd = new Date(newStart.getTime() + 30 * 60 * 1000);

    await bookMeeting(
      seedTenantId,
      seedStaffId,
      seedServiceId,
      'Move Me',
      'reschedule-manage@test.example',
      '07700900789',
      start.toISOString(),
      end.toISOString(),
    );

    const { data: appt } = await admin
      .from('appointments')
      .select('id')
      .eq('customer_email', 'reschedule-manage@test.example')
      .single();

    const issued = await issueManageToken(appt!.id);
    const res = await request.post(
      `/api/public/bookings/manage/${encodeURIComponent(issued.rawToken)}`,
      {
        data: {
          action: 'reschedule',
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
        },
      },
    );
    expect(res.ok()).toBeTruthy();

    const { data: updated } = await admin
      .from('appointments')
      .select('start_time, end_time')
      .eq('id', appt!.id)
      .single();
    expect(new Date(updated!.start_time as string).toISOString()).toBe(newStart.toISOString());
  });

  test('chat stream RULE 6 no longer forbids customer cancellations', async () => {
    const routeSrc = readFileSync(
      path.resolve(__dirname, '../src/app/api/chat/stream/route.ts'),
      'utf8',
    );
    expect(routeSrc).toContain('MANAGE BOOKINGS IN THIS CHAT');
    expect(routeSrc).not.toContain('strictly forbidden from cancelling');
    expect(routeSrc).not.toContain('contact the business directly');
  });

  test('issueManageToken ttl is approximately 30 days', async () => {
    expect(MANAGE_TOKEN_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});