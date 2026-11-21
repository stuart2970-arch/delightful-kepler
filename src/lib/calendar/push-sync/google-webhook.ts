import type { SupabaseClient } from '@supabase/supabase-js'
import {
  loadStaffTargets,
  reconcileGoogleCalendarPush,
  type MockGoogleEventPayload,
  processMockGoogleEventPayloads,
} from '@/lib/calendar/push-sync/reconcile'
import { getSubscriptionByChannelId } from '@/lib/calendar/push-sync/subscription-store'
import { verifyGoogleWebhookToken } from '@/lib/calendar/push-sync/google-watch'

export type GoogleWebhookInput = {
  channelId: string
  channelToken: string
  resourceState: string
  mockEventPayloads?: MockGoogleEventPayload[]
}

export type GoogleWebhookResult =
  | { ok: true; action: 'sync' | 'reconciled' | 'mock_processed'; count?: number }
  | { ok: false; status: number; error: string }

export async function handleGoogleCalendarWebhook(
  admin: SupabaseClient,
  input: GoogleWebhookInput,
): Promise<GoogleWebhookResult> {
  const subscription = await getSubscriptionByChannelId(admin, 'google', input.channelId)
  if (!subscription) {
    return { ok: false, status: 404, error: 'Unknown channel' }
  }
  if (!verifyGoogleWebhookToken(input.channelToken, subscription.verification_token)) {
    return { ok: false, status: 403, error: 'Invalid channel token' }
  }

  if (input.resourceState === 'sync') {
    return { ok: true, action: 'sync' }
  }

  if (input.mockEventPayloads && input.mockEventPayloads.length > 0) {
    const count = await processMockGoogleEventPayloads(
      admin,
      subscription.tenant_id,
      input.mockEventPayloads,
    )
    return { ok: true, action: 'mock_processed', count }
  }

  if (input.resourceState === 'exists' || input.resourceState === 'not_exists') {
    const staffById = await loadStaffTargets(admin, subscription.tenant_id)
    const { reconciled } = await reconcileGoogleCalendarPush(
      admin,
      subscription.tenant_id,
      subscription.calendar_id,
      staffById,
    )
    return { ok: true, action: 'reconciled', count: reconciled }
  }

  return { ok: true, action: 'sync' }
}