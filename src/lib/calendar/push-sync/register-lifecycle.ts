import type { SupabaseClient } from '@supabase/supabase-js'
import type { StaffCalendarTarget } from '@/lib/calendar/provider'
import { calendarPushRegistrationAllowed } from '@/lib/calendar/push-sync/config'
import { registerGoogleCalendarWatch, stopGoogleCalendarWatch } from '@/lib/calendar/push-sync/google-watch'
import {
  deleteMicrosoftCalendarSubscription,
  registerMicrosoftCalendarSubscription,
} from '@/lib/calendar/push-sync/microsoft-subscription'
import { normalizeGoogleCalendarId } from '@/lib/calendar/push-sync/staff-google-calendar'
import {
  deleteCalendarPushSubscription,
  findLiveCalendarPushSubscription,
  listCalendarPushSubscriptionsForTenant,
  listCalendarPushSubscriptionsForTenantCalendar,
  listExpiredCalendarPushSubscriptions,
  type CalendarPushSubscriptionRow,
} from '@/lib/calendar/push-sync/subscription-store'

export type CalendarPushRegisterDeps = {
  registerGoogle?: typeof registerGoogleCalendarWatch
  registerMicrosoft?: typeof registerMicrosoftCalendarSubscription
  stopGoogle?: typeof stopGoogleCalendarWatch
  deleteMicrosoft?: typeof deleteMicrosoftCalendarSubscription
  now?: () => number
}

export type EnsurePushResult = 'registered' | 'skipped' | 'unavailable'

export type BackfillCalendarPushResult = {
  registered: number
  skipped: number
  errors: string[]
}

const MICROSOFT_PUSH_CALENDAR_ID = 'me/events'

function depsWithDefaults(deps?: CalendarPushRegisterDeps) {
  return {
    registerGoogle: deps?.registerGoogle ?? registerGoogleCalendarWatch,
    registerMicrosoft: deps?.registerMicrosoft ?? registerMicrosoftCalendarSubscription,
    stopGoogle: deps?.stopGoogle ?? stopGoogleCalendarWatch,
    deleteMicrosoft: deps?.deleteMicrosoft ?? deleteMicrosoftCalendarSubscription,
    now: deps?.now ?? (() => Date.now()),
  }
}

export function isLiveSubscription(row: CalendarPushSubscriptionRow, nowMs: number): boolean {
  return new Date(row.expires_at).getTime() > nowMs
}

export async function tenantHasGoogleCalendar(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data } = await admin
    .from('tenant_integrations')
    .select('refresh_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'google_calendar')
    .maybeSingle()
  return Boolean(data?.refresh_token)
}

export async function tenantHasMicrosoftCalendar(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const [{ data: integration }, { data: tenant }] = await Promise.all([
    admin
      .from('tenant_integrations')
      .select('refresh_token')
      .eq('tenant_id', tenantId)
      .eq('provider', 'microsoft_calendar')
      .maybeSingle(),
    admin.from('tenants').select('microsoft_refresh_token').eq('id', tenantId).maybeSingle(),
  ])
  return Boolean(integration?.refresh_token || tenant?.microsoft_refresh_token)
}

export async function distinctGoogleCalendarIdsForTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from('staff')
    .select('google_calendar_id, calendar_provider')
    .eq('tenant_id', tenantId)
  if (error || !data?.length) {
    return ['primary']
  }
  const ids = new Set<string>()
  for (const row of data) {
    if (row.calendar_provider === 'microsoft') continue
    ids.add(normalizeGoogleCalendarId(row.google_calendar_id))
  }
  if (ids.size === 0) ids.add('primary')
  return [...ids]
}

export async function staffCountUsingGoogleCalendar(
  admin: SupabaseClient,
  tenantId: string,
  calendarId: string,
): Promise<number> {
  const normalized = normalizeGoogleCalendarId(calendarId)
  const { data } = await admin
    .from('staff')
    .select('google_calendar_id, calendar_provider')
    .eq('tenant_id', tenantId)
  if (!data) return 0
  return data.filter(
    (row) =>
      row.calendar_provider !== 'microsoft' &&
      normalizeGoogleCalendarId(row.google_calendar_id) === normalized,
  ).length
}

