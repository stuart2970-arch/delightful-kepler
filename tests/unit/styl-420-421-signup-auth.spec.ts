import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
import {
  buildEmailSignupRedirectUrl,
  isEmailConfirmOtpType,
  resolveAuthCallbackNext,
  shouldPreferTokenHashOverPkceCode,
} from '@/lib/auth/email-confirmation-redirect'
import {
  buildSignupCheckoutPath,
  foundationSignupTrialDays,
  resolvePostSignupCheckoutNext,
  signupAllowsBoltOnsAtCheckout,
  tenantRequiresFoundationCheckout,
} from '@/lib/billing/signup-checkout-gate'
import {
  foundationTenantStatusFromCheckoutSession,
  mapStripeFoundationSubscriptionToTenant,
  resolveFoundationCheckoutTenantStatus,
} from '@/lib/billing/foundation-checkout-session'

test.describe('STYL-421 signup checkout gate', () => {
  test('new owner with incomplete status must finish checkout', () => {
    expect(
      tenantRequiresFoundationCheckout({
        role: 'owner',
        is_active: false,
        subscription_status: 'incomplete',
      }),
    ).toBe(true)
  })

  test('active trialing tenant may use the dashboard', () => {
    expect(
      tenantRequiresFoundationCheckout({
        role: 'owner',
        is_active: true,
        subscription_status: 'trialing',
      }),
    ).toBe(false)
  })

  test('members never see the owner checkout gate', () => {
    expect(
      tenantRequiresFoundationCheckout({
        role: 'member',
        is_active: false,
        subscription_status: 'incomplete',
      }),
    ).toBe(false)
  })

  test('superadmins bypass the gate', () => {
    expect(
      tenantRequiresFoundationCheckout({
        role: 'owner',
        is_super_admin: true,
        is_active: false,
        subscription_status: 'incomplete',
      }),
    ).toBe(false)
  })

  test('handle_new_user creates an inactive incomplete tenant for email sign-up', async () => {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const email = `styl421-${Date.now()}@test.styleflo.ai`
    const { data: userRes, error: userErr } = await admin.auth.admin.createUser({
      email,
      password: 'Password123!',
      email_confirm: true,
      user_metadata: { company_name: 'Gate Test Salon', full_name: 'Gate Tester', slug: 'gate-test-salon' },
    })
    expect(userErr).toBeFalsy()
    const userId = userRes.user?.id
    expect(userId).toBeTruthy()

    const { data: profile } = await admin.from('profiles').select('tenant_id').eq('id', userId!).maybeSingle()
    expect(profile?.tenant_id).toBeTruthy()

    const { data: tenant } = await admin
      .from('tenants')
      .select('is_active, subscription_status')
      .eq('id', profile!.tenant_id)
      .maybeSingle()

    expect(tenant?.is_active).toBe(false)
    expect(tenant?.subscription_status).toBe('incomplete')

    await admin.auth.admin.deleteUser(userId!)
  })

  test('post-signup checkout path includes plan and return URL', () => {
    const path = resolvePostSignupCheckoutNext({ selected_plan: 'foundation' })
    expect(path).toContain('plan=foundation')
    expect(path).toContain('return_url')
    expect(buildSignupCheckoutPath({ plan: 'foundation', addons: ['google_calendar_addon'] })).toContain(
      'addons=google_calendar_addon',
    )
  })

  test('preserves selected_addons in checkout next only when foundation trial is zero days', () => {
    const prev = process.env.NEXT_PUBLIC_FOUNDATION_TRIAL_DAYS
    try {
      process.env.NEXT_PUBLIC_FOUNDATION_TRIAL_DAYS = '0'
      expect(signupAllowsBoltOnsAtCheckout()).toBe(true)
      const withAddons = resolvePostSignupCheckoutNext({
        selected_plan: 'foundation',
        selected_addons: 'google_calendar_addon,mobile_addon',
      })
      expect(withAddons).toContain('addons=google_calendar_addon%2Cmobile_addon')

      process.env.NEXT_PUBLIC_FOUNDATION_TRIAL_DAYS = '14'
      expect(foundationSignupTrialDays()).toBe(14)
      const trialPath = resolvePostSignupCheckoutNext({
        selected_plan: 'foundation',
        selected_addons: 'google_calendar_addon',
      })
      expect(trialPath).not.toContain('addons=')
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_FOUNDATION_TRIAL_DAYS
      else process.env.NEXT_PUBLIC_FOUNDATION_TRIAL_DAYS = prev
    }
  })
})

