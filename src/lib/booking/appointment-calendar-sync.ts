import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getGoogleCalendarClient,
  resolveCalendarProvider,
  type StaffCalendarTarget,
} from '@/lib/calendar/provider'
import { getMicrosoftAccessToken } from '@/lib/microsoft-calendar'
import { APPOINTMENT_STATUS_BOOKED, APPOINTMENT_STATUS_CANCELLED } from '@/lib/booking/appointment-status'

const DEFAULT_VERIFY_TIMEOUT_MS = 4_000

export type OverlappingAppointmentRow = {
  id: string
  staff_id: string
  start_time: string
  end_time: string
  status?: string | null
  google_event_id?: string | null
  microsoft_event_id?: string | null
  customer_email?: string | null
}

export type BusyAppointmentInterval = {
  staff_id: string
  start_time: string
  end_time: string
}

export type ExternalEventState =
  | { kind: 'active'; startIso?: string; endIso?: string }
  | { kind: 'cancelled' }
  | { kind: 'missing' }
  | { kind: 'error' }
  | { kind: 'skipped' }

export type VerifyCalendarEvent = (
  tenantId: string,
  staff: StaffCalendarTarget,
  row: OverlappingAppointmentRow,
) => Promise<ExternalEventState>

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function defaultVerifyCalendarEvent(
  tenantId: string,
  staff: StaffCalendarTarget,
  row: OverlappingAppointmentRow,
): Promise<ExternalEventState> {
  const googleEventId = row.google_event_id?.trim()
  const microsoftEventId = row.microsoft_event_id?.trim()
  if (!googleEventId && !microsoftEventId) {
    return { kind: 'skipped' }
  }

  try {
    const provider = await resolveCalendarProvider(tenantId, staff)
    if (provider === 'microsoft' && microsoftEventId) {
      return await verifyMicrosoftEvent(tenantId, microsoftEventId)
    }
    if (provider === 'google' && googleEventId) {
      const calendarId = staff.google_calendar_id || 'primary'
      return await verifyGoogleEvent(tenantId, calendarId, googleEventId)
    }
    if (googleEventId) {
      const calendarId = staff.google_calendar_id || 'primary'
      return await verifyGoogleEvent(tenantId, calendarId, googleEventId)
    }
    if (microsoftEventId) {
      return await verifyMicrosoftEvent(tenantId, microsoftEventId)
    }
    return { kind: 'skipped' }
  } catch {
    return { kind: 'error' }
  }
}

async function verifyGoogleEvent(
  tenantId: string,
  calendarId: string,
  eventId: string,
): Promise<ExternalEventState> {
  const calendar = await getGoogleCalendarClient(tenantId)
  if (!calendar) {
    return { kind: 'skipped' }
  }

  try {
    const res = await withTimeout(
      calendar.events.get({ calendarId, eventId }),
      DEFAULT_VERIFY_TIMEOUT_MS,
      'Google event lookup',
    )
    if (res.data.status === 'cancelled') {
      return { kind: 'cancelled' }
    }
    const start = res.data.start?.dateTime || res.data.start?.date
    const end = res.data.end?.dateTime || res.data.end?.date
    if (start && end) {
      return {
        kind: 'active',
        startIso: new Date(start).toISOString(),
        endIso: new Date(end).toISOString(),
      }
    }
    return { kind: 'active' }
  } catch (err: unknown) {
    const code = typeof err === 'object' && err && 'code' in err ? Number((err as { code?: number }).code) : null
    if (code === 404 || code === 410) {
      return { kind: 'missing' }
    }
    return { kind: 'error' }
  }
}

