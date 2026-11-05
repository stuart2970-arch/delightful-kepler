import { test, expect } from '@playwright/test';
import { localTimeToUtc } from '../../src/lib/calendar/availability';
import {
  UK_TZ,
  addUkCalendarDays,
  nextUkWeekdayDate,
  nextUkWeekdayDates,
  ukDateStr,
  ukSlotIso,
} from './uk-future-weekday';

test.describe('UK future weekday helper', () => {
  test('skips the current UK date and weekend days', () => {
    // Friday 23:30 UTC is Saturday 00:30 in winter UK, Sunday 23:30 UTC is Monday.
    const fridayUkAfternoon = localTimeToUtc('2026-11-06', '15:00', UK_TZ);
    expect(nextUkWeekdayDate(fridayUkAfternoon)).toBe('2026-11-09');

    const saturdayUtc = new Date('2026-11-07T12:00:00.000Z');
    expect(ukDateStr(saturdayUtc)).toBe('2026-11-07');
    expect(nextUkWeekdayDate(saturdayUtc)).toBe('2026-11-09');

    const sundayUtc = new Date('2026-11-08T12:00:00.000Z');
    expect(nextUkWeekdayDate(sundayUtc)).toBe('2026-11-09');
  });

  test('adds calendar days across the UK autumn clock change without skipping a date', () => {
    expect(addUkCalendarDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addUkCalendarDays('2026-10-25', 1)).toBe('2026-10-26');
  });

  test('returns consecutive future weekdays and a full default working-hours window after now', () => {
    const now = new Date('2026-11-05T13:57:00.000Z');
    const [first, second] = nextUkWeekdayDates(2, now);
    expect(first).toBe('2026-11-06');
    expect(second).toBe('2026-11-09');

    const start = new Date(ukSlotIso(first, '09:00'));
    const end = new Date(ukSlotIso(first, '17:00'));
    expect(start.getTime()).toBeGreaterThan(now.getTime());
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });
});
