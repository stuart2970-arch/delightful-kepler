import {
  formatSlotIsoWithOffset,
  localTimeToUtc,
  utcToLocalParts,
} from '../../src/lib/calendar/availability';

export const UK_TZ = 'Europe/London';

const WEEKEND = new Set(['saturday', 'sunday']);

export function ukDateStr(now = new Date()): string {
  return utcToLocalParts(now, UK_TZ).dateStr;
}

/** Add calendar days in Europe/London using noon so DST transitions do not skip a date. */
export function addUkCalendarDays(dateStr: string, days: number): string {
  const noon = localTimeToUtc(dateStr, '12:00', UK_TZ);
  return utcToLocalParts(new Date(noon.getTime() + days * 24 * 60 * 60 * 1000), UK_TZ).dateStr;
}

/**
 * First Mon–Fri in Europe/London at least `minDaysAhead` UK calendar days after `now`.
 * Default 1 skips today so a 09:00–17:00 window stays entirely after `now` on a UTC runner.
 */
export function nextUkWeekdayDate(now = new Date(), minDaysAhead = 1): string {
  let dateStr = addUkCalendarDays(ukDateStr(now), minDaysAhead);
  for (let i = 0; i < 14; i++) {
    const dayName = utcToLocalParts(localTimeToUtc(dateStr, '12:00', UK_TZ), UK_TZ).dayName;
    if (!WEEKEND.has(dayName)) return dateStr;
    dateStr = addUkCalendarDays(dateStr, 1);
  }
  throw new Error('Could not find a future UK weekday');
}

export function nextUkWeekdayDates(count: number, now = new Date()): string[] {
  const out: string[] = [];
  let probe = now;
  for (let i = 0; i < count; i++) {
    const dateStr = nextUkWeekdayDate(probe);
    out.push(dateStr);
    probe = localTimeToUtc(dateStr, '12:00', UK_TZ);
  }
  return out;
}

export function ukLocalWall(dateStr: string, time: string): string {
  return `${dateStr}T${time}:00`;
}

export function ukSlotIso(dateStr: string, time: string): string {
  return formatSlotIsoWithOffset(localTimeToUtc(dateStr, time, UK_TZ), UK_TZ);
}

export function ukSlotUtcIso(dateStr: string, time: string): string {
  return localTimeToUtc(dateStr, time, UK_TZ).toISOString();
}

export function ukDisplayDate(dateStr: string): string {
  return utcToLocalParts(localTimeToUtc(dateStr, '12:00', UK_TZ), UK_TZ).displayDate;
}
