import { BusyInterval } from './provider';

export interface Shift {
  start: string; // '09:00'
  end: string;   // '13:00'
}

export interface DaySchedule {
  unavailable?: boolean;
  am?: Shift | null;
  pm?: Shift | null;
  shifts?: Shift[];
}

export interface WeekSchedule {
  weekCommencingDate: string; // 'YYYY-MM-DD'
  monday?: DaySchedule;
  tuesday?: DaySchedule;
  wednesday?: DaySchedule;
  thursday?: DaySchedule;
  friday?: DaySchedule;
  saturday?: DaySchedule;
  sunday?: DaySchedule;
  [key: string]: unknown;
}

export interface StaffSchedule {
  weeks?: WeekSchedule[];
  defaultWeeklyHours?: Record<string, DaySchedule>;
  monday?: DaySchedule;
  tuesday?: DaySchedule;
  wednesday?: DaySchedule;
  thursday?: DaySchedule;
  friday?: DaySchedule;
  saturday?: DaySchedule;
  sunday?: DaySchedule;
  [key: string]: unknown;
}

export interface QualifiedStaff {
  id: string;
  name: string;
  schedule?: StaffSchedule | null;
  customDuration?: number;
  calendar_provider?: string;
  google_calendar_id?: string;
  microsoft_calendar_id?: string;
}

export interface ServiceConfig {
  id: string;
  name: string;
  durationMinutes: number;
  bufferMinutes?: number;
  price?: number;
}

export interface CalculatedSlot {
  start: string;      // ISO string with timezone offset: 2026-10-23T09:30:00+01:00
  end: string;        // ISO string with timezone offset: 2026-10-23T10:30:00+01:00
  startUtc: Date;
  endUtc: Date;
  date: string;       // '2026-10-23'
  time: string;       // '09:30'
  displayDate: string;// 'Thu 23 Oct'
  staffId: string;
  staffName: string;
  serviceId: string;
}

export interface AvailableDay {
  date: string;       // '2026-10-23'
  displayDate: string;// 'Thu 23 Oct'
  slotsCount: number;
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/**
 * Converts a local date ('YYYY-MM-DD') and time ('HH:mm') in a specified timezone to a UTC Date object.
 * Correctly accounts for Daylight Saving Time transitions (e.g. BST vs GMT in Europe/London).
 */
export function localTimeToUtc(dateStr: string, timeStr: string, timeZone: string = 'Europe/London'): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, min] = timeStr.split(':').map(Number);

  // Initial estimate in UTC
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, min, 0));

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(utcGuess);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value;

  const tzYear = parseInt(getPart('year') || String(year), 10);
  const tzMonth = parseInt(getPart('month') || String(month), 10);
  const tzDay = parseInt(getPart('day') || String(day), 10);
  const tzHour = parseInt(getPart('hour') || String(hour), 10);
  const tzMin = parseInt(getPart('minute') || String(min), 10);

  // Calculate difference in milliseconds
  const targetUtcMs = Date.UTC(year, month - 1, day, hour, min, 0);
  const formattedAsUtcMs = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMin, 0);
  const diffMs = targetUtcMs - formattedAsUtcMs;

  return new Date(utcGuess.getTime() + diffMs);
}

/**
 * Gets the local date/time parts for a UTC Date in a given timezone.
 */
