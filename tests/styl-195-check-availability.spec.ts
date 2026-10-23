import { test, expect } from '@playwright/test';
import { getAvailabilityData } from '../src/app/api/chat/stream/calendar';
import { queryStaffCalendars, STAFF_CALENDAR_TIMEOUT_MS } from '../src/lib/calendar/staff-busy';
import { directAvailabilitySpeech } from '../src/lib/calendar/fallback-message';
import type { BusyLookup } from '../src/lib/calendar/staff-busy';
import type { StaffCalendarTarget } from '../src/lib/calendar/provider';

const BOOKING_URL = 'https://salon.example/book';
const WINDOW_START = '2026-10-26T09:00:00+00:00';
const WINDOW_END = '2026-10-26T12:00:00+00:00';
const NOW = new Date('2026-10-26T08:00:00.000Z');

const assistedSetup = {
  id: 'svc-assisted',
  name: 'Assisted Setup',
  duration_minutes: 30,
  buffer_minutes: 0,
  price: 0,
};

function rotaStaff(id: string, name: string) {
  return {
    id,
    name,
    calendar_provider: 'google',
    google_calendar_id: 'primary',
    working_days: {
      monday: {
        unavailable: false,
        am: { start: '09:00', end: '12:00' },
        pm: null,
      },
    },
  };
}

const jane = rotaStaff('staff-jane', 'Jane');
const stuart = rotaStaff('staff-stuart', 'Stuart');

function notConnected(): BusyLookup {
  return async () => {
    throw new Error('No calendar provider connected for this business or staff member');
  };
}

