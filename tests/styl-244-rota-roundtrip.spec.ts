import { test, expect } from '@playwright/test';
import { rotaWeeksForEditor, workingDaysForStaffSave, weeksFromWorkingDays } from '../src/lib/staff-rota';

/**
 * STYL-244: opening Edit Rota and saving must not append a week.
 * The rolling editor used to fill the booking window with a template whose
 * Saturday is open and afternoons run 14:00–18:00.
 */

function week(date: string, afternoonEnd = '17:00', saturdayOpen = false) {
  const closed = { unavailable: true, am: null, pm: null };
  const open = {
    unavailable: false,
    am: { start: '09:00', end: '13:00' },
    pm: { start: '13:00', end: afternoonEnd },
  };
  return {
    weekCommencingDate: date,
    monday: open,
    tuesday: open,
    wednesday: open,
    thursday: open,
    friday: open,
    saturday: saturdayOpen
      ? { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } }
      : closed,
    sunday: closed,
  };
}

const originalWeeks = [
  '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30',
  '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28',
  '2027-01-04', '2027-01-11', '2027-01-18',
].map((date) => week(date));

const invented = week('2027-01-25', '18:00', true);

test.describe('STYL-244 rota round-trip', () => {
  test('an unchanged save returns the original working_days', () => {
    const original = { weeks: originalWeeks };
    const edited = { weeks: [...originalWeeks, invented] };

    const saved = workingDaysForStaffSave({
      isUpdate: true,
      rotaDirty: false,
      original,
      edited,
    });

    expect(saved).toBe(original);
    expect(weeksFromWorkingDays(saved)).toHaveLength(12);
    expect(weeksFromWorkingDays(saved).some((entry) => entry.weekCommencingDate === '2027-01-25')).toBe(false);
  });

  test('editing hours does not keep a week the owner did not add', () => {
    const original = { weeks: originalWeeks };
    const editedMonday = {
      ...originalWeeks[0],
      monday: {
        unavailable: false,
        am: { start: '09:00', end: '12:00' },
        pm: { start: '13:00', end: '17:00' },
      },
    };
    const edited = { weeks: [editedMonday, ...originalWeeks.slice(1), invented] };

    const saved = workingDaysForStaffSave({
      isUpdate: true,
      rotaDirty: true,
      original,
      edited,
    }) as { weeks: Array<{ weekCommencingDate: string; monday: { am: { end: string } } }> };

    expect(saved.weeks).toHaveLength(12);
    expect(saved.weeks.some((entry) => entry.weekCommencingDate === '2027-01-25')).toBe(false);
    expect(saved.weeks[0].monday.am.end).toBe('12:00');
    expect(saved.weeks.every((entry) => entry.weekCommencingDate !== '2027-01-25')).toBe(true);
  });

  test('an explicitly added week is kept and a new staff rota can be saved', () => {
    const original = { weeks: originalWeeks };
    const edited = { weeks: [...originalWeeks, invented] };
    const saved = workingDaysForStaffSave({
      isUpdate: true,
      rotaDirty: true,
      original,
      edited,
      explicitlyAddedDates: ['2027-01-25'],
    }) as { weeks: Array<{ weekCommencingDate?: string }> };

    expect(saved.weeks).toHaveLength(13);
    expect(saved.weeks[12].weekCommencingDate).toBe('2027-01-25');

    const created = workingDaysForStaffSave({
      isUpdate: false,
      rotaDirty: false,
      original: null,
      edited,
    });
    expect(created).toBe(edited);
  });

  test('a rota with no weeks, or only the old per-day map, opens on the current week', () => {
    const empty = (date: string) => ({
      weekCommencingDate: date,
      monday: { unavailable: false, am: { start: '09:00', end: '13:00' } },
      saturday: { unavailable: true },
    });
    const blank = rotaWeeksForEditor(null, '2026-11-09', empty);
    expect(blank.weeks).toHaveLength(1);
    expect(blank.weeks[0].weekCommencingDate).toBe('2026-11-09');
    expect(blank.activeIndex).toBe(0);
    expect(blank.seededDate).toBe('2026-11-09');

    const flat = rotaWeeksForEditor({
      monday: { unavailable: false, am: { start: '10:00', end: '14:00' }, pm: null },
      sunday: { unavailable: true, am: null, pm: null },
    }, '2026-11-09', empty);
    expect(flat.weeks).toHaveLength(1);
    expect(flat.activeIndex).toBe(0);
    expect((flat.weeks[0].monday as { am: { start: string } }).am.start).toBe('10:00');

    const pastAndFuture = rotaWeeksForEditor({
      weeks: [week('2026-11-02'), week('2026-11-16')],
    }, '2026-11-09', empty);
    expect(pastAndFuture.weeks.map((entry) => entry.weekCommencingDate)).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
    ]);
    expect(pastAndFuture.activeIndex).toBe(1);
    expect(pastAndFuture.seededDate).toBe('2026-11-09');

    const alreadyCurrent = rotaWeeksForEditor({
      weeks: [week('2026-11-02'), week('2026-11-09')],
    }, '2026-11-09', empty);
    expect(alreadyCurrent.activeIndex).toBe(1);
    expect(alreadyCurrent.seededDate).toBeNull();
  });
});
