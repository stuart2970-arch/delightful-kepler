import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  createEvent,
  deleteCalendarEvent,
  getBusy,
  type StaffCalendarTarget,
} from '@/lib/calendar/provider';
import {
  fetchOverlappingAppointments,
  resolveBusyAppointmentIntervals,
} from '@/lib/booking/appointment-calendar-sync';
import {
  APPOINTMENT_STATUS_BOOKED,
  APPOINTMENT_STATUS_CANCELLED,
} from '@/lib/booking/appointment-status';
import { sendBusinessBookingCancelledEmail } from '@/lib/booking/notify-business-booking-change';

function getSupabaseAdmin(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const INVALID_MANAGE_TOKEN_MESSAGE =
  'This manage link is invalid or has expired. Please contact the small business directly.';

export async function loadManageBooking(appointmentId: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('appointments')
    .select(
      'id, tenant_id, staff_id, service_id, customer_name, customer_email, start_time, end_time, status, google_event_id, microsoft_event_id, staff(name, email, calendar_provider, google_calendar_id, microsoft_calendar_id), services(name, duration_minutes), tenants(company_name)',
    )
    .eq('id', appointmentId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

export async function cancelBookingViaManage(appointmentId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const appt = await loadManageBooking(appointmentId);
  if (!appt || appt.status === APPOINTMENT_STATUS_CANCELLED) {
    return { ok: false, message: INVALID_MANAGE_TOKEN_MESSAGE };
  }

  const admin = getSupabaseAdmin();
  const staffRow = Array.isArray(appt.staff) ? appt.staff[0] : appt.staff;
  const serviceRow = Array.isArray(appt.services) ? appt.services[0] : appt.services;
  const tenantRow = Array.isArray(appt.tenants) ? appt.tenants[0] : appt.tenants;
  const timezone = 'Europe/London';

  const staffTarget: StaffCalendarTarget = {
    id: appt.staff_id as string,
    name: staffRow?.name,
    email: staffRow?.email,
    calendar_provider: staffRow?.calendar_provider,
    google_calendar_id: staffRow?.google_calendar_id,
    microsoft_calendar_id: staffRow?.microsoft_calendar_id,
  };

  const eventId = (appt.microsoft_event_id as string | null) || (appt.google_event_id as string | null);
  if (eventId) {
    await deleteCalendarEvent({
      tenantId: appt.tenant_id as string,
      staff: staffTarget,
      eventId,
    });
  }

  const { error: updateError } = await admin
    .from('appointments')
    .update({ status: APPOINTMENT_STATUS_CANCELLED })
    .eq('id', appointmentId)
    .eq('status', APPOINTMENT_STATUS_BOOKED);

  if (updateError) {
    return { ok: false, message: 'We could not cancel this booking. Please try again or contact the small business.' };
  }

  const formattedStart = new Date(appt.start_time as string).toLocaleString('en-GB', { timeZone: timezone });
  try {
    await sendBusinessBookingCancelledEmail({
      tenantId: appt.tenant_id as string,
      customerName: appt.customer_name as string,
      customerEmail: appt.customer_email as string,
      serviceName: serviceRow?.name || 'Appointment',
      staffName: staffRow?.name || 'Colleague',
      formattedStart,
    });
  } catch (emailErr: unknown) {
    const message = emailErr instanceof Error ? emailErr.message : String(emailErr);
    console.warn('[PublicManage] Business cancel email failed:', message);
  }

  return { ok: true };
}

export async function rescheduleBookingViaManage(
  appointmentId: string,
  startTimeStr: string,
  endTimeStr: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const appt = await loadManageBooking(appointmentId);
  if (!appt || appt.status !== APPOINTMENT_STATUS_BOOKED) {
    return { ok: false, message: INVALID_MANAGE_TOKEN_MESSAGE };
  }

  const startUtc = new Date(startTimeStr);
  const endUtc = new Date(endTimeStr);
  if (Number.isNaN(startUtc.getTime()) || Number.isNaN(endUtc.getTime()) || endUtc <= startUtc) {
    return { ok: false, message: 'Please choose a valid time slot.' };
  }

  const admin = getSupabaseAdmin();
  const tenantId = appt.tenant_id as string;
  const staffId = appt.staff_id as string;
  const staffRow = Array.isArray(appt.staff) ? appt.staff[0] : appt.staff;
  const serviceRow = Array.isArray(appt.services) ? appt.services[0] : appt.services;

  const staffTarget: StaffCalendarTarget = {
    id: staffId,
    name: staffRow?.name,
    email: staffRow?.email,
    calendar_provider: staffRow?.calendar_provider,
    google_calendar_id: staffRow?.google_calendar_id,
    microsoft_calendar_id: staffRow?.microsoft_calendar_id,
  };

  const overlappingRows = await fetchOverlappingAppointments(
    admin,
    tenantId,
    startUtc,
    endUtc,
    [staffId],
  );
  const others = overlappingRows.filter((row) => row.id !== appointmentId);
  const staffById = new Map<string, StaffCalendarTarget>([[staffId, staffTarget]]);
  const blocking = await resolveBusyAppointmentIntervals({
    admin,
    tenantId,
    staffById,
    windowStart: startUtc,
    windowEnd: endUtc,
    rows: others,
  });

  if (blocking.length > 0) {
    return { ok: false, message: 'That time is no longer available. Please choose another slot.' };
  }

  try {
    const busyIntervals = await getBusy(tenantId, staffTarget, startUtc, endUtc);
    const isTaken = busyIntervals.some((busy) => startUtc < busy.end && endUtc > busy.start);
    if (isTaken) {
      return { ok: false, message: 'That time is no longer available. Please choose another slot.' };
    }
  } catch (busyErr: unknown) {
    const message = busyErr instanceof Error ? busyErr.message : String(busyErr);
    console.warn('[PublicManage] Free/busy check failed (fail closed):', message);
    return { ok: false, message: 'We could not verify availability. Please try again later.' };
  }

  const oldEventId = (appt.microsoft_event_id as string | null) || (appt.google_event_id as string | null);
  if (oldEventId) {
    await deleteCalendarEvent({ tenantId, staff: staffTarget, eventId: oldEventId });
  }

  let newEventId: string | null = null;
  let provider: 'google' | 'microsoft' | undefined;
  try {
    const eventResult = await createEvent(tenantId, staffTarget, {
      tenantId,
      summary: `[StyleFlo] ${serviceRow?.name || 'Appointment'} - ${appt.customer_name}`,
      description: `Rescheduled via customer manage link.\nCustomer: ${appt.customer_name}\nEmail: ${appt.customer_email}`,
      startTime: startUtc.toISOString(),
      endTime: endUtc.toISOString(),
      attendeeEmail: appt.customer_email as string,
      calendarId: staffRow?.google_calendar_id || staffRow?.microsoft_calendar_id,
    });
    newEventId = eventResult.id;
    provider = eventResult.provider;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[PublicManage] Calendar recreate failed:', message);
  }

  const updates: Record<string, unknown> = {
    start_time: startUtc.toISOString(),
    end_time: endUtc.toISOString(),
    google_event_id: provider === 'microsoft' ? appt.google_event_id : newEventId,
  };
  if (provider === 'microsoft' && newEventId) {
    updates.microsoft_event_id = newEventId;
  }

  const { error } = await admin.from('appointments').update(updates).eq('id', appointmentId);
  if (error) {
    return { ok: false, message: 'We could not reschedule this booking. Please contact the small business.' };
  }

  return { ok: true };
}