/** Day 0 is the first failed payment. Days are elapsed 24-hour periods. */
export const FAILED_PAYMENT_PAUSE_AFTER_DAYS = 7;
export const FAILED_PAYMENT_CANCEL_AFTER_DAYS = 37;
export const FAILED_PAYMENT_DAY_MS = 24 * 60 * 60 * 1000;

export type FailedPaymentStatus = 'past_due' | 'paused' | 'restarted' | 'recovered' | 'cancelled';

export type FailedPaymentSnapshot = {
  status: FailedPaymentStatus;
  firstFailedAt: string;
  pausedAt: string | null;
  restartedAt: string | null;
  cancelledAt: string | null;
  writtenOffInvoiceId: string | null;
};

export type DueFailedPaymentTransition = 'pause' | 'cancel' | 'write_off';

export function elapsedFailedPaymentDays(firstFailedAt: Date, now: Date): number {
  const start = firstFailedAt.getTime();
  const end = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const elapsed = end - start;
  if (elapsed < 0) return 0;
  return Math.floor(elapsed / FAILED_PAYMENT_DAY_MS);
}

/**
 * Days 0–6 record only. Day 7 pauses. Day 37 cancels and writes the invoice off.
 * A paid or restarted case has no further transitions.
 */
export function dueFailedPaymentTransitions(
  snapshot: FailedPaymentSnapshot,
  now: Date,
): DueFailedPaymentTransition[] {
  if (snapshot.status === 'restarted' || snapshot.status === 'recovered' || snapshot.restartedAt) {
    return [];
  }

  const ageDays = elapsedFailedPaymentDays(new Date(snapshot.firstFailedAt), now);
  const cancelled = snapshot.status === 'cancelled' || Boolean(snapshot.cancelledAt);
  const due: DueFailedPaymentTransition[] = [];

  if (!cancelled && !snapshot.pausedAt && ageDays >= FAILED_PAYMENT_PAUSE_AFTER_DAYS) {
    due.push('pause');
  }
  if (!cancelled && ageDays >= FAILED_PAYMENT_CANCEL_AFTER_DAYS) {
    due.push('cancel');
  }
  if (!snapshot.writtenOffInvoiceId && (cancelled || ageDays >= FAILED_PAYMENT_CANCEL_AFTER_DAYS)) {
    due.push('write_off');
  }
  return due;
}
