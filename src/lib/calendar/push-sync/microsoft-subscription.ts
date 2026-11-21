import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMicrosoftAccessToken } from '@/lib/microsoft-calendar'
import {
  calendarPushRegistrationAllowed,
  microsoftCalendarWebhookUrl,
} from '@/lib/calendar/push-sync/config'
import { upsertCalendarPushSubscription } from '@/lib/calendar/push-sync/subscription-store'
import { secretsEqual } from '@/lib/security/secrets-equal'

const SUBSCRIPTION_LIFETIME_MINUTES = 4230

export type MicrosoftSubscriptionResult = {
  subscriptionId: string
  expirationIso: string
  clientState: string
}

export async function registerMicrosoftCalendarSubscription(
  admin: SupabaseClient,
  tenantId: string,
): Promise<MicrosoftSubscriptionResult | null> {
  if (!calendarPushRegistrationAllowed()) {
    return null
  }
  const token = await getMicrosoftAccessToken(tenantId)
  if (!token || token === 'mock_ms_access_token') {
    return null
  }

  const clientState = randomUUID()
  const expiration = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60 * 1000)
  const body = {
    changeType: 'created,updated,deleted',
    notificationUrl: microsoftCalendarWebhookUrl(),
    resource: '/me/events',
    expirationDateTime: expiration.toISOString(),
    clientState,
  }

  const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Microsoft subscription create failed: ${res.status} ${text}`)
  }
  const data = (await res.json()) as { id?: string; expirationDateTime?: string }
  if (!data.id) {
    throw new Error('Microsoft subscription create returned no id')
  }

  const expirationIso = data.expirationDateTime ?? expiration.toISOString()
  await upsertCalendarPushSubscription(admin, {
    tenant_id: tenantId,
    provider: 'microsoft',
    calendar_id: 'me/events',
    channel_id: data.id,
    resource_id: null,
    verification_token: clientState,
    expires_at: expirationIso,
  })

  return { subscriptionId: data.id, expirationIso, clientState }
}

export function verifyMicrosoftClientState(provided: string, expected: string): boolean {
  return secretsEqual(provided, expected)
}

export async function renewMicrosoftCalendarSubscription(
  admin: SupabaseClient,
  tenantId: string,
  subscriptionId: string,
): Promise<string | null> {
  if (!calendarPushRegistrationAllowed()) {
    return null
  }
  const token = await getMicrosoftAccessToken(tenantId)
  if (!token || token === 'mock_ms_access_token') {
    return null
  }
  const expiration = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60 * 1000)
  const res = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expirationDateTime: expiration.toISOString() }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Microsoft subscription renew failed: ${res.status} ${text}`)
  }
  const data = (await res.json()) as { expirationDateTime?: string }
  return data.expirationDateTime ?? expiration.toISOString()
}