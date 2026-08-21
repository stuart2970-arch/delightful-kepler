/**
 * Utility functions for rolling week schedules and calendar calculations
 */

/**
 * Returns the Monday date of a given date (default: today) in YYYY-MM-DD format (local timezone safe).
 */
export function getMondayDate(inputDate?: Date | string): string {
  const d = inputDate ? new Date(typeof inputDate === 'string' && !inputDate.includes('T') ? inputDate + 'T00:00:00' : inputDate) : new Date();
  if (isNaN(d.getTime())) {
    const fallback = new Date();
    const day = fallback.getDay();
    const diff = fallback.getDate() - day + (day === 0 ? -6 : 1);
    fallback.setDate(diff);
    return fallback.toISOString().split('T')[0];
  }
  
  const day = d.getDay(); // 0 is Sunday, 1 is Monday, ...
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.getFullYear(), d.getMonth(), diff);
  
  const year = monday.getFullYear();
  const month = String(monday.getMonth() + 1).padStart(2, '0');
  const dateNum = String(monday.getDate()).padStart(2, '0');
  return `${year}-${month}-${dateNum}`;
}

/**
 * Adds N days to a YYYY-MM-DD date string and returns the new YYYY-MM-DD string.
 */
export function addDaysToDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const dateNum = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${dateNum}`;
}

/**
 * Formats a Monday YYYY-MM-DD date string into a user-friendly tab label (e.g. "Mon 17/08").
 */
export function formatMondayTabLabel(dateStr: string): string {
  if (!dateStr) return 'Week';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  
  const dayName = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const dayNum = String(d.getDate()).padStart(2, '0');
  const monthNum = String(d.getMonth() + 1).padStart(2, '0');
  return `${dayName} ${dayNum}/${monthNum}`;
}

/**
 * Formats a Monday date string into full format, e.g. "Monday 17/08/2026"
 */
export function formatMondayFull(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  
  const dayNum = String(d.getDate()).padStart(2, '0');
  const monthNum = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `Monday ${dayNum}/${monthNum}/${year}`;
}

/**
 * Generates or synchronizes a rolling list of weekly schedules based on the business's
 * maxAdvanceWeeks booking window.
 *
 * Past weeks that were saved previously are preserved on the left (before current Monday).
 * The current week and future weeks extend to `maxAdvanceWeeks` on the right.
 * At the end of each week, the previous week moves into past weeks (accessible via left scroll),
 * and a new week automatically appears on the right.
 */
export function generateRollingSchedule<T extends { weekCommencingDate?: string }>(
  existingWeeks: T[] = [],
  maxAdvanceWeeks: number = 4,
  createEmpty: (dateStr: string) => T
): { weeks: T[]; currentWeekIndex: number; currentMonday: string } {
  const count = Math.max(1, maxAdvanceWeeks || 4);
  const currentMonday = getMondayDate();

  // Index existing weeks by weekCommencingDate
  const map = new Map<string, T>();
  (existingWeeks || []).forEach(w => {
    if (w && w.weekCommencingDate) {
      map.set(w.weekCommencingDate, w);
    }
  });

  // Preserve any past saved weeks before current Monday (sorted ascending)
  const pastWeeks: T[] = (existingWeeks || [])
    .filter(w => w && w.weekCommencingDate && w.weekCommencingDate < currentMonday)
    .sort((a, b) => (a.weekCommencingDate || '').localeCompare(b.weekCommencingDate || ''));

  // Build the active window starting from current Monday for maxAdvanceWeeks
  const windowWeeks: T[] = [];
  for (let i = 0; i < count; i++) {
    const mondayStr = addDaysToDate(currentMonday, i * 7);
    if (map.has(mondayStr)) {
      windowWeeks.push(map.get(mondayStr)!);
    } else {
      windowWeeks.push(createEmpty(mondayStr));
    }
  }

  const allWeeks = [...pastWeeks, ...windowWeeks];
  const currentWeekIndex = pastWeeks.length;

  return {
    weeks: allWeeks,
    currentWeekIndex,
    currentMonday
  };
}
