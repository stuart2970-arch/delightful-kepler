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
