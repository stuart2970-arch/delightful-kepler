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
 * current_period_end moved under subscription items on newer Stripe API versions.
 */
export function stripeSubscriptionPeriodEndUnix(
  object: Record<string, any> | null | undefined,
): unknown {
  if (!object) return null;
  if (object.current_period_end != null && object.current_period_end !== '') {
    return object.current_period_end;
  }
  const items = object.items?.data;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (item?.current_period_end != null && item.current_period_end !== '') {
      return item.current_period_end;
    }
  }
  return null;
}

/**
 * Stripe cancel_at is Unix seconds. A pending cancel with a null cancel_at
 * falls back to current_period_end (root or line item) so Billing still has a date.
 * Dashboard set-date cancel (cancel_at set, cancel_at_period_end false) still counts as pending.
 * A subscription that is not pending stores false and null.
 */
export function pendingCancelPairFromStripe(
  object: Record<string, any> | null | undefined,
): PendingCancelPair {
  const periodEndCancel = object?.cancel_at_period_end === true;
  const cancelAt = stripeInstantToIso(object?.cancel_at);
  if (!periodEndCancel && !cancelAt) {
    return { cancel_at_period_end: false, cancel_at: null };
  }
  return {
    cancel_at_period_end: true,
    cancel_at: cancelAt ?? stripeInstantToIso(stripeSubscriptionPeriodEndUnix(object)),
  };
}
