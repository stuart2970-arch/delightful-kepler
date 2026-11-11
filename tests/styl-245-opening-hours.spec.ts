import { test, expect } from '@playwright/test';
import { calculateAvailableSlots } from '../src/lib/calendar/availability';
import {
  WEEK_DAYS,
  formatOpeningHoursForPrompt,
  normaliseOpeningHours,
  openingHoursForSave,
  rotaExtendsOutsideOpening,
  staffHoursOverrideAccepted,
} from '../src/lib/opening-hours';

/**
 * STYL-245: saving opening hours must store all seven days.
 * A tenant that only has Saturday and Sunday closed keeps a weekday fallback
 * until the owner saves. Slots follow opening hours unless staff hours were accepted.
 */

const weekendOnly = {
  saturday: { closed: true, open: '09:00', close: '17:00' },
  sunday: { closed: true, open: '09:00', close: '17:00' },
};

test.describe('STYL-245 opening hours', () => {
  test('a partial save stores Monday to Sunday', () => {
    const stored = openingHoursForSave(weekendOnly);
    expect(Object.keys(stored)).toEqual([...WEEK_DAYS]);
    expect(stored.monday).toEqual({ closed: false, open: '09:00', close: '17:00' });
    expect(stored.friday.close).toBe('17:00');
    expect(stored.saturday.closed).toBe(true);
    expect(stored.sunday.closed).toBe(true);
    expect(normaliseOpeningHours(weekendOnly).weekdaysMissing).toBe(true);
  });

  test('the hours shape already used by the salon is read, including closed weekends', () => {
    const view = normaliseOpeningHours({
      monday: { unavailable: false, hours: { start: '10:00', end: '16:00' } },
      tuesday: { unavailable: false, hours: { start: '10:00', end: '16:00' } },
      wednesday: { unavailable: false, hours: { start: '10:00', end: '16:00' } },
      thursday: { unavailable: false, hours: { start: '10:00', end: '16:00' } },
      friday: { unavailable: false, hours: { start: '10:00', end: '16:00' } },
      saturday: { unavailable: true, hours: null },
      sunday: { unavailable: true, hours: null },
    });
    expect(view.weekdaysMissing).toBe(false);
    expect(view.days.monday).toMatchObject({ open: '10:00', close: '16:00', closed: false, missing: false });
    expect(view.days.saturday.closed).toBe(true);
  });

  test('the receptionist prompt lists all seven days and warns when weekdays were missing', () => {
    const text = formatOpeningHoursForPrompt(normaliseOpeningHours(weekendOnly));
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      expect(text).toContain(`${day}:`);
    }
    expect(text).toContain('Saturday: Closed');
    expect(text).toContain('Monday to Friday were missing');
    const spoken = formatOpeningHoursForPrompt(normaliseOpeningHours(weekendOnly), { spoken: true });
    expect(spoken).toContain('Monday: 09:00 to 17:00');
  });

  test('slots stay inside opening hours until the owner accepts staff hours', () => {
    const hours = normaliseOpeningHours({
      monday: { closed: false, open: '09:00', close: '17:00' },
      tuesday: { closed: true },
      wednesday: { closed: true },
      thursday: { closed: true },
      friday: { closed: true },
      saturday: { closed: true },
      sunday: { closed: true },
    });
    const schedule = {
      weeks: [{
        weekCommencingDate: '2026-11-16',
        monday: {
          unavailable: false,
          am: { start: '09:00', end: '13:00' },
          pm: { start: '14:00', end: '18:00' },
        },
        saturday: {
          unavailable: false,
          am: { start: '10:00', end: '14:00' },
          pm: null,
        },
      }],
    };
    const base = {
      staffList: [{ id: 'stylist', name: 'Sam', schedule }],
      busyMap: new Map<string, never[]>(),
      service: { id: 'cut', name: 'Cut', durationMinutes: 30 },
      startDateUtc: new Date('2026-11-16T00:00:00.000Z'),
      endDateUtc: new Date('2026-11-22T00:00:00.000Z'),
      nowUtc: new Date('2026-11-16T08:00:00.000Z'),
      timeZone: 'Europe/London',
      maxAdvanceWeeks: 4,
    };

    const clipped = calculateAvailableSlots({
      ...base,
      openingHours: hours,
      staffHoursOverrideAccepted: false,
    });
    expect(clipped.length).toBeGreaterThan(0);
    expect(clipped.every((slot) => slot.date === '2026-11-16')).toBe(true);
    expect(clipped.every((slot) => slot.time < '17:00')).toBe(true);
    expect(clipped.some((slot) => slot.time >= '17:00')).toBe(false);

    const allowed = calculateAvailableSlots({
      ...base,
      openingHours: hours,
      staffHoursOverrideAccepted: true,
    });
    expect(allowed.some((slot) => slot.time >= '17:00')).toBe(true);
    expect(allowed.some((slot) => slot.date === '2026-11-21')).toBe(true);

    expect(rotaExtendsOutsideOpening(schedule, hours)).toBe(true);
    expect(staffHoursOverrideAccepted({ staff_hours_outside_opening_accepted: true })).toBe(true);
    expect(staffHoursOverrideAccepted({})).toBe(false);
  });

  test('missing weekdays fall back without rewriting a stored weekend-only object in memory', () => {
    const view = normaliseOpeningHours(weekendOnly);
    expect(view.days.wednesday.missing).toBe(true);
    expect(view.days.wednesday.open).toBe('09:00');
    expect(weekendOnly).not.toHaveProperty('monday');
  });
});
