import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchOverlappingAppointments,
  resolveBusyAppointmentIntervals,
  AppointmentOverlapQueryError,
  type VerifyCalendarEvent,
} from '@/lib/booking/appointment-calendar-sync'
import type { StaffCalendarTarget } from '@/lib/calendar/provider'

/**
 * Returns staff IDs that still block a slot after cancelled-row exclusion and
 * optional calendar reconciliation.
 */
export async function staffIdsBlockingSlot(params: {
  admin: SupabaseClient
  tenantId: string
  slotStart: Date
  slotEnd: Date
  staffById: Map<string, StaffCalendarTarget>
  verify?: VerifyCalendarEvent
}): Promise<Set<string>> {
  const staffIds = [...params.staffById.keys()]
  if (staffIds.length === 0) return new Set()

  let rows
  try {
    rows = await fetchOverlappingAppointments(
      params.admin,
      params.tenantId,
      params.slotStart,
      params.slotEnd,
      staffIds,
    )
  } catch (err) {
    if (err instanceof AppointmentOverlapQueryError) {
      return new Set(staffIds)
    }
    throw err
  }

  const busy = await resolveBusyAppointmentIntervals({
    admin: params.admin,
    tenantId: params.tenantId,
    staffById: params.staffById,
    windowStart: params.slotStart,
    windowEnd: params.slotEnd,
    rows,
    verify: params.verify,
  })

  return new Set(busy.map((row) => row.staff_id).filter(Boolean))
}