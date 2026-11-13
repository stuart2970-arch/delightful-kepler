export interface RotaWeek {
  weekCommencingDate?: string;
  [key: string]: unknown;
}

const ROTA_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

/**
 * Editor grid for Edit Rota. Saved weeks are kept. If the current week is
 * missing, or the rota is only the old per-day map, the current week is
 * shown so the grid is not empty. seededDate is set when that week was not
 * already stored, so an unchanged save can still drop it.
 */
export function rotaWeeksForEditor(
  workingDays: unknown,
  currentMonday: string,
  createWeek: (date: string) => RotaWeek,
): { weeks: RotaWeek[]; activeIndex: number; seededDate: string | null } {
  const saved = weeksFromWorkingDays(workingDays).map((week) => JSON.parse(JSON.stringify(week)) as RotaWeek);

  const currentFromFlat = (): RotaWeek => {
    const week = createWeek(currentMonday);
    if (workingDays && typeof workingDays === 'object' && !Array.isArray(workingDays)) {
      const source = workingDays as Record<string, unknown>;
      for (const day of ROTA_DAYS) {
        if (source[day] && typeof source[day] === 'object') {
          week[day] = JSON.parse(JSON.stringify(source[day]));
        }
      }
    }
    return week;
  };

  if (saved.length === 0) {
    return { weeks: [currentFromFlat()], activeIndex: 0, seededDate: currentMonday };
  }

  let activeIndex = saved.findIndex((week) => week.weekCommencingDate === currentMonday);
  if (activeIndex >= 0) {
    return { weeks: saved, activeIndex, seededDate: null };
  }

  saved.push(createWeek(currentMonday));
  saved.sort((a, b) => (a.weekCommencingDate || '').localeCompare(b.weekCommencingDate || ''));
  activeIndex = saved.findIndex((week) => week.weekCommencingDate === currentMonday);
  return { weeks: saved, activeIndex: Math.max(activeIndex, 0), seededDate: currentMonday };
}

export function weeksFromWorkingDays(workingDays: unknown): RotaWeek[] {
  if (!workingDays || typeof workingDays !== 'object' || Array.isArray(workingDays)) return [];
  const weeks = (workingDays as { weeks?: unknown }).weeks;
  if (!Array.isArray(weeks)) return [];
  return weeks.filter((week): week is RotaWeek => Boolean(week) && typeof week === 'object');
}

/**
 * Saving Staff & Rota must not append weeks the owner did not already have
 * or explicitly add. An unchanged save returns the original working_days.
 */
export function workingDaysForStaffSave(input: {
  isUpdate: boolean;
  rotaDirty: boolean;
  original: unknown;
  edited: unknown;
  explicitlyAddedDates?: string[];
}): unknown {
  if (!input.isUpdate) return input.edited;
  if (!input.rotaDirty) return input.original ?? { weeks: [] };

  const originalWeeks = weeksFromWorkingDays(input.original);
  const editedWeeks = weeksFromWorkingDays(input.edited);
  const allowed = new Set(
    [
      ...originalWeeks.map((week) => week.weekCommencingDate),
      ...(input.explicitlyAddedDates || []),
    ].filter((date): date is string => Boolean(date)),
  );

  const kept = editedWeeks.filter(
    (week) => week.weekCommencingDate && allowed.has(week.weekCommencingDate),
  );

  if (input.original && typeof input.original === 'object' && !Array.isArray(input.original)) {
    return { ...(input.original as Record<string, unknown>), weeks: kept };
  }
  return { weeks: kept };
}
