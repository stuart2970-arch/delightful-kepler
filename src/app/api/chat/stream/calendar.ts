import { createClient } from '@supabase/supabase-js';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
import {
  getBusy,
  createEvent,
  BusyInterval,
  StaffCalendarTarget,
} from '@/lib/calendar/provider';
import { queryStaffCalendars, type BusyLookup } from '@/lib/calendar/staff-busy';
import { calendarFallbackMessage } from '@/lib/calendar/fallback-message';
import {
  calculateAvailableSlots,
  getAvailableDays,
  getSlotsForDay,
  formatQuickDaysTag,
  formatQuickTimesTag,
  CalculatedSlot,
  AvailableDay,
  QualifiedStaff,
  ServiceConfig,
} from '@/lib/calendar/availability';

// Helper to lazily initialize Supabase Admin
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export type AvailabilityOutcome =
  | 'ok'
  | 'service_not_found'
  | 'no_staff'
  | 'none_connected'
  | 'unreachable'
  | 'no_slots'
  | 'invalid_window'
  | 'error';

export interface AvailabilityFixture {
  service: {
    id: string;
    name: string;
    duration_minutes?: number | null;
    buffer_minutes?: number | null;
    price?: number | null;
  } | null;
  staff: Array<{
    id: string;
    name: string;
    email?: string | null;
    working_days?: unknown;
    calendar_provider?: string | null;
    google_calendar_id?: string | null;
    microsoft_calendar_id?: string | null;
  }>;
  staffServices?: Array<{ staff_id: string; custom_duration?: number | null }> | null;
  maxWeeks?: number;
  bookingUrl?: string | null;
}

export interface AvailabilityDeps {
  now?: Date;
  timeoutMs?: number;
  lookup?: BusyLookup;
  log?: (message: string) => void;
  fixture?: AvailabilityFixture;
}

export interface AvailabilityResult {
  text: string;
  outcome: AvailabilityOutcome;
  slots: CalculatedSlot[];
  availableDays: AvailableDay[];
  quickDaysTag: string;
  quickTimesTag?: string;
  timeSlotsTag: string;
}

function unavailable(text: string, outcome: AvailabilityOutcome): AvailabilityResult {
  return {
    text,
    outcome,
    slots: [],
    availableDays: [],
    quickDaysTag: '',
    timeSlotsTag: '',
  };
}

/**
 * Checks multi-staff availability and returns both natural text for AI/voice
 * and structured quick-link tags.
 */
export async function checkAvailability(
  tenantId: string,
  staffId: string,
  serviceId: string,
  startDateStr: string,
  endDateStr: string,
  timezone: string = 'Europe/London'
): Promise<string> {
  const data = await getAvailabilityData(tenantId, staffId, serviceId, startDateStr, endDateStr, timezone);
  return data.text;
}

/**
 * Structured availability query returning calculated slots, available days, and quick-reply markers.
 */
