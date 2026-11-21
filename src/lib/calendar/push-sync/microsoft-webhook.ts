import type { SupabaseClient } from '@supabase/supabase-js'
import {
  processMicrosoftNotifications,
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
  const subscriptionId = items.find((i) => i.subscriptionId)?.subscriptionId?.trim()
  if (!subscriptionId) {
    return { ok: false, status: 400, error: 'Missing subscriptionId' }
  }
  const subscription = await getSubscriptionByChannelId(admin, 'microsoft', subscriptionId)
  if (!subscription) {
    return { ok: false, status: 404, error: 'Unknown subscription' }
  }

  for (const item of items) {
    const clientState = item.clientState?.trim() ?? ''
    if (!clientState || !verifyMicrosoftClientState(clientState, subscription.verification_token)) {
      return { ok: false, status: 403, error: 'Invalid client state' }
    }
  }

  const { processed } = await processMicrosoftNotifications(admin, subscription.tenant_id, items)
  return { ok: true, processed }
}