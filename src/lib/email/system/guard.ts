import { resolveAppEnv } from '@/lib/env/live-supabase-guard'
import { NON_PRODUCTION_SYSTEM_EMAIL_RECIPIENTS } from './constants'

const ALLOWED = new Set<string>(NON_PRODUCTION_SYSTEM_EMAIL_RECIPIENTS.map((address) => address.toLowerCase()))

export type RecipientGuardResult =
  | { ok: true }
  | { ok: false; code: 'recipient_not_allowed' }

/**
 * Outside production, system email may only go to the approved test inboxes.
 * Production Cloud Run leaves APP_ENV unset and sets NODE_ENV=production.
 * resolveAppEnv treats that as production, matching the rest of the app.
 */
export function assertSystemEmailRecipientAllowed(
  to: string,
  env: NodeJS.ProcessEnv = process.env,
): RecipientGuardResult {
  if (resolveAppEnv(env) === 'production') return { ok: true }
  const normalised = to.trim().toLowerCase()
  if (ALLOWED.has(normalised)) return { ok: true }
  return { ok: false, code: 'recipient_not_allowed' }
}
