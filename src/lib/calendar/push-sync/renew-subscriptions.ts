import type { SupabaseClient } from '@supabase/supabase-js'
import { calendarPushRegistrationAllowed } from '@/lib/calendar/push-sync/config'
import { registerGoogleCalendarWatch, stopGoogleCalendarWatch } from '@/lib/calendar/push-sync/google-watch'
import { renewMicrosoftCalendarSubscription } from '@/lib/calendar/push-sync/microsoft-subscription'
import {
  deleteCalendarPushSubscription,
  listSubscriptionsExpiringBefore,
  type CalendarPushSubscriptionRow,
  upsertCalendarPushSubscription,
} from '@/lib/calendar/push-sync/subscription-store'

export type RenewCalendarPushResult = {
  renewed: number
  skipped: number
  errors: string[]
}

const DEFAULT_RENEW_WITHIN_MS = 24 * 60 * 60 * 1000

export async function renewCalendarPushSubscriptions(
  admin: SupabaseClient,
  options?: { renewWithinMs?: number },
): Promise<RenewCalendarPushResult> {
  const renewWithinMs = options?.renewWithinMs ?? DEFAULT_RENEW_WITHIN_MS
  const cutoff = new Date(Date.now() + renewWithinMs).toISOString()
  const expiring = await listSubscriptionsExpiringBefore(admin, cutoff)
  const result: RenewCalendarPushResult = { renewed: 0, skipped: 0, errors: [] }

  if (!calendarPushRegistrationAllowed()) {
    return { renewed: 0, skipped: expiring.length, errors: [] }
  }

  for (const row of expiring) {
    try {
      const ok = await renewOneSubscription(admin, row)
      if (ok) result.renewed += 1
      else result.skipped += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(`${row.provider}:${row.channel_id}: ${message}`)
    }
  }
  return result
}

async function renewOneSubscription(
  admin: SupabaseClient,
  row: CalendarPushSubscriptionRow,
): Promise<boolean> {
  if (row.provider === 'google') {
    if (row.resource_id) {
      await stopGoogleCalendarWatch(admin, row.tenant_id, row.channel_id, row.resource_id)
    }
    await deleteCalendarPushSubscription(admin, row.id)
    const watch = await registerGoogleCalendarWatch(admin, row.tenant_id, row.calendar_id)
    return Boolean(watch)
  }
  if (row.provider === 'microsoft') {
    const expirationIso = await renewMicrosoftCalendarSubscription(admin, row.tenant_id, row.channel_id)
    if (!expirationIso) return false
    await upsertCalendarPushSubscription(admin, {
      tenant_id: row.tenant_id,
      provider: 'microsoft',
      calendar_id: row.calendar_id,
      channel_id: row.channel_id,
      resource_id: row.resource_id,
      verification_token: row.verification_token,
      expires_at: expirationIso,
    })
    return true
  }
  return false
}

/** Test helper: advance expires_at without calling external APIs. */
export async function mockRenewSubscriptionRow(
  admin: SupabaseClient,
  row: CalendarPushSubscriptionRow,
  newExpiresIso: string,
): Promise<void> {
  await upsertCalendarPushSubscription(admin, {
    tenant_id: row.tenant_id,
    provider: row.provider,
    calendar_id: row.calendar_id,
    channel_id: row.channel_id,
    resource_id: row.resource_id,
    verification_token: row.verification_token,
    expires_at: newExpiresIso,
  })
}