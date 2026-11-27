/**
 * STYL-420: Cross-device email confirmation via token_hash + verifyOtp (no PKCE code verifier).
 */

import { publicAppPath } from '@/lib/env/public-app-url'
import { embedAwarePublicPath } from '@/lib/env/embed-parent'
import {
  buildSignupCheckoutPath,
  resolvePostSignupCheckoutNext,
} from '@/lib/billing/signup-checkout-gate'

export const EMAIL_CONFIRM_OTP_TYPES = new Set([
  'signup',
  'email',
  'email_change',
  'invite',
  'magiclink',
  'recovery',
])

export function isEmailConfirmOtpType(type: string | null | undefined): boolean {
  const normalized = (type || '').trim().toLowerCase()
  return EMAIL_CONFIRM_OTP_TYPES.has(normalized)
}

export function buildEmailSignupRedirectUrl(nextPath?: string): string {
  const next = nextPath || buildSignupCheckoutPath({ returnUrl: '/payment-confirmed' })
  return embedAwarePublicPath(`/auth/callback?next=${encodeURIComponent(next)}`)
}

export function buildTokenHashConfirmUrl(type: 'signup' | 'email' = 'signup', nextPath?: string): string {
  const base = embedAwarePublicPath('/auth/confirm')
  const params = new URLSearchParams({ type })
  if (nextPath) params.set('next', nextPath)
  return `${base}?${params.toString()}`
}

export function resolveAuthCallbackNext(options: {
  requestedNext: string | null
  type: string | null
  userMetadata: Record<string, unknown> | null | undefined
}): string {
  const raw = (options.requestedNext || '').trim()
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return raw
  }
  if (options.type === 'signup' || options.type === 'email') {
    return resolvePostSignupCheckoutNext(options.userMetadata)
  }
  return '/dashboard'
}

export function shouldPreferTokenHashOverPkceCode(searchParams: URLSearchParams): boolean {
  if (searchParams.get('token_hash')) return true
  return false
}