export async function getAvailabilityData(
  tenantId: string,
  staffId: string,
  serviceId: string,
  startDateStr: string,
  endDateStr: string,
  timezone: string = 'Europe/London',
  deps?: AvailabilityDeps
): Promise<AvailabilityResult> {
  let bookingUrl: string | null = null;
  try {
    console.log(`[Calendar] Checking availability for staff ${staffId}, service ${serviceId} from ${startDateStr} to ${endDateStr} (TZ: ${timezone})`);

    // 0. Fetch Service
    let service: AvailabilityFixture['service'] = null;
    if (deps?.fixture) {
      service = deps.fixture.service;
    } else {
      const { data, error: srvError } = await getSupabaseAdmin()
        .from('services')
        .select('id, name, duration_minutes, buffer_minutes, price')
        .eq('id', serviceId)
        .single();
      if (!srvError && data) service = data;
    }

    if (!service) {
      return unavailable('Error: Service not found.', 'service_not_found');
    }

    const serviceConfig: ServiceConfig = {
      id: service.id,
      name: service.name,
      durationMinutes: service.duration_minutes || 30,
      bufferMinutes: service.buffer_minutes || 0,
      price: service.price ?? undefined,
    };

    // 1. Enforce max advance booking window limit
    let maxWeeks = 12;
    if (deps?.fixture) {
      maxWeeks = deps.fixture.maxWeeks || 12;
      bookingUrl = deps.fixture.bookingUrl ?? null;
    } else {
      const { data: tenantData } = await getSupabaseAdmin()
        .from('tenants')
        .select('max_advance_weeks, booking_url')
        .eq('id', tenantId)
        .maybeSingle();

      maxWeeks = tenantData?.max_advance_weeks || 12;
      bookingUrl = tenantData?.booking_url ?? null;
    }
    const now = deps?.now ?? new Date();
    const maxAdvanceDate = new Date(now.getTime() + maxWeeks * 7 * 24 * 60 * 60 * 1000);

    let start = new Date(startDateStr);
    let end = new Date(endDateStr);

    if (isNaN(start.getTime())) start = now;
    if (isNaN(end.getTime())) {
      end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    if (start < now) start = now;
    if (end > maxAdvanceDate) end = maxAdvanceDate;

    if (start >= end) {
      return unavailable(
        `Cannot check availability: Dates must be in the future and within the next ${maxWeeks} weeks.`,
        'invalid_window'
      );
    }

    // 2. Fetch staff members
    let allStaff: AvailabilityFixture['staff'] | null = null;
    let staffServices: Array<{ staff_id: string; custom_duration?: number | null }> | null = null;
    if (deps?.fixture) {
      allStaff = deps.fixture.staff;
      staffServices = deps.fixture.staffServices ?? null;
    } else {
      const { data, error: staffError } = await getSupabaseAdmin()
        .from('staff')
        .select('*')
        .eq('tenant_id', tenantId);

      if (staffError) {
        return unavailable('Error: No staff members found or misconfigured for this business.', 'no_staff');
      }
      allStaff = data || [];

      const { data: mapping } = await getSupabaseAdmin()
        .from('staff_services')
        .select('staff_id, custom_duration')
        .eq('service_id', serviceId);
      staffServices = mapping;
    }

    if (!allStaff || allStaff.length === 0) {
      return unavailable('Error: No staff members found or misconfigured for this business.', 'no_staff');
    }

    const qualifiedStaffIds = staffServices && staffServices.length > 0
      ? staffServices.map((ss) => ss.staff_id)
      : allStaff.map((s) => s.id);

    let targetStaffList = allStaff.filter((s) => qualifiedStaffIds.includes(s.id));
    if (targetStaffList.length === 0) {
      targetStaffList = allStaff;
    }

    const isSpecificStaffRequested = staffId && !['ANY', 'ALL', 'any', 'all'].includes(staffId);
    const requestedStaff = targetStaffList.find((s) => s.id === staffId);

    // 3. Query every staff calendar at once. A failed calendar is excluded, never treated as free.
    const staffTargets: StaffCalendarTarget[] = targetStaffList.map((staffMember) => ({
      id: staffMember.id,
      name: staffMember.name,
      email: staffMember.email ?? undefined,
      calendar_provider: staffMember.calendar_provider ?? undefined,
      google_calendar_id: staffMember.google_calendar_id ?? undefined,
      microsoft_calendar_id: staffMember.microsoft_calendar_id ?? undefined,
    }));

    const calendarQuery = await queryStaffCalendars({
      tenantId,
      staff: staffTargets,
      startUtc: start,
      endUtc: end,
      timeoutMs: deps?.timeoutMs,
      lookup: deps?.lookup ?? getBusy,
      log: deps?.log,
    });

    if (calendarQuery.succeeded.length === 0) {
      const allDisconnected = calendarQuery.failed.length > 0
        && calendarQuery.failed.every((failure) => failure.reason === 'not_connected');
      const kind = allDisconnected ? 'none_connected' : 'unreachable';
      return unavailable(calendarFallbackMessage(kind, bookingUrl), kind);
    }

    const succeededIds = new Set(calendarQuery.succeeded.map((hit) => hit.staff.id));
    const reachableStaff = targetStaffList.filter((member) => succeededIds.has(member.id));
    const busyMap = new Map<string, BusyInterval[]>();
    for (const hit of calendarQuery.succeeded) {
      busyMap.set(hit.staff.id, hit.busy);
    }

    const failedRequested = isSpecificStaffRequested
      ? calendarQuery.failed.find((failure) => failure.staff.id === staffId)
      : undefined;

    // 4. Transform qualified staff for pure calculation. Only calendars that answered are included.
    const qualifiedList: QualifiedStaff[] = reachableStaff.map((s) => {
      const mapping = staffServices?.find((ss) => ss.staff_id === s.id);
      return {
        id: s.id,
        name: s.name,
        schedule: s.working_days as QualifiedStaff['schedule'],
        customDuration: mapping?.custom_duration ?? undefined,
        calendar_provider: s.calendar_provider ?? undefined,
        google_calendar_id: s.google_calendar_id ?? undefined,
        microsoft_calendar_id: s.microsoft_calendar_id ?? undefined,
      };
    });

    // 5. Calculate available slots using pure engine
    const slots = calculateAvailableSlots({
      staffList: qualifiedList,
      busyMap,
      service: serviceConfig,
      startDateUtc: start,
      endDateUtc: end,
      maxAdvanceWeeks: maxWeeks,
      nowUtc: now,
      timeZone: timezone,
    });

    if (slots.length === 0) {
      return unavailable(
        `No available slots found for "${service.name}" between ${start.toLocaleDateString('en-GB')} and ${end.toLocaleDateString('en-GB')}.`,
        'no_slots'
      );
    }

    const availableDays = getAvailableDays(slots);
    const quickDaysTag = formatQuickDaysTag(serviceId, staffId || 'ANY', availableDays);

    // Build time slots JSON for legacy [TIME_SLOTS] support
    const timeSlotsMap: Record<string, string[]> = {};
    for (const s of slots) {
      if (!timeSlotsMap[s.date]) timeSlotsMap[s.date] = [];
      if (!timeSlotsMap[s.date].includes(s.time)) {
        timeSlotsMap[s.date].push(s.time);
      }
    }
    const timeSlotsTag = `[TIME_SLOTS: ${JSON.stringify(timeSlotsMap)}]`;

    // If slots span only 1 day, also prepare quick times tag
    let quickTimesTag: string | undefined;
    if (availableDays.length === 1) {
      const daySlots = getSlotsForDay(slots, availableDays[0].date);
      quickTimesTag = formatQuickTimesTag(availableDays[0].date, serviceId, daySlots);
    }

    // 6. Build text breakdown for AI/voice
    const outputLines: string[] = [];
    if (failedRequested) {
      const missedName = failedRequested.staff.name || 'that colleague';
      outputLines.push(`I couldn't check ${missedName}'s calendar, so none of their times are offered.`);
    }
    outputLines.push(`Availability Breakdown for "${service.name}":\n`);

    if (isSpecificStaffRequested && requestedStaff) {
      const requestedSlots = slots.filter((s) => s.staffId === requestedStaff.id);
      if (requestedSlots.length > 0) {
        outputLines.push(`Requested Staff Member: ${requestedStaff.name} (ID: ${requestedStaff.id}):`);
        outputLines.push(
          requestedSlots.slice(0, 10).map((s) => `- ${s.displayDate} at ${s.time}`).join('\n')
        );
      } else if (failedRequested) {
        outputLines.push(`Requested Staff Member: ${requestedStaff.name} (ID: ${requestedStaff.id}) could not be checked, so their times are not offered.`);
      } else {
        outputLines.push(`Requested Staff Member: ${requestedStaff.name} (ID: ${requestedStaff.id}) has NO available slots in this timeframe.`);
      }

      const altSlots = slots.filter((s) => s.staffId !== requestedStaff.id);
      if (altSlots.length > 0) {
        outputLines.push(`\nALTERNATIVE QUALIFIED STAFF MEMBERS AVAILABLE FOR THIS SERVICE:`);
        const groupedAlt = new Map<string, CalculatedSlot[]>();
        for (const s of altSlots) {
          if (!groupedAlt.has(s.staffName)) groupedAlt.set(s.staffName, []);
          groupedAlt.get(s.staffName)!.push(s);
        }
        for (const [staffName, sList] of groupedAlt.entries()) {
          outputLines.push(`- ${staffName}:`);
          outputLines.push(sList.slice(0, 10).map((s) => `  * ${s.displayDate} at ${s.time}`).join('\n'));
        }
      }
    } else {
      outputLines.push(`Available Days and Times:`);
      for (const day of availableDays) {
        const dSlots = getSlotsForDay(slots, day.date);
        outputLines.push(`- ${day.displayDate}: ${dSlots.slice(0, 8).map((s) => s.time).join(', ')}`);
      }
    }

    // Append structured tags
    outputLines.push(`\n${quickDaysTag}`);
    if (quickTimesTag) {
      outputLines.push(quickTimesTag);
    }
    outputLines.push(timeSlotsTag);

    return {
      text: outputLines.join('\n'),
      outcome: 'ok',
      slots,
      availableDays,
      quickDaysTag,
      quickTimesTag,
      timeSlotsTag,
    };
  } catch (error: any) {
    console.error('[Calendar] Error checking availability:', error);
    return unavailable(calendarFallbackMessage('unreachable', bookingUrl), 'unreachable');
  }
}

/**
 * Books an appointment in Google or Microsoft Calendar and records it in `appointments`.
 * Idempotent per session + slot to prevent double-booking.
 */
export async function bookMeeting(
  tenantId: string,
  staffId: string,
  serviceId: string,
  customerName: string,
  customerEmail: string,
  customerPhone: string,
  startTimeStr: string,
  endTimeStr: string,
  timezone: string = 'Europe/London'
): Promise<string> {
  try {
    console.log(`[Calendar] Booking meeting for ${customerName} with staff ${staffId} for service ${serviceId} at ${startTimeStr} (TZ: ${timezone})`);

    const startUtc = new Date(startTimeStr);
    let endUtc = new Date(endTimeStr);

    if (isNaN(startUtc.getTime())) {
      return 'Error: Invalid appointment start time.';
    }

    // Fetch Staff Details
    const { data: staff, error: staffError } = await getSupabaseAdmin()
      .from('staff')
      .select('*')
      .eq('id', staffId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (staffError || !staff) {
      return 'Error: Staff member not found.';
    }

    // Fetch Service details
    const { data: service } = await getSupabaseAdmin()
      .from('services')
      .select('name, duration_minutes')
      .eq('id', serviceId)
      .maybeSingle();

    const serviceName = service ? service.name : 'Appointment';
    const durationMins = service?.duration_minutes || 30;

    if (isNaN(endUtc.getTime()) || endUtc <= startUtc) {
      endUtc = new Date(startUtc.getTime() + durationMins * 60 * 1000);
    }

    // 1. Idempotency Check: if this customer already has an appointment booked for this exact slot
    const { data: existingAppt } = await getSupabaseAdmin()
      .from('appointments')
      .select('id, google_event_id, start_time')
      .eq('tenant_id', tenantId)
      .eq('staff_id', staffId)
      .eq('customer_email', customerEmail.trim().toLowerCase())
      .gte('start_time', new Date(startUtc.getTime() - 1000).toISOString())
      .lte('start_time', new Date(startUtc.getTime() + 1000).toISOString())
      .maybeSingle();

    if (existingAppt) {
      console.log(`[Calendar] Idempotent booking hit for appointment ${existingAppt.id}`);
      return `Successfully booked appointment. Confirmation sent to ${customerEmail}.`;
    }

    // 2. Re-check Free/Busy status right before booking to prevent race conditions
    // Check internal appointments table (excluding any booking by the same customer)
    const { data: overlappingAppt } = await getSupabaseAdmin()
      .from('appointments')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('staff_id', staffId)
      .neq('customer_email', customerEmail.trim().toLowerCase())
      .lt('start_time', endUtc.toISOString())
      .gt('end_time', startUtc.toISOString())
      .maybeSingle();

    if (overlappingAppt) {
      console.warn(`[Calendar] Race condition: slot ${startTimeStr} was taken in appointments table before booking confirmation.`);
      return `Error: That time slot is no longer available. Please choose another time.`;
    }

    const staffTarget: StaffCalendarTarget = {
      id: staff.id,
      name: staff.name,
      email: staff.email,
      calendar_provider: staff.calendar_provider,
      google_calendar_id: staff.google_calendar_id,
      microsoft_calendar_id: staff.microsoft_calendar_id,
    };

    try {
      const busyIntervals = await getBusy(tenantId, staffTarget, startUtc, endUtc);
      const isTaken = busyIntervals.some(
        (busy) => startUtc < busy.end && endUtc > busy.start
      );

      if (isTaken) {
        console.warn(`[Calendar] Race condition: slot ${startTimeStr} was taken before booking confirmation.`);
        return `Error: That time slot is no longer available. Please choose another time.`;
      }
    } catch (busyErr: any) {
      console.warn(`[Calendar] Free/busy verification warning:`, busyErr?.message);
    }

    // 3. Create event in connected Google or Microsoft Calendar
    const eventResult = await createEvent(tenantId, staffTarget, {
      tenantId,
      summary: `[StyleFlo] ${serviceName} - ${customerName}`,
      description: `Customer Name: ${customerName}\nEmail: ${customerEmail}\nPhone: ${customerPhone}\nService: ${serviceName}\nStaff: ${staff.name}\n\nBooked via StyleFlo AI`,
      startTime: startUtc.toISOString(),
      endTime: endUtc.toISOString(),
      attendeeEmail: customerEmail,
      attendeeName: customerName,
      attendeePhone: customerPhone,
      calendarId: staff.google_calendar_id || staff.microsoft_calendar_id,
    });

    // 4. Record appointment in DB (gracefully handling optional columns)
    const appointmentRow: Record<string, any> = {
      tenant_id: tenantId,
      staff_id: staffId,
      service_id: serviceId,
      customer_name: customerName,
      customer_email: customerEmail.trim().toLowerCase(),
      customer_phone: customerPhone,
      start_time: startUtc.toISOString(),
      end_time: endUtc.toISOString(),
      google_event_id: eventResult.id,
    };

    if (eventResult.provider === 'microsoft') {
      appointmentRow.microsoft_event_id = eventResult.id;
    }

    let insertRes = await getSupabaseAdmin().from('appointments').insert(appointmentRow);
    if (insertRes.error && insertRes.error.message?.includes('microsoft_event_id')) {
      delete appointmentRow.microsoft_event_id;
      insertRes = await getSupabaseAdmin().from('appointments').insert(appointmentRow);
    }

    if (insertRes.error) {
      console.error('[Calendar] Failed to insert appointment record:', insertRes.error);
    }

    // 5. Send Mailgun confirmation email if credentials exist
    try {
      if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
        const mailgun = new Mailgun(formData);
        const mg = mailgun.client({
          username: 'api',
          key: process.env.MAILGUN_API_KEY,
          url: 'https://api.eu.mailgun.net',
        });

        const formattedStart = startUtc.toLocaleString('en-GB', { timeZone: timezone });
        await mg.messages.create(process.env.MAILGUN_DOMAIN, {
          from: `StyleFlo Bookings <no-reply@${process.env.MAILGUN_DOMAIN}>`,
          to: [customerEmail],
          subject: `Booking Confirmed: ${serviceName} with ${staff.name}`,
          text: `Hi ${customerName},\n\nYour appointment for ${serviceName} with ${staff.name} is confirmed for ${formattedStart}.\n\nThank you for booking with us!`,
        });
        console.log(`[Calendar] Sent Mailgun confirmation to ${customerEmail}`);
      }
    } catch (mgErr: any) {
      console.warn('[Calendar] Exception sending Mailgun email:', mgErr?.message);
    }

    return `Successfully booked appointment. Confirmation sent to ${customerEmail}.`;
  } catch (error: any) {
    console.error('[Calendar] Error booking meeting:', error);
    return `Failed to book meeting: ${error.message}`;
  }
}

/**
 * Looks up future appointments for a customer.
 */
export async function lookupAppointments(
  tenantId: string,
  customerEmail: string,
  customerPhone: string,
  timezone: string = 'Europe/London'
) {
  try {
    console.log(`[Calendar] Looking up appointments for ${customerEmail} / ${customerPhone}`);

    const now = new Date().toISOString();
    const { data: appointments, error } = await getSupabaseAdmin()
      .from('appointments')
      .select('*, staff(name, google_calendar_id), services(name)')
      .eq('tenant_id', tenantId)
      .ilike('customer_email', customerEmail.trim())
      .gte('start_time', now)
      .order('start_time', { ascending: true });

    if (error) throw error;

    if (!appointments || appointments.length === 0) {
      return 'No upcoming appointments found for this email address.';
    }

    const validAppointments: string[] = [];
    for (const appt of appointments) {
      const displayTime = new Date(appt.start_time).toLocaleString('en-GB', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'short',
      });
      validAppointments.push(`- ${appt.services?.name || 'Appointment'} with ${appt.staff?.name || 'Colleague'} on ${displayTime}`);
    }

    return `Found ${validAppointments.length} upcoming appointment(s):\n` + validAppointments.join('\n');
  } catch (error: any) {
    console.error('[Calendar] Error looking up appointments:', error);
    return `Error: Failed to look up appointments.`;
  }
}
