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
  resolvePostSignupCheckoutNext,
  tenantRequiresFoundationCheckout,
} from '@/lib/billing/signup-checkout-gate'
import { foundationTenantStatusFromCheckoutSession } from '@/lib/billing/process-stripe-webhook'

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
  })

  test('maps active subscriptions after immediate charge', () => {
    const result = foundationTenantStatusFromCheckoutSession({
      subscription: { status: 'active', trial_end: null },
    })
    expect(result.subscription_status).toBe('active')
  })
})