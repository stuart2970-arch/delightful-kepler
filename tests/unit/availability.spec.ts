import { test, expect } from '@playwright/test';
import {
  localTimeToUtc,
  utcToLocalParts,
  formatSlotIsoWithOffset,
  resolveDayShifts,
  calculateAvailableSlots,
  getAvailableDays,
  getSlotsForDay,
  formatQuickDaysTag,
  formatQuickTimesTag,
  formatQuickServicesTag,
  StaffSchedule,
  QualifiedStaff,
  ServiceConfig,
} from '@/lib/calendar/availability';
import { BusyInterval } from '@/lib/calendar/provider';

test.describe('STYL-182 Unit Tests: Availability Engine & Timezones', () => {

  test('BST/GMT: 09:00 Europe/London produces 09:00 local first slots in BST (Oct 23) and GMT (Nov 3)', () => {
    // 23 Oct 2026 is BST (UTC+1)
    const bstUtc = localTimeToUtc('2026-10-23', '09:00', 'Europe/London');
    expect(bstUtc.toISOString()).toBe('2026-10-23T08:00:00.000Z');

    const bstParts = utcToLocalParts(bstUtc, 'Europe/London');
    expect(bstParts.timeStr).toBe('09:00');
    expect(bstParts.dateStr).toBe('2026-10-23');

    const bstIso = formatSlotIsoWithOffset(bstUtc, 'Europe/London');
    expect(bstIso).toBe('2026-10-23T09:00:00+01:00');

    // 03 Nov 2026 is GMT (UTC+0)
    const gmtUtc = localTimeToUtc('2026-11-03', '09:00', 'Europe/London');
    expect(gmtUtc.toISOString()).toBe('2026-11-03T09:00:00.000Z');

    const gmtParts = utcToLocalParts(gmtUtc, 'Europe/London');
    expect(gmtParts.timeStr).toBe('09:00');
    expect(gmtParts.dateStr).toBe('2026-11-03');

    const gmtIso = formatSlotIsoWithOffset(gmtUtc, 'Europe/London');
    expect(gmtIso).toBe('2026-11-03T09:00:00+00:00');
  });

  test('Weekly default hours used when there is no per-week row or week rows run out', () => {
    const scheduleWithoutWeeks: StaffSchedule = {
      weeks: [],
      monday: {
        unavailable: false,
        am: { start: '10:00', end: '13:00' },
        pm: { start: '14:00', end: '18:00' },
      },
    };

    // 2026-10-26 is a Monday
    const shifts = resolveDayShifts(scheduleWithoutWeeks, '2026-10-26', 'monday');
    expect(shifts).toEqual([
      { start: '10:00', end: '13:00' },
      { start: '14:00', end: '18:00' },
    ]);

    // Sunday without configuration falls back to unavailable (empty shifts)
    const sundayShifts = resolveDayShifts(scheduleWithoutWeeks, '2026-10-25', 'sunday');
    expect(sundayShifts).toEqual([]);
  });

  test('Week row overrides weekly default hours when active week is present', () => {
    const scheduleWithWeekOverride: StaffSchedule = {
      defaultWeeklyHours: {
        monday: { am: { start: '09:00', end: '12:00' }, pm: null },
      },
      weeks: [
        {
          weekCommencingDate: '2026-10-19',
          monday: { am: { start: '11:00', end: '16:00' }, pm: null, unavailable: false },
        },
      ],
    };

    // 2026-10-19 is Monday of the override week
    const overrideShifts = resolveDayShifts(scheduleWithWeekOverride, '2026-10-19', 'monday');
    expect(overrideShifts).toEqual([{ start: '11:00', end: '16:00' }]);

    // 2026-10-26 is Monday outside the override week, should fall back to default
    const fallbackShifts = resolveDayShifts(scheduleWithWeekOverride, '2026-10-26', 'monday');
    expect(fallbackShifts).toEqual([{ start: '09:00', end: '12:00' }]);
  });

  test('Slot calculation: respects service duration + buffer, busy overlap, past-time cutoff, and max advance cap', () => {
    const staff: QualifiedStaff = {
      id: 'staff-1',
      name: 'Stuart',
      schedule: {
        monday: {
          am: { start: '09:00', end: '12:00' }, // 3 hours
          pm: null,
          unavailable: false,
        },
      },
    };

    const service: ServiceConfig = {
      id: 'svc-1',
      name: 'Consultation',
      durationMinutes: 45,
      bufferMinutes: 15, // Total block = 60 mins
    };

    // Let's pretend today is 2026-10-26 at 09:15 local time (08:15 UTC in BST)
    const nowUtc = localTimeToUtc('2026-10-26', '09:15', 'Europe/London');

    // Add a busy interval from 10:00 to 11:00 local time (09:00 to 10:00 UTC)
    const busyStart = localTimeToUtc('2026-10-26', '10:00', 'Europe/London');
    const busyEnd = localTimeToUtc('2026-10-26', '11:00', 'Europe/London');
    const busyMap = new Map<string, BusyInterval[]>([
      ['staff-1', [{ start: busyStart, end: busyEnd }]],
    ]);

    const startUtc = localTimeToUtc('2026-10-26', '00:00', 'Europe/London');
    const endUtc = localTimeToUtc('2026-10-26', '23:59', 'Europe/London');

    const slots = calculateAvailableSlots({
      staffList: [staff],
      busyMap,
      service,
      startDateUtc: startUtc,
      endDateUtc: endUtc,
      maxAdvanceWeeks: 4,
      nowUtc,
      timeZone: 'Europe/London',
    });

    // 09:00-10:00 slot starts before 09:15 nowUtc, so it's cut off.
    // 10:00-11:00 slot overlaps with busy interval, so it's excluded.
    // 11:00-12:00 slot is free and in the future.
    const times = slots.map((s) => s.time);
    expect(times).not.toContain('09:00');
    expect(times).not.toContain('10:00');
    expect(times).toContain('11:00');
  });

  test('Max advance weeks limits future slots properly', () => {
    const staff: QualifiedStaff = {
      id: 'staff-1',
      name: 'Sarah',
    };
    const service: ServiceConfig = {
      id: 'svc-1',
      name: 'Haircut',
      durationMinutes: 30,
    };

    const nowUtc = localTimeToUtc('2026-10-20', '08:00', 'Europe/London');
    const startUtc = localTimeToUtc('2026-10-21', '00:00', 'Europe/London');
    // Requesting 6 weeks out
    const farFutureUtc = localTimeToUtc('2026-12-01', '00:00', 'Europe/London');

    const slots = calculateAvailableSlots({
      staffList: [staff],
      busyMap: new Map(),
      service,
      startDateUtc: startUtc,
      endDateUtc: farFutureUtc,
      maxAdvanceWeeks: 2, // Only allow 2 weeks in advance
      nowUtc,
      timeZone: 'Europe/London',
    });

    const maxAllowedDate = new Date(nowUtc.getTime() + 2 * 7 * 24 * 60 * 60 * 1000);
    for (const slot of slots) {
      expect(slot.startUtc.getTime()).toBeLessThanOrEqual(maxAllowedDate.getTime());
    }
  });

  test('Day grouping and quick-links markers formatting', () => {
    const mockSlots = [
      {
        start: '2026-10-23T09:30:00+01:00',
        end: '2026-10-23T10:00:00+01:00',
        startUtc: new Date(),
        endUtc: new Date(),
        date: '2026-10-23',
        time: '09:30',
        displayDate: 'Thu 23 Oct',
        staffId: 'staff-1',
        staffName: 'Stuart',
        serviceId: 'svc-1',
      },
      {
        start: '2026-10-23T11:00:00+01:00',
        end: '2026-10-23T11:30:00+01:00',
        startUtc: new Date(),
        endUtc: new Date(),
        date: '2026-10-23',
        time: '11:00',
        displayDate: 'Thu 23 Oct',
        staffId: 'staff-1',
        staffName: 'Stuart',
        serviceId: 'svc-1',
      },
      {
        start: '2026-10-24T10:00:00+01:00',
        end: '2026-10-24T10:30:00+01:00',
        startUtc: new Date(),
        endUtc: new Date(),
        date: '2026-10-24',
        time: '10:00',
        displayDate: 'Fri 24 Oct',
        staffId: 'staff-1',
        staffName: 'Stuart',
        serviceId: 'svc-1',
      },
    ];

    const days = getAvailableDays(mockSlots);
    expect(days).toEqual([
      { date: '2026-10-23', displayDate: 'Thu 23 Oct', slotsCount: 2 },
      { date: '2026-10-24', displayDate: 'Fri 24 Oct', slotsCount: 1 },
    ]);

    const daySlots = getSlotsForDay(mockSlots, '2026-10-23');
    expect(daySlots.length).toBe(2);

    const quickDays = formatQuickDaysTag('svc-1', 'ANY', days);
    expect(quickDays).toContain('[QUICK_DAYS:');
    expect(quickDays).toContain('"serviceId":"svc-1"');
    expect(quickDays).toContain('2026-10-23');

    const quickTimes = formatQuickTimesTag('2026-10-23', 'svc-1', daySlots);
    expect(quickTimes).toContain('[QUICK_TIMES:');
    expect(quickTimes).toContain('"date":"2026-10-23"');
    expect(quickTimes).toContain('"time":"09:30"');

    const quickServices = formatQuickServicesTag([
      { id: 'svc-1', name: 'Demo Call', duration_minutes: 30, price: 0 },
    ]);
    expect(quickServices).toContain('[QUICK_SERVICES:');
    expect(quickServices).toContain('Demo Call');
  });

});