export function utcToLocalParts(date: Date, timeZone: string = 'Europe/London'): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dateStr: string;
  timeStr: string;
  dayName: typeof DAY_NAMES[number];
  displayDate: string;
} {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value;

  const year = parseInt(getPart('year') || '1970', 10);
  const month = parseInt(getPart('month') || '01', 10);
  const day = parseInt(getPart('day') || '01', 10);
  const hour = parseInt(getPart('hour') || '00', 10);
  const minute = parseInt(getPart('minute') || '00', 10);

  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${year}-${pad(month)}-${pad(day)}`;
  const timeStr = `${pad(hour)}:${pad(minute)}`;

  // British English display date: "Thu 23 Oct"
  const weekdayDisplay = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }).format(date);
  const monthDisplay = new Intl.DateTimeFormat('en-GB', { timeZone, month: 'short' }).format(date);
  const displayDate = `${weekdayDisplay} ${day} ${monthDisplay}`;

  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const dayName = DAY_NAMES[jsDay];

  return { year, month, day, hour, minute, dateStr, timeStr, dayName, displayDate };
}

/**
 * Returns an ISO 8601 formatted string with the timezone's exact offset (e.g. 2026-10-23T09:00:00+01:00).
 */
export function formatSlotIsoWithOffset(utcDate: Date, timeZone: string = 'Europe/London'): string {
  const parts = utcToLocalParts(utcDate, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');

  // Compute offset between local representation and UTC timestamp
  const localAsUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  const offsetMinutes = Math.round((localAsUtcMs - utcDate.getTime()) / 60000);

  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = pad(Math.floor(absOffset / 60));
  const offsetMins = pad(absOffset % 60);
  const offsetStr = `${sign}${offsetHours}:${offsetMins}`;

  return `${parts.dateStr}T${parts.timeStr}:00${offsetStr}`;
}

/**
 * Resolves shifts for a staff member on a specific local date ('YYYY-MM-DD').
 * Falls back to weekly default hours if the week row is missing or exhausted.
 */
export function resolveDayShifts(
  schedule: StaffSchedule | null | undefined,
  targetDateStr: string,
  dayName: typeof DAY_NAMES[number]
): Shift[] {
  if (!schedule) {
    // Default weekly business hours: Mon-Fri 09:00-17:00, Sat/Sun closed
    if (dayName === 'saturday' || dayName === 'sunday') return [];
    return [
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '17:00' },
    ];
  }

  // 1. Check weekly rota overrides (weeks[])
  const weeks = schedule.weeks || [];
  let activeWeek: WeekSchedule | null = null;

  for (const week of weeks) {
    if (!week.weekCommencingDate) continue;
    const weekStart = week.weekCommencingDate;
    // Calculate weekEnd (weekStart + 7 days)
    const [y, m, d] = weekStart.split('-').map(Number);
    const startObj = new Date(Date.UTC(y, m - 1, d));
    const endObj = new Date(startObj.getTime() + 7 * 24 * 60 * 60 * 1000);
    const endStr = endObj.toISOString().slice(0, 10);

    if (targetDateStr >= weekStart && targetDateStr < endStr) {
      activeWeek = week;
      break;
    }
  }

  const dayConfig: DaySchedule | undefined = activeWeek
    ? activeWeek[dayName]
    : schedule.defaultWeeklyHours?.[dayName] || schedule[dayName];

  if (!dayConfig) {
    // Fall back to standard weekly business hours
    if (dayName === 'saturday' || dayName === 'sunday') return [];
    return [
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '17:00' },
    ];
  }

  if (dayConfig.unavailable) {
    return [];
  }

  const shifts: Shift[] = [];
  if (dayConfig.shifts && Array.isArray(dayConfig.shifts)) {
    shifts.push(...dayConfig.shifts.filter((s) => s.start && s.end));
  } else {
    if (dayConfig.am?.start && dayConfig.am?.end) shifts.push(dayConfig.am);
    if (dayConfig.pm?.start && dayConfig.pm?.end) shifts.push(dayConfig.pm);
  }

  if (shifts.length === 0 && !dayConfig.unavailable) {
    shifts.push({ start: '09:00', end: '17:00' });
  }

  return shifts;
}

export interface CalculateSlotsParams {
  staffList: QualifiedStaff[];
  busyMap: Map<string, BusyInterval[]>;
  service: ServiceConfig;
  startDateUtc: Date;
  endDateUtc: Date;
  maxAdvanceWeeks?: number;
  nowUtc?: Date;
  timeZone?: string;
}

/**
 * Pure function: calculates all genuinely free slots for qualified staff within a date range.
 */
export function calculateAvailableSlots(params: CalculateSlotsParams): CalculatedSlot[] {
  const {
    staffList,
    busyMap,
    service,
    startDateUtc,
    endDateUtc,
    maxAdvanceWeeks = 6,
    nowUtc = new Date(),
    timeZone = 'Europe/London',
  } = params;

  const maxAdvanceDateUtc = new Date(nowUtc.getTime() + maxAdvanceWeeks * 7 * 24 * 60 * 60 * 1000);
  const effectiveEndUtc = endDateUtc < maxAdvanceDateUtc ? endDateUtc : maxAdvanceDateUtc;

  if (startDateUtc >= effectiveEndUtc) {
    return [];
  }

  const allSlots: CalculatedSlot[] = [];

  // Iterate day by day in local time zone
  const currentLocal = utcToLocalParts(startDateUtc, timeZone);
  let iterDateStr = currentLocal.dateStr;

  const endLocal = utcToLocalParts(effectiveEndUtc, timeZone);
  const endLimitDateStr = endLocal.dateStr;

  while (iterDateStr <= endLimitDateStr) {
    const [y, m, d] = iterDateStr.split('-').map(Number);
    const dayDate = new Date(Date.UTC(y, m - 1, d));
    const dayName = DAY_NAMES[dayDate.getUTCDay()];

    for (const staff of staffList) {
      const durationMinutes = (staff.customDuration || service.durationMinutes) + (service.bufferMinutes || 0);
      const durationMs = durationMinutes * 60 * 1000;
      const busyIntervals = busyMap.get(staff.id) || [];

      const shifts = resolveDayShifts(staff.schedule, iterDateStr, dayName);

      for (const shift of shifts) {
        const shiftStartUtc = localTimeToUtc(iterDateStr, shift.start, timeZone);
        const shiftEndUtc = localTimeToUtc(iterDateStr, shift.end, timeZone);

        // Step through shift in 30-minute intervals (or duration if smaller)
        const stepMs = Math.min(30, durationMinutes) * 60 * 1000;
        let slotStartMs = shiftStartUtc.getTime();

        while (slotStartMs + durationMs <= shiftEndUtc.getTime()) {
          const slotEndMs = slotStartMs + durationMs;
          const slotStartUtc = new Date(slotStartMs);
          const slotEndUtc = new Date(slotEndMs);

          // Check constraints:
          // 1. Must be in the future (past-time cut-off)
          // 2. Must be within effectiveEndUtc
          // 3. Must not overlap with any busy intervals
          if (slotStartUtc > nowUtc && slotEndUtc <= effectiveEndUtc) {
            const hasConflict = busyIntervals.some(
              (busy) => slotStartUtc < busy.end && slotEndUtc > busy.start
            );

            if (!hasConflict) {
              const startIso = formatSlotIsoWithOffset(slotStartUtc, timeZone);
              const endIso = formatSlotIsoWithOffset(slotEndUtc, timeZone);
              const parts = utcToLocalParts(slotStartUtc, timeZone);

              allSlots.push({
                start: startIso,
                end: endIso,
                startUtc: slotStartUtc,
                endUtc: slotEndUtc,
                date: parts.dateStr,
                time: parts.timeStr,
                displayDate: parts.displayDate,
                staffId: staff.id,
                staffName: staff.name,
                serviceId: service.id,
              });
            }
          }

          slotStartMs += stepMs;
        }
      }
    }

    // Advance by 1 local day
    const nextDayObj = new Date(Date.UTC(y, m - 1, d + 1));
    iterDateStr = nextDayObj.toISOString().slice(0, 10);
  }

  // Sort chronologically
  allSlots.sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
  return allSlots;
}

/**
 * Returns available distinct days that have at least one free slot.
 */
export function getAvailableDays(slots: CalculatedSlot[], maxDays: number = 7): AvailableDay[] {
  const dayMap = new Map<string, AvailableDay>();

  for (const slot of slots) {
    const existing = dayMap.get(slot.date);
    if (existing) {
      existing.slotsCount += 1;
    } else {
      dayMap.set(slot.date, {
        date: slot.date,
        displayDate: slot.displayDate,
        slotsCount: 1,
      });
    }
  }

  return Array.from(dayMap.values()).slice(0, maxDays);
}

/**
 * Returns all free slots for a specific local date ('YYYY-MM-DD').
 */
export function getSlotsForDay(slots: CalculatedSlot[], dateStr: string): CalculatedSlot[] {
  return slots.filter((s) => s.date === dateStr);
}

/**
 * Formats structured day quick-links tag for widget rendering.
 * [QUICK_DAYS: {"serviceId":"...","staffId":"ANY","days":["2026-10-23", ...]}]
 */
export function formatQuickDaysTag(serviceId: string, staffId: string, days: AvailableDay[]): string {
  const payload = {
    serviceId,
    staffId: staffId || 'ANY',
    days: days.map((d) => ({
      date: d.date,
      label: d.displayDate,
    })),
  };
  return `[QUICK_DAYS: ${JSON.stringify(payload)}]`;
}

/**
 * Formats structured time quick-links tag for widget rendering.
 * [QUICK_TIMES: {"date":"2026-10-23","serviceId":"...","slots":[{"start":"...","staffId":"...","time":"09:30"}]}]
 */
export function formatQuickTimesTag(
  date: string,
  serviceId: string,
  slots: CalculatedSlot[]
): string {
  const payload = {
    date,
    serviceId,
    slots: slots.map((s) => ({
      start: s.start,
      staffId: s.staffId,
      time: s.time,
      staffName: s.staffName,
    })),
  };
  return `[QUICK_TIMES: ${JSON.stringify(payload)}]`;
}

/**
 * Formats structured services quick-links tag for widget rendering (Comment 10092).
 * [QUICK_SERVICES: [{"id":"...","name":"...","duration_minutes":60,"price":50}]]
 */
export function formatQuickServicesTag(
  services: { id: string; name: string; duration_minutes: number; price?: number }[]
): string {
  return `[QUICK_SERVICES: ${JSON.stringify(services)}]`;
}

/**
 * Strips all structured calendar and tool tags ([QUICK_SERVICES], [QUICK_DAYS], [QUICK_TIMES],
 * [TIME_SLOTS], [CHECK_AVAILABILITY], [BOOK_MEETING], [LOOKUP_APPOINTMENTS]) from text
 * using bracket-depth tracking so nested JSON arrays/objects are cleanly removed.
 */
export function stripCalendarTags(text: string): string {
  let result = text;
  const tagList = [
    'QUICK_SERVICES',
    'QUICK_DAYS',
    'QUICK_TIMES',
    'TIME_SLOTS',
    'CHECK_AVAILABILITY',
    'BOOK_MEETING',
    'LOOKUP_APPOINTMENTS',
  ];

  for (const tag of tagList) {
    while (true) {
      const marker = '[' + tag + ':';
      const startIdx = result.indexOf(marker);
      if (startIdx === -1) break;
      let depth = 1;
      let inString = false;
      let escape = false;
      let foundEnd = -1;
      for (let i = startIdx + marker.length; i < result.length; i++) {
        const ch = result[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (ch === '[' || ch === '{') depth++;
          else if (ch === ']' || ch === '}') {
            depth--;
            if (depth === 0) {
              foundEnd = i;
              break;
            }
          }
        }
      }
      if (foundEnd !== -1) {
        result = (result.slice(0, startIdx) + result.slice(foundEnd + 1)).trim();
      } else {
        break;
      }
    }
  }

  return result;
}
