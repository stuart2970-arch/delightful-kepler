/**
 * Map Stripe Foundation checkout.session.completed subscription state to tenant columns.
 * Webhook payloads usually send session.subscription as a string id — retrieve when needed.
 */

export type FoundationCheckoutTenantStatus = {
  subscription_status: 'incomplete' | 'trialing' | 'active' | 'past_due' | 'cancelled'
  trial_ends_at: string | null
  activateTenant: boolean
  stripeStatus: string
}

export type StripeSubscriptionRetrieve = (
  id: string,
) => Promise<{ status?: string | null; trial_end?: number | null }>

function trialEndsAtIso(trialEndUnix: number | null | undefined): string | null {
  if (typeof trialEndUnix !== 'number' || trialEndUnix <= 0) return null
  return new Date(trialEndUnix * 1000).toISOString()
}

export function mapStripeFoundationSubscriptionToTenant(
  stripeStatusInput: string | null | undefined,
  trialEndUnix?: number | null,
): FoundationCheckoutTenantStatus {
  const stripeStatus = String(stripeStatusInput || '').trim().toLowerCase()
  const trial_ends_at = trialEndsAtIso(trialEndUnix ?? null)

  if (stripeStatus === 'trialing') {
    return {
      stripeStatus,
      subscription_status: 'trialing',
      trial_ends_at,
      activateTenant: true,
    }
  }
  if (stripeStatus === 'active') {
    return {
      stripeStatus,
      subscription_status: 'active',
      trial_ends_at,
      activateTenant: true,
    }
  }
  if (stripeStatus === 'past_due') {
    return {
      stripeStatus,
      subscription_status: 'past_due',
      trial_ends_at,
      activateTenant: false,
    }
  }
  if (stripeStatus === 'incomplete' || stripeStatus === 'incomplete_expired') {
    return {
      stripeStatus,
      subscription_status: 'incomplete',
      trial_ends_at,
      activateTenant: false,
    }
  }
  if (
    stripeStatus === 'canceled' ||
    stripeStatus === 'cancelled' ||
    stripeStatus === 'unpaid'
  ) {
    return {
      stripeStatus,
      subscription_status: 'cancelled',
      trial_ends_at,
      activateTenant: false,
    }
  }

  return {
    stripeStatus,
    subscription_status: 'incomplete',
    trial_ends_at,
    activateTenant: false,
  }
}

function readExpandedSubscription(session: Record<string, unknown> | null | undefined): {
  status: string
  trial_end: number | null
} {
  const subscription = session?.subscription
  if (!subscription || typeof subscription !== 'object') {
    return { status: '', trial_end: null }
  }
  const sub = subscription as Record<string, unknown>
  const status = String(sub.status || '').trim()
  const trial_end = typeof sub.trial_end === 'number' ? sub.trial_end : null
  return { status, trial_end }
}

export function subscriptionIdFromCheckoutSession(
  session: Record<string, unknown> | null | undefined,
): string | null {
  const subscription = session?.subscription
  if (typeof subscription === 'string' && subscription.trim()) return subscription.trim()
  if (subscription && typeof subscription === 'object') {
    const id = (subscription as Record<string, unknown>).id
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return null
}

/** Sync helper when session.subscription is already expanded (unit tests and rare webhook expansions). */
export function foundationTenantStatusFromCheckoutSession(
  session: Record<string, unknown> | null | undefined,
): Pick<FoundationCheckoutTenantStatus, 'subscription_status' | 'trial_ends_at' | 'activateTenant'> {
  const expanded = readExpandedSubscription(session)
  const mapped = mapStripeFoundationSubscriptionToTenant(expanded.status, expanded.trial_end)
  return {
    subscription_status: mapped.subscription_status,
    trial_ends_at: mapped.trial_ends_at,
    activateTenant: mapped.activateTenant,
  }
}

export async function resolveFoundationCheckoutTenantStatus(
  session: Record<string, unknown> | null | undefined,
  retrieve?: StripeSubscriptionRetrieve,
): Promise<FoundationCheckoutTenantStatus> {
  const expanded = readExpandedSubscription(session)
  if (expanded.status) {
    return mapStripeFoundationSubscriptionToTenant(expanded.status, expanded.trial_end)
  }

  const subscriptionId = subscriptionIdFromCheckoutSession(session)
  if (subscriptionId && retrieve) {
    const sub = await retrieve(subscriptionId)
    return mapStripeFoundationSubscriptionToTenant(sub.status, sub.trial_end)
  }

  if (subscriptionId && !retrieve) {
    console.warn(
      '[Stripe Webhook] checkout.session.completed included subscription id without Stripe client; leaving tenant inactive',
    )
  }

  return mapStripeFoundationSubscriptionToTenant('', null)
}