export async function ensureGoogleCalendarPushWatch(
  admin: SupabaseClient,
  tenantId: string,
  calendarId: string,
  deps?: CalendarPushRegisterDeps,
): Promise<EnsurePushResult> {
  if (!calendarPushRegistrationAllowed()) return 'unavailable'
  const d = depsWithDefaults(deps)
  const normalized = normalizeGoogleCalendarId(calendarId)
  const existing = await findLiveCalendarPushSubscription(admin, tenantId, 'google', normalized, d.now())
  if (existing) return 'skipped'
  const watch = await d.registerGoogle(admin, tenantId, normalized)
  return watch ? 'registered' : 'unavailable'
}

export async function ensureMicrosoftCalendarPushSubscription(
  admin: SupabaseClient,
  tenantId: string,
  deps?: CalendarPushRegisterDeps,
): Promise<EnsurePushResult> {
  if (!calendarPushRegistrationAllowed()) return 'unavailable'
  const d = depsWithDefaults(deps)
  const existing = await findLiveCalendarPushSubscription(
    admin,
    tenantId,
    'microsoft',
    MICROSOFT_PUSH_CALENDAR_ID,
    d.now(),
  )
  if (existing) return 'skipped'
  const sub = await d.registerMicrosoft(admin, tenantId)
  return sub ? 'registered' : 'unavailable'
}

export async function teardownGoogleCalendarPushWatch(
  admin: SupabaseClient,
  tenantId: string,
  calendarId: string,
  deps?: CalendarPushRegisterDeps,
): Promise<void> {
  if (!calendarPushRegistrationAllowed()) return
  const d = depsWithDefaults(deps)
  const normalized = normalizeGoogleCalendarId(calendarId)
  const rows = await listCalendarPushSubscriptionsForTenantCalendar(
    admin,
    tenantId,
    'google',
    normalized,
  )
  for (const row of rows) {
    if (row.resource_id) {
      await d.stopGoogle(admin, tenantId, row.channel_id, row.resource_id)
    }
    await deleteCalendarPushSubscription(admin, row.id)
  }
}

export async function teardownAllGoogleCalendarPushForTenant(
  admin: SupabaseClient,
  tenantId: string,
  deps?: CalendarPushRegisterDeps,
): Promise<void> {
  const rows = await listCalendarPushSubscriptionsForTenant(admin, tenantId, 'google')
  const calendarIds = [...new Set(rows.map((r) => r.calendar_id))]
  for (const calendarId of calendarIds) {
    await teardownGoogleCalendarPushWatch(admin, tenantId, calendarId, deps)
  }
}

export async function purgeExpiredCalendarPushSubscriptions(
  admin: SupabaseClient,
  deps?: CalendarPushRegisterDeps,
): Promise<number> {
  const d = depsWithDefaults(deps)
  const expired = await listExpiredCalendarPushSubscriptions(admin, new Date(d.now()).toISOString())
  for (const row of expired) {
    if (row.provider === 'google' && row.resource_id) {
      await d.stopGoogle(admin, row.tenant_id, row.channel_id, row.resource_id)
    }
    if (row.provider === 'microsoft') {
      await d.deleteMicrosoft(admin, row.tenant_id, row.channel_id)
    }
    await deleteCalendarPushSubscription(admin, row.id)
  }
  return expired.length
}

export async function disconnectGoogleCalendarIntegration(
  admin: SupabaseClient,
  tenantId: string,
  deps?: CalendarPushRegisterDeps,
): Promise<void> {
  await teardownAllGoogleCalendarPushForTenant(admin, tenantId, deps)
  const { error } = await admin
    .from('tenant_integrations')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('provider', 'google_calendar')
  if (error) {
    throw new Error(`tenant_integrations delete failed: ${error.message}`)
  }
}

export async function disconnectMicrosoftCalendarIntegration(
  admin: SupabaseClient,
  tenantId: string,
  deps?: CalendarPushRegisterDeps,
): Promise<void> {
  await teardownMicrosoftCalendarPushForTenant(admin, tenantId, deps)
  const [{ error: integrationError }, { error: tenantError }] = await Promise.all([
    admin
      .from('tenant_integrations')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('provider', 'microsoft_calendar'),
    admin.from('tenants').update({ microsoft_refresh_token: null }).eq('id', tenantId),
  ])
  if (integrationError) {
    throw new Error(`tenant_integrations delete failed: ${integrationError.message}`)
  }
  if (tenantError) {
    throw new Error(`tenants microsoft_refresh_token clear failed: ${tenantError.message}`)
  }
}

