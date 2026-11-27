/**
 * STYL-421: Unpaid email sign-ups must complete Foundation checkout before using the dashboard.
 */

export const PENDING_FOUNDATION_CHECKOUT_STATUSES = new Set([
  'incomplete',
  'pending_checkout',
  'unpaid',
])

/** Foundation free-trial length in days; bolt-ons are not sold at signup when this is greater than zero. */
export function foundationSignupTrialDays(): number {
  const raw = (process.env.NEXT_PUBLIC_FOUNDATION_TRIAL_DAYS ?? '14').trim()
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return 14
  return parsed
}

export function signupAllowsBoltOnsAtCheckout(): boolean {
  return foundationSignupTrialDays() === 0
}

export type SignupCheckoutGateInput = {
  role?: string | null
  is_super_admin?: boolean | null
  is_active?: boolean | null
  subscription_status?: string | null
}

export function normalizeSubscriptionStatus(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

/** Owners/admins without a paid Foundation subscription must finish checkout (or trial setup). */
export function tenantRequiresFoundationCheckout(input: SignupCheckoutGateInput): boolean {
  if (input.is_super_admin === true) return false
  const role = (input.role || '').trim().toLowerCase()
  if (role === 'member') return false

  const status = normalizeSubscriptionStatus(input.subscription_status)
  if (status === 'comped' || status === 'paused') return false
  if (status === 'active' || status === 'trialing' || status === 'past_due') {
    return false
  }
  if (PENDING_FOUNDATION_CHECKOUT_STATUSES.has(status)) return true
  if (input.is_active === false) return true
  return false
}

export function buildSignupCheckoutPath(options?: {
  plan?: string | null
  addons?: string | string[] | null
  returnUrl?: string | null
}): string {
  const plan = (options?.plan || 'foundation').trim() || 'foundation'
  const params = new URLSearchParams({ plan })
  const addons = options?.addons
  if (Array.isArray(addons) && addons.length > 0) {
    params.set('addons', addons.join(','))
  } else if (typeof addons === 'string' && addons.trim()) {
    params.set('addons', addons.trim())
  }
  const returnUrl = options?.returnUrl
  if (typeof returnUrl === 'string' && returnUrl.trim()) {
    params.set('return_url', returnUrl.trim())
  }
  return `/api/billing/checkout?${params.toString()}`
}

export function resolvePostSignupCheckoutNext(metadata: Record<string, unknown> | null | undefined): string {
  const plan =
    (typeof metadata?.selected_plan === 'string' && metadata.selected_plan.trim()) || 'foundation'
  const promo = typeof metadata?.promo_applied === 'string' ? metadata.promo_applied : ''
  const addonsRaw = metadata?.selected_addons
  let addons: string | undefined
  if (
    signupAllowsBoltOnsAtCheckout() &&
    typeof addonsRaw === 'string' &&
    addonsRaw.trim()
  ) {
    addons = addonsRaw.trim()
  }
  void promo
  return buildSignupCheckoutPath({ plan, addons, returnUrl: '/payment-confirmed' })
}