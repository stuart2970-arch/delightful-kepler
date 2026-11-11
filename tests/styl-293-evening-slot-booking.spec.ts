import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import dotenv from 'dotenv';
import {
  formatSlotIsoWithOffset,
  localTimeToUtc,
  utcToLocalParts,
} from '../src/lib/calendar/availability';
import { getAvailabilityData } from '../src/app/api/chat/stream/calendar';

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true });

/**
 * STYL-293: a widget evening slot (staff hours 18:00–20:00, default calendars)
 * must book onto the rota. "Just taken" is only for a real clash, and that
 * start time is not offered again.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TENANT = '10000000-0000-0000-0000-000000000001';
const BOT = 'e0000000-0000-0000-0000-000000000001';
const TZ = 'Europe/London';

const closed = { unavailable: true, am: null, pm: null };
const eveningOnly = {
  monday: closed,
  tuesday: closed,
  wednesday: closed,
  thursday: closed,
  friday: closed,
  saturday: { unavailable: false, am: null, pm: { start: '18:00', end: '20:00' } },
  sunday: closed,
};

function nextSaturday(): string {
  let dateStr = utcToLocalParts(new Date(Date.now() + 24 * 60 * 60 * 1000), TZ).dateStr;
  for (let i = 0; i < 14; i += 1) {
    const noon = localTimeToUtc(dateStr, '12:00', TZ);
    if (utcToLocalParts(noon, TZ).dayName === 'saturday') return dateStr;
    const [year, month, day] = dateStr.split('-').map(Number);
    dateStr = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  }
  throw new Error('No upcoming Saturday');
}

test.describe('STYL-293 evening widget booking', () => {
  const staffA = crypto.randomUUID();
  const staffB = crypto.randomUUID();
  const serviceId = crypto.randomUUID();
  const saturday = nextSaturday();
  const slotStart = formatSlotIsoWithOffset(localTimeToUtc(saturday, '18:00', TZ), TZ);

  test.beforeAll(async () => {
    expect(serviceRoleKey).not.toEqual('');
    expect(supabaseUrl).not.toContain('tkoasyjvrgaglofpzduq');

    const staffRow = {
      tenant_id: TENANT,
      chatbot_id: BOT,
      working_days: eveningOnly,
      calendar_provider: 'google',
      google_calendar_id: 'primary',
    };
    const { error: staffError } = await supabaseAdmin.from('staff').insert([
      { ...staffRow, id: staffA, name: 'David Evening', email: 'david.evening@example.test' },
      { ...staffRow, id: staffB, name: 'Stuart Evening', email: 'stuart.evening@example.test' },
    ]);
    expect(staffError).toBeNull();

    const { error: serviceError } = await supabaseAdmin.from('services').insert({
      id: serviceId,
      tenant_id: TENANT,
      chatbot_id: BOT,
      name: 'Assisted Setup Evening',
      duration_minutes: 30,
      buffer_minutes: 10,
      price: 0,
    });
    expect(serviceError).toBeNull();

    await supabaseAdmin.from('tenant_integrations').upsert({
      tenant_id: TENANT,
      provider: 'google_calendar',
      refresh_token: 'mock_google_refresh_token',
    }, { onConflict: 'tenant_id,provider' });
  });

  test.afterAll(async () => {
    await supabaseAdmin.from('appointments').delete().in('staff_id', [staffA, staffB]);
    await supabaseAdmin.from('services').delete().eq('id', serviceId);
    await supabaseAdmin.from('staff').delete().in('id', [staffA, staffB]);
  });

  test('books a Saturday 18:00 slot on the default calendar and writes the rota row', async ({ request }) => {
    const offered = await getAvailabilityData(
      TENANT,
      'ANY',
      serviceId,
      localTimeToUtc(saturday, '00:00', TZ).toISOString(),
      localTimeToUtc(saturday, '23:00', TZ).toISOString(),
      TZ,
    );
    const evening = offered.slots.filter((slot) => slot.time === '18:00');
    expect(evening.map((slot) => slot.staffId).sort()).toEqual([staffA, staffB].sort());

    const sessionRes = await request.post('/api/chat/public-init', {
      headers: {
        'Content-Type': 'application/json',
        'x-turnstile-token': '1x0000000000000000000000000000000AA',
      },
      data: { chatbotId: BOT },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const { sessionToken, sessionId } = await sessionRes.json();

    const email = `styl293-evening-${Date.now()}@example.test`;
    const res = await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': sessionToken,
      },
      data: {
        chatbotId: BOT,
        sessionId,
        action: 'select_slot',
        start: slotStart,
        staffId: staffA,
        serviceId,
        clientName: 'Evening Guest',
        clientEmail: email,
        message: '18:00',
      },
    });
    expect(res.ok()).toBeTruthy();
    const reply = await res.text();
    expect(reply).not.toMatch(/just taken/i);
    expect(reply).toContain('confirmed');
    expect(reply).toContain('18:00');

    const { data: appt, error } = await supabaseAdmin
      .from('appointments')
      .select('start_time, end_time, staff_id, tenant_id')
      .eq('customer_email', email)
      .maybeSingle();
    expect(error).toBeNull();
    expect(appt?.staff_id).toBe(staffA);
    expect(appt?.tenant_id).toBe(TENANT);
    expect(new Date(appt!.start_time).toISOString()).toBe(localTimeToUtc(saturday, '18:00', TZ).toISOString());
    expect(new Date(appt!.end_time).toISOString()).toBe(localTimeToUtc(saturday, '18:30', TZ).toISOString());
  });

  test('a real clash says the slot was taken and does not offer that start again', async ({ request }) => {
    const email = `styl293-clash-${Date.now()}@example.test`;
    const start = localTimeToUtc(saturday, '18:00', TZ);
    const end = localTimeToUtc(saturday, '18:30', TZ);
    const { error: seedError } = await supabaseAdmin.from('appointments').insert({
      tenant_id: TENANT,
      staff_id: staffB,
      service_id: serviceId,
      customer_name: 'Already Booked',
      customer_email: `styl293-held-${Date.now()}@example.test`,
      customer_phone: '07700900444',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
    });
    expect(seedError).toBeNull();

    const sessionRes = await request.post('/api/chat/public-init', {
      headers: {
        'Content-Type': 'application/json',
        'x-turnstile-token': '1x0000000000000000000000000000000AA',
      },
      data: { chatbotId: BOT },
    });
    const { sessionToken, sessionId } = await sessionRes.json();
    const res = await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': sessionToken,
      },
      data: {
        chatbotId: BOT,
        sessionId,
        action: 'select_slot',
        start: slotStart,
        staffId: staffB,
        serviceId,
        clientName: 'Second Guest',
        clientEmail: email,
        clientPhone: '07700900445',
        message: '18:00',
      },
    });
    expect(res.ok()).toBeTruthy();
    const reply = await res.text();
    expect(reply).toMatch(/slot was just taken/i);
    const tagAt = reply.indexOf('[QUICK_TIMES:');
    expect(tagAt).toBeGreaterThan(-1);
    const jsonStart = reply.indexOf('{', tagAt);
    let depth = 0;
    let jsonEnd = -1;
    for (let i = jsonStart; i < reply.length; i += 1) {
      if (reply[i] === '{') depth += 1;
      else if (reply[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          jsonEnd = i;
          break;
        }
      }
    }
    const payload = JSON.parse(reply.slice(jsonStart, jsonEnd + 1));
    const stillOffered = (payload.slots || []).some(
      (slot: { staffId?: string; time?: string }) => slot.staffId === staffB && slot.time === '18:00',
    );
    expect(stillOffered).toBe(false);

    const { data: second } = await supabaseAdmin
      .from('appointments')
      .select('id')
      .eq('customer_email', email)
      .maybeSingle();
    expect(second).toBeNull();
  });
});
