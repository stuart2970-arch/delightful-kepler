import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getGoogleCalendarClient } from '@/lib/calendar/provider'
import {
  calendarPushRegistrationAllowed,
  googleCalendarWebhookUrl,
} from '@/lib/calendar/push-sync/config'
import { upsertCalendarPushSubscription } from '@/lib/calendar/push-sync/subscription-store'
import { secretsEqual } from '@/lib/security/secrets-equal'

export type GoogleWatchResult = {
  channelId: string
  resourceId: string
  expirationMs: number
  verificationToken: string
}

export async function registerGoogleCalendarWatch(
  admin: SupabaseClient,
  tenantId: string,
  calendarId: string,
): Promise<GoogleWatchResult | null> {
  if (!calendarPushRegistrationAllowed()) {
    return null
  }
  const calendar = await getGoogleCalendarClient(tenantId)
  if (!calendar) {
    return null
  }

  const channelId = randomUUID()
  const verificationToken = randomUUID()
  const webhookUrl = googleCalendarWebhookUrl()
  const ttlMs = 6 * 24 * 60 * 60 * 1000
  const expirationMs = Date.now() + ttlMs

  const res = await calendar.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: webhookUrl,
      token: verificationToken,
      expiration: String(expirationMs),
    },
  })

  const resourceId = res.data.resourceId
  if (!resourceId) {
    throw new Error('Google events.watch returned no resourceId')
  }

  await upsertCalendarPushSubscription(admin, {
    tenant_id: tenantId,
    provider: 'google',
    calendar_id: calendarId,
    channel_id: channelId,
    resource_id: resourceId,
    verification_token: verificationToken,
    expires_at: new Date(expirationMs).toISOString(),
  })

  return { channelId, resourceId, expirationMs, verificationToken }
}

export function verifyGoogleWebhookToken(provided: string, expected: string): boolean {
  return secretsEqual(provided, expected)
}

export async function stopGoogleCalendarWatch(
  admin: SupabaseClient,
  tenantId: string,
  channelId: string,
  resourceId: string,
): Promise<void> {
  if (!calendarPushRegistrationAllowed()) return
  const calendar = await getGoogleCalendarClient(tenantId)
  if (!calendar) return
  try {
    await calendar.channels.stop({
      requestBody: { id: channelId, resourceId },
    })
  } catch (err) {
    console.warn('[Calendar push] Google channel stop failed:', err)
  }
}