test.describe('STYL-420 cross-device email confirmation', () => {
  test('signup and email are valid verifyOtp types', () => {
    expect(isEmailConfirmOtpType('signup')).toBe(true)
    expect(isEmailConfirmOtpType('email')).toBe(true)
    expect(isEmailConfirmOtpType('pkce')).toBe(false)
  })

  test('token_hash links win over PKCE code query params', () => {
    const params = new URLSearchParams('token_hash=abc&code=def&type=signup')
    expect(shouldPreferTokenHashOverPkceCode(params)).toBe(true)
  })

  test('signup confirmation without explicit next routes to Foundation checkout', () => {
    const next = resolveAuthCallbackNext({
      requestedNext: null,
      type: 'signup',
      userMetadata: { selected_plan: 'foundation' },
    })
    expect(next.startsWith('/api/billing/checkout')).toBe(true)
  })

  test('email redirect points at auth callback with encoded checkout next', () => {
    const checkoutNext = buildSignupCheckoutPath({ returnUrl: '/payment-confirmed' })
    const url = buildEmailSignupRedirectUrl(checkoutNext)
    expect(url).toContain('/auth/callback')
    expect(url).toContain(encodeURIComponent(checkoutNext))
  })
})

test.describe('STYL-421 webhook tenant status from checkout session', () => {
  test('maps trialing subscriptions without marking active paid', () => {
    const result = foundationTenantStatusFromCheckoutSession({
      subscription: { status: 'trialing', trial_end: 1_700_000_000 },
    })
    expect(result.subscription_status).toBe('trialing')
    expect(result.trial_ends_at).toBeTruthy()
    expect(result.activateTenant).toBe(true)
  })

  test('maps active subscriptions after immediate charge', () => {
    const result = foundationTenantStatusFromCheckoutSession({
      subscription: { status: 'active', trial_end: null },
    })
    expect(result.subscription_status).toBe('active')
    expect(result.activateTenant).toBe(true)
  })

  test('does not coerce incomplete or canceled Stripe statuses to active', () => {
    for (const status of ['incomplete', 'incomplete_expired', 'canceled', 'unpaid', '']) {
      const mapped = mapStripeFoundationSubscriptionToTenant(status)
      expect(mapped.subscription_status).not.toBe('active')
      expect(mapped.activateTenant).toBe(false)
    }
  })

  test('retrieves subscription by string id when webhook payload is not expanded', async () => {
    const resolved = await resolveFoundationCheckoutTenantStatus(
      { subscription: 'sub_test_compact' },
      async (id) => {
        expect(id).toBe('sub_test_compact')
        return { status: 'trialing', trial_end: 1_800_000_000 }
      },
    )
    expect(resolved.subscription_status).toBe('trialing')
    expect(resolved.activateTenant).toBe(true)
    expect(resolved.trial_ends_at).toBeTruthy()
  })

  test('string subscription id without retrieve stays incomplete and inactive', async () => {
    const resolved = await resolveFoundationCheckoutTenantStatus({ subscription: 'sub_missing_client' })
    expect(resolved.subscription_status).toBe('incomplete')
    expect(resolved.activateTenant).toBe(false)
  })

  test('retrieve failures propagate so the webhook can return 500 for Stripe retry', async () => {
    await expect(
      resolveFoundationCheckoutTenantStatus({ subscription: 'sub_transient' }, async () => {
        throw new Error('stripe rate limit')
      }),
    ).rejects.toThrow('stripe rate limit')
  })
})