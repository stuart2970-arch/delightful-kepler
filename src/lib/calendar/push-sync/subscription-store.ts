import type { SupabaseClient } from '@supabase/supabase-js'
import type { CalendarPushProvider } from '@/lib/calendar/push-sync/config'

export type CalendarPushSubscriptionRow = {
  id: string
  tenant_id: string
  provider: CalendarPushProvider
  calendar_id: string
  channel_id: string
  resource_id: string | null
  verification_token: string
  expires_at: string
}

export async function getSubscriptionByChannelId(
  admin: SupabaseClient,
  provider: CalendarPushProvider,
  channelId: string,
): Promise<CalendarPushSubscriptionRow | null> {
  const { data, error } = await admin
    .from('calendar_push_subscriptions')
    .select('id, tenant_id, provider, calendar_id, channel_id, resource_id, verification_token, expires_at')
    .eq('provider', provider)
    .eq('channel_id', channelId)
    .maybeSingle()
  if (error || !data) return null
  return data as CalendarPushSubscriptionRow
}

export async function upsertCalendarPushSubscription(
  admin: SupabaseClient,
  row: {
    tenant_id: string
    provider: CalendarPushProvider
    calendar_id: string
    channel_id: string
    resource_id?: string | null
    verification_token: string
    expires_at: string
  },
): Promise<void> {
  const { error } = await admin
    .from('calendar_push_subscriptions')
    .upsert(
      {
        ...row,
        resource_id: row.resource_id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'provider,channel_id' },
    )
  if (error) {
    throw new Error(`calendar_push_subscriptions upsert failed: ${error.message}`)
  }
}

export async function listSubscriptionsExpiringBefore(
  admin: SupabaseClient,
  beforeIso: string,
): Promise<CalendarPushSubscriptionRow[]> {
  const { data, error } = await admin
    .from('calendar_push_subscriptions')
    .select('id, tenant_id, provider, calendar_id, channel_id, resource_id, verification_token, expires_at')
    .lte('expires_at', beforeIso)
    .order('expires_at', { ascending: true })
  if (error) {
    throw new Error(`calendar_push_subscriptions list failed: ${error.message}`)
  }
  return (data || []) as CalendarPushSubscriptionRow[]
}

export async function deleteCalendarPushSubscription(
  admin: SupabaseClient,
  id: string,
): Promise<void> {
  await admin.from('calendar_push_subscriptions').delete().eq('id', id)
}

export async function listCalendarPushSubscriptionsForTenant(
  admin: SupabaseClient,
  tenantId: string,
  provider?: CalendarPushProvider,
): Promise<CalendarPushSubscriptionRow[]> {
  let query = admin
    .from('calendar_push_subscriptions')
    .select('id, tenant_id, provider, calendar_id, channel_id, resource_id, verification_token, expires_at')
    .eq('tenant_id', tenantId)
  if (provider) {
    query = query.eq('provider', provider)
  }
  const { data, error } = await query
  if (error) {
    throw new Error(`calendar_push_subscriptions tenant list failed: ${error.message}`)
  }
  return (data || []) as CalendarPushSubscriptionRow[]
}

export async function findLiveCalendarPushSubscription(
  admin: SupabaseClient,
  tenantId: string,
  provider: CalendarPushProvider,
  calendarId: string,
  nowMs: number = Date.now(),
): Promise<CalendarPushSubscriptionRow | null> {
  const rows = await listCalendarPushSubscriptionsForTenant(admin, tenantId, provider)
  const match = rows.find(
    (row) => row.calendar_id === calendarId && new Date(row.expires_at).getTime() > nowMs,
  )
  return match ?? null
}