import {
  FAILED_PAYMENT_CANCEL_AFTER_DAYS,
  FAILED_PAYMENT_DAY_MS,
} from '@/lib/billing/failed-payment/evaluate';

/** Salon data and the StyleFlo number are held for 31 days after closure. */
export const ACCOUNT_CLOSURE_RETENTION_DAYS = 31;

/** One reminder, this many days before deletion day. */
export const ACCOUNT_CLOSURE_REMINDER_LEAD_DAYS = 7;

/** Day 24 after closure. 31 minus the 7-day lead. */
export const ACCOUNT_CLOSURE_REMINDER_AFTER_CLOSE_DAYS =
  ACCOUNT_CLOSURE_RETENTION_DAYS - ACCOUNT_CLOSURE_REMINDER_LEAD_DAYS;

export type ClosureReason = 'trial_ended' | 'plan_cancelled' | 'failed_payment';

export type ClosureClock = {
  closedAt: string;
  reminderSentAt: string | null;
  deletedAt: string | null;
  reopenedAt: string | null;
};

export type ClosureMilestones = {
  reminderAt: Date;
  deletionAt: Date;
};

export function addClosureDays(start: Date, days: number): Date {
  return new Date(start.getTime() + days * FAILED_PAYMENT_DAY_MS);
}

export function closureMilestones(closedAt: Date): ClosureMilestones {
  return {
    reminderAt: addClosureDays(closedAt, ACCOUNT_CLOSURE_REMINDER_AFTER_CLOSE_DAYS),
    deletionAt: addClosureDays(closedAt, ACCOUNT_CLOSURE_RETENTION_DAYS),
  };
}

/**
 * Failed-payment cancellation is day 37 from the first failure.
 * Deletion and number release are 31 days after that cancellation, day 68.
 * The combined reminder is 7 days earlier, day 61.
 */
export function failedPaymentClosureDays(): {
  cancelDay: number;
  reminderDay: number;
  deletionDay: number;
} {
  return {
    cancelDay: FAILED_PAYMENT_CANCEL_AFTER_DAYS,
    reminderDay: FAILED_PAYMENT_CANCEL_AFTER_DAYS + ACCOUNT_CLOSURE_REMINDER_AFTER_CLOSE_DAYS,
    deletionDay: FAILED_PAYMENT_CANCEL_AFTER_DAYS + ACCOUNT_CLOSURE_RETENTION_DAYS,
  };
}

export function isReopenAllowed(closedAt: Date, now: Date): boolean {
  if (!Number.isFinite(closedAt.getTime()) || !Number.isFinite(now.getTime())) return false;
  return now.getTime() < closureMilestones(closedAt).deletionAt.getTime();
}

export function isReminderDue(clock: ClosureClock, now: Date): boolean {
  if (clock.reopenedAt || clock.deletedAt || clock.reminderSentAt) return false;
  const closedAt = new Date(clock.closedAt);
  if (!Number.isFinite(closedAt.getTime())) return false;
  return now.getTime() >= closureMilestones(closedAt).reminderAt.getTime();
}

export function isDeletionDue(clock: ClosureClock, now: Date): boolean {
  if (clock.reopenedAt || clock.deletedAt) return false;
  const closedAt = new Date(clock.closedAt);
  if (!Number.isFinite(closedAt.getTime())) return false;
  return now.getTime() >= closureMilestones(closedAt).deletionAt.getTime();
}

export function formatClosureDate(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(value);
}
