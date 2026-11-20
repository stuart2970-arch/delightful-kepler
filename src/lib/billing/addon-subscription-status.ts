/**
 * Maps Stripe subscription state onto tenant_active_addons.subscription_status.
 * Paid phone buys require active or trialing (see tenantHasPaidPhoneAddon).
 */

export function stripeStatusToAddonStatus(status?: string | null): string {
  const raw = (status || '').trim().toLowerCase();
  if (raw === 'canceled') return 'cancelled';
  if (raw === 'unpaid') return 'past_due';
  if (raw === 'incomplete_expired') return 'cancelled';
  if (
    raw === 'active' ||
    raw === 'trialing' ||
    raw === 'past_due' ||
    raw === 'cancelled' ||
    raw === 'incomplete' ||
    raw === 'paused'
  ) {
    return raw;
  }
  return '';
}

export function addonActivateStatusFields(stripeStatus?: string | null): {
  is_active: true;
  subscription_status: string;
} {
  const mapped = stripeStatusToAddonStatus(stripeStatus);
  return {
    is_active: true,
    subscription_status: mapped || 'active',
  };
}

export function addonDeactivateStatusFields(): {
  is_active: false;
  subscription_status: 'cancelled';
} {
  return {
    is_active: false,
    subscription_status: 'cancelled',
  };
}

export function addonPastDueStatusFields(): {
  subscription_status: 'past_due';
} {
  return { subscription_status: 'past_due' };
}

export type PendingCancelPair = {
  cancel_at_period_end: boolean;
  cancel_at: string | null;
};

function stripeInstantToIso(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return new Date(Number(trimmed) * 1000).toISOString();
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

/**
 * Stripe cancel_at is Unix seconds. A pending cancel with a null cancel_at
 * falls back to current_period_end so Billing still has a date.
 * A subscription that is not pending stores false and null.
 */
export function pendingCancelPairFromStripe(
  object: Record<string, any> | null | undefined,
): PendingCancelPair {
  if (object?.cancel_at_period_end !== true) {
    return { cancel_at_period_end: false, cancel_at: null };
  }
  return {
    cancel_at_period_end: true,
    cancel_at: stripeInstantToIso(object.cancel_at) ?? stripeInstantToIso(object.current_period_end),
  };
}