test.describe('STYL-195 check availability', () => {
  test('queries staff calendars in parallel', async () => {
    const order: string[] = [];
    const started = Date.now();
    const staff: StaffCalendarTarget[] = [
      { id: 'staff-jane', name: 'Jane' },
      { id: 'staff-stuart', name: 'Stuart' },
    ];

    const result = await queryStaffCalendars({
      tenantId: 'tenant-test',
      staff,
      startUtc: NOW,
      endUtc: new Date(WINDOW_END),
      timeoutMs: 1000,
      lookup: async (_tenantId, member) => {
        order.push(`start-${member.id}`);
        await new Promise((resolve) => setTimeout(resolve, 120));
        order.push(`end-${member.id}`);
        return [];
      },
    });

    expect(Date.now() - started).toBeLessThan(220);
    expect(order.slice(0, 2).sort()).toEqual(['start-staff-jane', 'start-staff-stuart']);
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    expect(STAFF_CALENDAR_TIMEOUT_MS).toBe(8000);
  });

  test('normal calendar reply offers rota times and honours busy periods', async () => {
    const open = await getAvailabilityData(
      'tenant-test',
      'ANY',
      assistedSetup.id,
      WINDOW_START,
      WINDOW_END,
      'Europe/London',
      {
        now: NOW,
        fixture: { service: assistedSetup, staff: [jane, stuart], bookingUrl: BOOKING_URL },
        lookup: async () => [],
      }
    );

    expect(open.outcome).toBe('ok');
    expect(open.slots.length).toBeGreaterThan(0);
    expect(open.slots.some((slot) => slot.staffId === jane.id)).toBe(true);
    expect(open.slots.some((slot) => slot.staffId === stuart.id)).toBe(true);
    expect(open.quickDaysTag).toContain('[QUICK_DAYS:');

    const janeBusy = await getAvailabilityData(
      'tenant-test',
      'ANY',
      assistedSetup.id,
      WINDOW_START,
      WINDOW_END,
      'Europe/London',
      {
        now: NOW,
        fixture: { service: assistedSetup, staff: [jane, stuart] },
        lookup: async (_tenantId, member) => {
          if (member.id === jane.id) {
            return [{
              start: new Date('2026-10-26T09:00:00.000Z'),
              end: new Date('2026-10-26T12:00:00.000Z'),
            }];
          }
          return [];
        },
      }
    );

    expect(janeBusy.outcome).toBe('ok');
    expect(janeBusy.slots.every((slot) => slot.staffId === stuart.id)).toBe(true);
    expect(janeBusy.slots.length).toBeGreaterThan(0);
  });

  test('8s hang excludes that calendar and does not treat it as free time', async () => {
    test.setTimeout(20_000);
    const logs: string[] = [];
    const started = Date.now();

    const avail = await getAvailabilityData(
      'tenant-test',
      'ANY',
      assistedSetup.id,
      WINDOW_START,
      WINDOW_END,
      'Europe/London',
      {
        now: NOW,
        log: (message) => logs.push(message),
        lookup: () => new Promise(() => {}),
        fixture: { service: assistedSetup, staff: [jane], bookingUrl: BOOKING_URL },
      }
    );

    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(STAFF_CALENDAR_TIMEOUT_MS);
    expect(elapsed).toBeLessThan(15_000);
    expect(avail.outcome).toBe('unreachable');
    expect(avail.slots).toEqual([]);
    expect(avail.quickDaysTag).toBe('');
    expect(avail.text).toContain('name');
    expect(avail.text).toContain('phone number');
    expect(avail.text).toContain('preferred time');
    expect(avail.text).toContain(BOOKING_URL);
    expect(avail.text.toLowerCase()).not.toContain('give us a');
    expect(avail.text).not.toMatch(/\b09:00\b/);
    expect(logs.join('\n')).toContain('Jane');
    expect(logs.join('\n')).toContain('timeout');
    expect(directAvailabilitySpeech(avail.outcome, avail.text)).toBe(avail.text);
  });

  test('partial failure offers only the calendars that answered and logs the rest', async () => {
    const logs: string[] = [];
    const avail = await getAvailabilityData(
      'tenant-test',
      stuart.id,
      assistedSetup.id,
      WINDOW_START,
      WINDOW_END,
      'Europe/London',
      {
        now: NOW,
        timeoutMs: 40,
        log: (message) => logs.push(message),
        fixture: { service: assistedSetup, staff: [jane, stuart], bookingUrl: BOOKING_URL },
        lookup: async (_tenantId, member) => {
          if (member.id === stuart.id) return new Promise(() => {});
          return [];
        },
      }
    );

    expect(avail.outcome).toBe('ok');
    expect(avail.slots.length).toBeGreaterThan(0);
    expect(avail.slots.every((slot) => slot.staffId === jane.id)).toBe(true);
    expect(avail.text).toContain("couldn't check Stuart's calendar");
    expect(logs.join('\n')).toContain('Stuart');
    expect(logs.join('\n')).toContain('timeout');
    expect(directAvailabilitySpeech(avail.outcome, avail.text)).toBeNull();
  });

  test('no calendar connected offers no rota times and asks for details or the booking link', async () => {
    const logs: string[] = [];
    const avail = await getAvailabilityData(
      'tenant-test',
      'ANY',
      assistedSetup.id,
      WINDOW_START,
      WINDOW_END,
      'Europe/London',
      {
        now: NOW,
        log: (message) => logs.push(message),
        fixture: { service: assistedSetup, staff: [jane, stuart], bookingUrl: BOOKING_URL },
        lookup: notConnected(),
      }
    );

    expect(avail.outcome).toBe('none_connected');
    expect(avail.slots).toEqual([]);
    expect(avail.quickDaysTag).toBe('');
    expect(avail.timeSlotsTag).toBe('');
    expect(avail.text).toContain('no calendar connected');
    expect(avail.text).toContain('name');
    expect(avail.text).toContain('phone number');
    expect(avail.text).toContain('preferred time');
    expect(avail.text).toContain(BOOKING_URL);
    expect(avail.text.toLowerCase()).not.toContain('give us a');
    expect(avail.text).not.toMatch(/\b09:00\b/);
    expect(logs.join('\n')).toContain('Jane');
    expect(logs.join('\n')).toContain('Stuart');
    expect(logs.join('\n')).toContain('not_connected');
  });

  test('unknown service returns no times and does not ask the calendars', async () => {
    let lookups = 0;
    const avail = await getAvailabilityData(
      'tenant-test',
      'ANY',
      'missing-service',
      WINDOW_START,
      WINDOW_END,
      'Europe/London',
      {
        now: NOW,
        fixture: { service: null, staff: [jane] },
        lookup: async () => {
          lookups += 1;
          return [];
        },
      }
    );

    expect(avail.outcome).toBe('service_not_found');
    expect(avail.slots).toEqual([]);
    expect(avail.text).toContain('Service not found');
    expect(lookups).toBe(0);
    expect(directAvailabilitySpeech(avail.outcome, avail.text)).toContain("couldn't find that specific service");
  });

  test('no staff returns no times and does not ask the calendars', async () => {
    let lookups = 0;
    const avail = await getAvailabilityData(
      'tenant-test',
      'ANY',
      assistedSetup.id,
      WINDOW_START,
      WINDOW_END,
      'Europe/London',
      {
        now: NOW,
        fixture: { service: assistedSetup, staff: [] },
        lookup: async () => {
          lookups += 1;
          return [];
        },
      }
    );

    expect(avail.outcome).toBe('no_staff');
    expect(avail.slots).toEqual([]);
    expect(avail.text.toLowerCase()).toContain('no staff members');
    expect(lookups).toBe(0);
    const speech = directAvailabilitySpeech(avail.outcome, avail.text) || '';
    expect(speech).toContain('name');
    expect(speech).toContain('phone number');
    expect(speech).toContain('preferred time');
    expect(speech.toLowerCase()).not.toContain('give us a');
  });
});
