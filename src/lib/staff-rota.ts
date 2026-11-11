export interface RotaWeek {
  weekCommencingDate?: string;
  [key: string]: unknown;
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