export async function teardownMicrosoftCalendarPushForTenant(
  admin: SupabaseClient,
  tenantId: string,
  deps?: CalendarPushRegisterDeps,
): Promise<void> {
  if (!calendarPushRegistrationAllowed()) return
  const d = depsWithDefaults(deps)
  const rows = await listCalendarPushSubscriptionsForTenant(admin, tenantId, 'microsoft')
  for (const row of rows) {
    await d.deleteMicrosoft(admin, tenantId, row.channel_id)
    await deleteCalendarPushSubscription(admin, row.id)
  }
}

export async function onGoogleCalendarConnected(
  admin: SupabaseClient,
  tenantId: string,
  deps?: CalendarPushRegisterDeps,
): Promise<void> {
  const calendarIds = await distinctGoogleCalendarIdsForTenant(admin, tenantId)
  for (const calendarId of calendarIds) {
    await ensureGoogleCalendarPushWatch(admin, tenantId, calendarId, deps)
  }
}

export async function onMicrosoftCalendarConnected(
  admin: SupabaseClient,
  tenantId: string,
  deps?: CalendarPushRegisterDeps,
): Promise<void> {
  await ensureMicrosoftCalendarPushSubscription(admin, tenantId, deps)
}

export async function onStaffGoogleCalendarIdChanged(
  admin: SupabaseClient,
  tenantId: string,
  previousCalendarId: string | null | undefined,
  nextCalendarId: string | null | undefined,
  deps?: CalendarPushRegisterDeps,
): Promise<void> {
  if (!calendarPushRegistrationAllowed()) return
  const prev = normalizeGoogleCalendarId(previousCalendarId)
  const next = normalizeGoogleCalendarId(nextCalendarId)
  if (prev === next) return
  const stillUsingPrev = await staffCountUsingGoogleCalendar(admin, tenantId, prev)
  if (stillUsingPrev === 0) {
    await teardownGoogleCalendarPushWatch(admin, tenantId, prev, deps)
  }
  if (await tenantHasGoogleCalendar(admin, tenantId)) {
    await ensureGoogleCalendarPushWatch(admin, tenantId, next, deps)
  }
}

export async function backfillMissingCalendarPushSubscriptions(
  admin: SupabaseClient,
  deps?: CalendarPushRegisterDeps,
): Promise<BackfillCalendarPushResult> {
  const result: BackfillCalendarPushResult = { registered: 0, skipped: 0, errors: [] }
  if (!calendarPushRegistrationAllowed()) return result

  const { data: tenants, error } = await admin.from('tenants').select('id')
  if (error) {
    result.errors.push(`tenant list: ${error.message}`)
    return result
  }

  for (const tenant of tenants || []) {
    const tenantId = String(tenant.id)
    try {
      if (await tenantHasGoogleCalendar(admin, tenantId)) {
        const calendarIds = await distinctGoogleCalendarIdsForTenant(admin, tenantId)
        for (const calendarId of calendarIds) {
          const status = await ensureGoogleCalendarPushWatch(admin, tenantId, calendarId, deps)
          if (status === 'registered') result.registered += 1
          else if (status === 'skipped') result.skipped += 1
        }
      }
      if (await tenantHasMicrosoftCalendar(admin, tenantId)) {
        const status = await ensureMicrosoftCalendarPushSubscription(admin, tenantId, deps)
        if (status === 'registered') result.registered += 1
        else if (status === 'skipped') result.skipped += 1
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(`tenant:${tenantId}: ${message}`)
      console.error('[Calendar push backfill]', tenantId, err)
    }
  }
  return result
}

/** Fire-and-forget helper for OAuth / API routes (errors are logged, never thrown). */
export function runCalendarPushSideEffect(label: string, work: () => Promise<void>): void {
  if (!calendarPushRegistrationAllowed()) return
  void work().catch((err) => {
    console.error(`[Calendar push] ${label}:`, err)
  })
}

export type StaffRowForPush = Pick<StaffCalendarTarget, 'google_calendar_id' | 'calendar_provider'>