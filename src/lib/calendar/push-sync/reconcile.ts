import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applyExternalEventStateToAppointment,
  defaultVerifyCalendarEvent,
  findBookedAppointmentByProviderEvent,
  type ExternalEventState,
} from '@/lib/booking/appointment-calendar-sync'
import { APPOINTMENT_STATUS_BOOKED } from '@/lib/booking/appointment-status'
import type { StaffCalendarTarget } from '@/lib/calendar/provider'
import { calendarPushTestMocksAllowed } from '@/lib/calendar/push-sync/config'
import { staffUsesGoogleCalendar } from '@/lib/calendar/push-sync/staff-google-calendar'

const DEFAULT_LOOKBACK_DAYS = 7
const DEFAULT_LOOKAHEAD_DAYS = 120

export type MicrosoftNotificationItem = {
  subscriptionId?: string
  changeType?: string
  resource?: string
  clientState?: string
  resourceData?: { id?: string; ['@odata.type']?: string }
}

export type GoogleWebhookHeaders = {
  channelId: string
  channelToken: string
  resourceId?: string
  resourceState: string
}

export async function reconcileGoogleCalendarPush(
  admin: SupabaseClient,
  tenantId: string,
  calendarId: string,
  staffById: Map<string, StaffCalendarTarget>,
  verify = defaultVerifyCalendarEvent,
): Promise<{ reconciled: number }> {
  const windowStart = new Date()
  windowStart.setDate(windowStart.getDate() - DEFAULT_LOOKBACK_DAYS)
  const windowEnd = new Date()
  windowEnd.setDate(windowEnd.getDate() + DEFAULT_LOOKAHEAD_DAYS)

  const { data, error } = await admin
    .from('appointments')
    .select('id, staff_id, start_time, end_time, status, google_event_id, microsoft_event_id, customer_email')
    .eq('tenant_id', tenantId)
    .eq('status', APPOINTMENT_STATUS_BOOKED)
    .not('google_event_id', 'is', null)
    .gte('start_time', windowStart.toISOString())
    .lte('start_time', windowEnd.toISOString())

  if (error) {
    console.error('[Calendar push] Google reconcile query failed:', error.message)
    return { reconciled: 0 }
  }

  let reconciled = 0
  for (const row of data || []) {
    const staff = staffById.get(row.staff_id)
    if (!staff) continue
    if (!staffUsesGoogleCalendar(staff, calendarId)) continue
    const state = await verify(tenantId, staff, row)
    if (state.kind === 'skipped') continue
    await applyExternalEventStateToAppointment({ admin, tenantId, row, state })
    if (state.kind !== 'error') reconciled += 1
  }
  return { reconciled }
}

export async function loadStaffTargets(
  admin: SupabaseClient,
  tenantId: string,
): Promise<Map<string, StaffCalendarTarget>> {
  const { data } = await admin
    .from('staff')
    .select('id, name, email, calendar_provider, google_calendar_id, microsoft_calendar_id')
    .eq('tenant_id', tenantId)
  const map = new Map<string, StaffCalendarTarget>()
  for (const row of data || []) {
    map.set(row.id, {
      id: row.id,
      name: row.name ?? undefined,
      email: row.email ?? undefined,
      calendar_provider: row.calendar_provider ?? undefined,
      google_calendar_id: row.google_calendar_id ?? undefined,
      microsoft_calendar_id: row.microsoft_calendar_id ?? undefined,
    })
  }
  return map
}

function parseMicrosoftEventId(item: MicrosoftNotificationItem): string | null {
  const fromResource = item.resourceData?.id?.trim()
  if (fromResource) return fromResource
  const resource = item.resource?.trim() ?? ''
  const match = resource.match(/\/events\/([^/]+)$/i)
  return match?.[1] ?? null
}

export type MicrosoftNotificationTestFields = {
  mockState?: ExternalEventState
  mockCancelled?: boolean
  mockMovedStart?: string
  mockMovedEnd?: string
}

export function stripMicrosoftNotificationTestFields(
  item: MicrosoftNotificationItem & MicrosoftNotificationTestFields,
  env: NodeJS.ProcessEnv = process.env,
): MicrosoftNotificationItem {
  if (calendarPushTestMocksAllowed(env)) {
    return item
  }
  const { mockState: _s, mockCancelled: _c, mockMovedStart: _a, mockMovedEnd: _b, ...rest } = item
  return rest
}

function stateFromMockMicrosoftPayload(
  item: MicrosoftNotificationItem & MicrosoftNotificationTestFields,
  env: NodeJS.ProcessEnv = process.env,
): ExternalEventState | null {
  if (!calendarPushTestMocksAllowed(env)) {
    return null
  }
  if (item.mockState) return item.mockState
  if (item.mockCancelled) {
    return { kind: 'cancelled' }
  }
  if (item.mockMovedStart && item.mockMovedEnd) {
    return { kind: 'active', startIso: item.mockMovedStart, endIso: item.mockMovedEnd }
  }
  return null
}

export async function processMicrosoftNotifications(
  admin: SupabaseClient,
  tenantId: string,
  items: MicrosoftNotificationItem[],
  options?: {
    verify?: typeof defaultVerifyCalendarEvent
    staffById?: Map<string, StaffCalendarTarget>
  },
): Promise<{ processed: number }> {
  const verify = options?.verify ?? defaultVerifyCalendarEvent
  const staffById = options?.staffById ?? await loadStaffTargets(admin, tenantId)
  let processed = 0

  for (const item of items) {
    const eventId = parseMicrosoftEventId(item)
    if (!eventId) continue
    const row = await findBookedAppointmentByProviderEvent(admin, tenantId, 'microsoft', eventId)
    if (!row) continue

    let state: ExternalEventState | null = stateFromMockMicrosoftPayload(item)
    if (!state) {
      const staff = staffById.get(row.staff_id)
      if (!staff) continue
      state = await verify(tenantId, staff, row)
    }
    if (state.kind === 'skipped' || state.kind === 'error') continue
    await applyExternalEventStateToAppointment({ admin, tenantId, row, state })
    processed += 1
  }
  return { processed }
}

export type MockGoogleEventPayload = {
  eventId: string
  state: ExternalEventState
}

export async function processMockGoogleEventPayloads(
  admin: SupabaseClient,
  tenantId: string,
  payloads: MockGoogleEventPayload[],
): Promise<number> {
  let processed = 0
  for (const payload of payloads) {
    const row = await findBookedAppointmentByProviderEvent(admin, tenantId, 'google', payload.eventId)
    if (!row) continue
    if (payload.state.kind === 'skipped' || payload.state.kind === 'error') continue
    await applyExternalEventStateToAppointment({ admin, tenantId, row, state: payload.state })
    processed += 1
  }
  return processed
}