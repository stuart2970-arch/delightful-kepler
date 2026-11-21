import type { SupabaseClient } from '@supabase/supabase-js'
import {
  processMicrosoftNotifications,
  stripMicrosoftNotificationTestFields,
  type MicrosoftNotificationItem,
} from '@/lib/calendar/push-sync/reconcile'
import { getSubscriptionByChannelId } from '@/lib/calendar/push-sync/subscription-store'
import { verifyMicrosoftClientState } from '@/lib/calendar/push-sync/microsoft-subscription'

export async function handleMicrosoftCalendarWebhook(
  admin: SupabaseClient,
  items: MicrosoftNotificationItem[],
): Promise<
  | { ok: true; processed: number }
  | { ok: false; status: number; error: string }
> {
  if (items.length === 0) {
    return { ok: false, status: 400, error: 'Empty notification batch' }
  }

  const sanitized = items.map((item) => stripMicrosoftNotificationTestFields(item))
  let tenantId: string | null = null

  for (const item of sanitized) {
    const subscriptionId = item.subscriptionId?.trim()
    if (!subscriptionId) {
      return { ok: false, status: 400, error: 'Missing subscriptionId' }
    }
    const subscription = await getSubscriptionByChannelId(admin, 'microsoft', subscriptionId)
    if (!subscription) {
      return { ok: false, status: 404, error: 'Unknown subscription' }
    }
    const clientState = item.clientState?.trim() ?? ''
    if (!clientState || !verifyMicrosoftClientState(clientState, subscription.verification_token)) {
      return { ok: false, status: 403, error: 'Invalid client state' }
    }
    if (tenantId && tenantId !== subscription.tenant_id) {
      return { ok: false, status: 400, error: 'Mixed tenant notifications' }
    }
    tenantId = subscription.tenant_id
  }

  const { processed } = await processMicrosoftNotifications(admin, tenantId!, sanitized)
  return { ok: true, processed }
}