export const WEEK_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type WeekDay = (typeof WEEK_DAYS)[number];

const WEEKDAY_SET = new Set<string>(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);

export const FALLBACK_OPEN = '09:00';
export const FALLBACK_CLOSE = '17:00';

export interface DayHours {
  closed: boolean;
  open: string;
  close: string;
  /** True when this day was not stored and the UI/slot fallback is in use. */
  missing: boolean;
}

export interface OpeningHoursView {
  days: Record<WeekDay, DayHours>;
  /** Monday–Friday were absent from the stored object. */
  weekdaysMissing: boolean;
}

export interface StoredDayHours {
  closed: boolean;
  open: string;
  close: string;
}

export interface ShiftWindow {
  start: string;
  end: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Read one stored day. Returns null when that day key is absent or unusable. */
export function readStoredDay(raw: unknown): Omit<DayHours, 'missing'> | null {
  if (!isRecord(raw)) return null;

  if (raw.closed === true || raw.unavailable === true) {
    return { closed: true, open: FALLBACK_OPEN, close: FALLBACK_CLOSE };
  }

  if (typeof raw.open === 'string' && raw.open && typeof raw.close === 'string' && raw.close) {
    return { closed: false, open: raw.open, close: raw.close };
  }

  const hours = raw.hours;
  if (isRecord(hours) && typeof hours.start === 'string' && hours.start && typeof hours.end === 'string' && hours.end) {
    return { closed: false, open: hours.start, close: hours.end };
  }

  if ('closed' in raw || 'unavailable' in raw || 'open' in raw || 'hours' in raw) {
    return { closed: false, open: FALLBACK_OPEN, close: FALLBACK_CLOSE };
  }

  return null;
}

/**
 * Every day the opening-hours screen shows, including days that were never saved.
 * Missing days use 09:00–17:00 (the same default the dashboard already displays).
 * This does not write anything back to the tenant.
 */
export function normaliseOpeningHours(raw: unknown): OpeningHoursView {
  const source = isRecord(raw) ? raw : {};
  const days = {} as Record<WeekDay, DayHours>;
  let weekdaysMissing = false;

  for (const day of WEEK_DAYS) {
    const parsed = readStoredDay(source[day]);
    if (!parsed) {
      if (WEEKDAY_SET.has(day)) weekdaysMissing = true;
      days[day] = { closed: false, open: FALLBACK_OPEN, close: FALLBACK_CLOSE, missing: true };
    } else {
      days[day] = { ...parsed, missing: false };
    }
  }

  return { days, weekdaysMissing };
}

/** Canonical seven-day payload for general_operating_hours. */
export function storedOpeningHours(view: OpeningHoursView): Record<WeekDay, StoredDayHours> {
  const stored = {} as Record<WeekDay, StoredDayHours>;
  for (const day of WEEK_DAYS) {
    const entry = view.days[day];
    stored[day] = { closed: entry.closed, open: entry.open, close: entry.close };
  }
  return stored;
}

export function openingHoursForSave(raw: unknown): Record<WeekDay, StoredDayHours> {
  return storedOpeningHours(normaliseOpeningHours(raw));
}

export function formatOpeningHoursForPrompt(view: OpeningHoursView, options?: { spoken?: boolean }): string {
  const lines = WEEK_DAYS.map((day) => {
    const entry = view.days[day];
    const label = day.charAt(0).toUpperCase() + day.slice(1);
    if (entry.closed) return `${label}: Closed`;
    const range = options?.spoken ? `${entry.open} to ${entry.close}` : `${entry.open}–${entry.close}`;
    const note = entry.missing ? ' (not saved yet; using 09:00–17:00 until opening hours are saved)' : '';
    return `${label}: ${range}${note}`;
  });
  if (view.weekdaysMissing) {
    lines.push(
      'Warning: Monday to Friday were missing from saved opening hours. Those days use 09:00–17:00 until the owner saves opening hours.',
    );
  }
  return options?.spoken ? lines.join('. ') : lines.join('\n');
}

/** Clip a staff shift to the salon's opening window. Null when the day is closed or the overlap is empty. */
export function clipShiftToOpening(shift: ShiftWindow, day: Pick<DayHours, 'closed' | 'open' | 'close'>): ShiftWindow | null {
  if (day.closed) return null;
  const start = shift.start > day.open ? shift.start : day.open;
  const end = shift.end < day.close ? shift.end : day.close;
  if (!start || !end || start >= end) return null;
  return { start, end };
}

function shiftsOnDay(day: unknown): ShiftWindow[] {
  if (!isRecord(day) || day.unavailable === true || day.closed === true) return [];
  const shifts: ShiftWindow[] = [];
  const push = (value: unknown) => {
    if (!isRecord(value)) return;
    if (typeof value.start === 'string' && value.start && typeof value.end === 'string' && value.end) {
      shifts.push({ start: value.start, end: value.end });
    }
  };
  push(day.am);
  push(day.pm);
  if (Array.isArray(day.shifts)) day.shifts.forEach(push);
  return shifts;
}

function shiftWasClipped(original: ShiftWindow, clipped: ShiftWindow | null): boolean {
  if (!clipped) return true;
  return clipped.start !== original.start || clipped.end !== original.end;
}

/** True when any saved staff shift sits outside the opening hours the owner has (including fallbacks). */
export function rotaExtendsOutsideOpening(workingDays: unknown, hours: OpeningHoursView): boolean {
  const weeks = weeksOf(workingDays);
  const sources = weeks.length > 0 ? weeks : [workingDays];

  for (const source of sources) {
    if (!isRecord(source)) continue;
    for (const day of WEEK_DAYS) {
      const opening = hours.days[day];
      for (const shift of shiftsOnDay(source[day])) {
        if (shiftWasClipped(shift, clipShiftToOpening(shift, opening))) return true;
      }
    }
  }
  return false;
}

function weeksOf(workingDays: unknown): Record<string, unknown>[] {
  if (!isRecord(workingDays) || !Array.isArray(workingDays.weeks)) return [];
  return workingDays.weeks.filter(isRecord);
}

export function staffHoursOverrideAccepted(holidaySettings: unknown): boolean {
  return isRecord(holidaySettings) && holidaySettings.staff_hours_outside_opening_accepted === true;
}
