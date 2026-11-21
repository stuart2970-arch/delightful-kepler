import type { StaffCalendarTarget } from '@/lib/calendar/provider'

export function normalizeGoogleCalendarId(calendarId: string | null | undefined): string {
  const trimmed = (calendarId ?? '').trim()
  return trimmed || 'primary'
}

export function staffUsesGoogleCalendar(
  staff: StaffCalendarTarget,
  notifiedCalendarId: string,
): boolean {
  return (
    normalizeGoogleCalendarId(staff.google_calendar_id) === normalizeGoogleCalendarId(notifiedCalendarId)
  )
}