async function verifyMicrosoftEvent(tenantId: string, eventId: string): Promise<ExternalEventState> {
  const token = await getMicrosoftAccessToken(tenantId)
  if (!token || token === 'mock_ms_access_token') {
    return { kind: 'skipped' }
  }

  const url = `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}?$select=id,start,end,isCancelled`

  try {
    const res = await withTimeout(
      fetch(url, { headers: { Authorization: `Bearer ${token}` } }),
      DEFAULT_VERIFY_TIMEOUT_MS,
      'Microsoft event lookup',
    )
    if (res.status === 404) {
      return { kind: 'missing' }
    }
    if (!res.ok) {
      return { kind: 'error' }
    }
    const data = (await res.json()) as {
      isCancelled?: boolean
      start?: { dateTime?: string }
      end?: { dateTime?: string }
    }
    if (data.isCancelled) {
      return { kind: 'cancelled' }
    }
    const startRaw = data.start?.dateTime
    const endRaw = data.end?.dateTime
    if (startRaw && endRaw) {
      const startIso = new Date(startRaw.endsWith('Z') ? startRaw : `${startRaw}Z`).toISOString()
      const endIso = new Date(endRaw.endsWith('Z') ? endRaw : `${endRaw}Z`).toISOString()
      return { kind: 'active', startIso, endIso }
    }
    return { kind: 'active' }
  } catch {
    return { kind: 'error' }
  }
}

function intervalOverlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && aEnd > bStart
}

/**
 * Returns appointment intervals that should block availability after excluding
 * cancelled rows and reconciling overlapping rows against the connected calendar.
 * API errors during verify fail closed (row stays busy).
 */
export async function resolveBusyAppointmentIntervals(params: {
  admin: SupabaseClient
  tenantId: string
  staffById: Map<string, StaffCalendarTarget>
  windowStart: Date
  windowEnd: Date
  rows: OverlappingAppointmentRow[] | null | undefined
  verify?: VerifyCalendarEvent
}): Promise<BusyAppointmentInterval[]> {
  const verify = params.verify ?? defaultVerifyCalendarEvent
  const busy: BusyAppointmentInterval[] = []

  for (const row of params.rows || []) {
    if (!row.staff_id || !row.start_time || !row.end_time) continue
    if (row.status === APPOINTMENT_STATUS_CANCELLED) continue

    const staff = params.staffById.get(row.staff_id)
    const hasExternalId = Boolean(row.google_event_id?.trim() || row.microsoft_event_id?.trim())

    let startIso = row.start_time
    let endIso = row.end_time
    let block = true

    if (hasExternalId && staff) {
      const state = await verify(params.tenantId, staff, row)
      if (state.kind === 'cancelled' || state.kind === 'missing') {
        await params.admin
          .from('appointments')
          .update({ status: APPOINTMENT_STATUS_CANCELLED })
          .eq('id', row.id)
          .eq('tenant_id', params.tenantId)
        block = false
      } else if (state.kind === 'active') {
        if (state.startIso && state.endIso) {
          startIso = state.startIso
          endIso = state.endIso
          if (startIso !== row.start_time || endIso !== row.end_time) {
            await params.admin
              .from('appointments')
              .update({ start_time: startIso, end_time: endIso, status: APPOINTMENT_STATUS_BOOKED })
              .eq('id', row.id)
              .eq('tenant_id', params.tenantId)
            block = intervalOverlaps(
              new Date(startIso),
              new Date(endIso),
              params.windowStart,
              params.windowEnd,
            )
          }
        }
      } else if (state.kind === 'error') {
        block = true
      } else {
        block = true
      }
    }

    if (!block) continue

    busy.push({
      staff_id: row.staff_id,
      start_time: startIso,
      end_time: endIso,
    })
  }

  return busy
}

/**
 * Query overlapping booked appointments for a tenant/window (optional staff filter).
 */
export async function fetchOverlappingAppointments(
  admin: SupabaseClient,
  tenantId: string,
  windowStart: Date,
  windowEnd: Date,
  staffIds?: string[],
): Promise<OverlappingAppointmentRow[]> {
  let query = admin
    .from('appointments')
    .select('id, staff_id, start_time, end_time, status, google_event_id, microsoft_event_id, customer_email')
    .eq('tenant_id', tenantId)
    .eq('status', APPOINTMENT_STATUS_BOOKED)
    .lt('start_time', windowEnd.toISOString())
    .gt('end_time', windowStart.toISOString())

  if (staffIds && staffIds.length > 0) {
    query = query.in('staff_id', staffIds)
  }

  const { data, error } = await query
  if (error) {
    console.error('[Appointments] Overlap query failed:', error.message)
    return []
  }
  return (data || []) as OverlappingAppointmentRow[]
}