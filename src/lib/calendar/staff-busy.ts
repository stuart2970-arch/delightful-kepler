import type { BusyInterval, StaffCalendarTarget } from './provider';

/** Per-staff limit. A calendar that has not answered by then is a failure, not free time. */
export const STAFF_CALENDAR_TIMEOUT_MS = 8000;

export type BusyLookup = (
  tenantId: string,
  staff: StaffCalendarTarget,
  startUtc: Date,
  endUtc: Date
) => Promise<BusyInterval[]>;

export type StaffCalendarFailureReason = 'timeout' | 'not_connected' | 'error';

export type StaffCalendarSuccess = {
  staff: StaffCalendarTarget;
  busy: BusyInterval[];
};

export type StaffCalendarFailure = {
  staff: StaffCalendarTarget;
  reason: StaffCalendarFailureReason;
  message: string;
};

export type StaffCalendarQueryResult = {
  succeeded: StaffCalendarSuccess[];
  failed: StaffCalendarFailure[];
};

export type QueryStaffCalendarsParams = {
  tenantId: string;
  staff: StaffCalendarTarget[];
  startUtc: Date;
  endUtc: Date;
  timeoutMs?: number;
  lookup: BusyLookup;
  log?: (message: string) => void;
};

function classifyFailure(message: string): StaffCalendarFailureReason {
  if (/timed out/i.test(message)) return 'timeout';
  if (/no calendar provider connected/i.test(message)) return 'not_connected';
  return 'error';
}

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Asks every staff calendar at the same time.
 * A timeout, a missing connection, or any other error excludes that person.
 * Their rota is not used, and an empty busy list is never invented for them.
 */
export async function queryStaffCalendars(
  params: QueryStaffCalendarsParams
): Promise<StaffCalendarQueryResult> {
  const timeoutMs = params.timeoutMs ?? STAFF_CALENDAR_TIMEOUT_MS;
  const log = params.log ?? ((message: string) => console.error(message));

  const results = await Promise.all(params.staff.map(async (staff) => {
    const label = staff.name || staff.id;
    try {
      const busy = await withTimeout(
        params.lookup(params.tenantId, staff, params.startUtc, params.endUtc),
        timeoutMs,
        `Calendar check timed out after ${timeoutMs}ms`
      );
      return { ok: true as const, staff, busy };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const reason = classifyFailure(message);
      log(`[Calendar] Staff ${label} (${staff.id}) calendar check failed (${reason}): ${message}`);
      return { ok: false as const, staff, reason, message };
    }
  }));

  return {
    succeeded: results.filter((result) => result.ok).map((result) => ({
      staff: result.staff,
      busy: result.busy,
    })),
    failed: results.filter((result) => !result.ok).map((result) => ({
      staff: result.staff,
      reason: result.reason,
      message: result.message,
    })),
  };
}
