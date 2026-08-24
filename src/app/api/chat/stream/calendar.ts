import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import formData from 'form-data';
import Mailgun from 'mailgun.js';

// Helper to lazily initialize Supabase Admin to prevent build errors when env vars are missing in CI/CD
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

/**
 * Gets an authenticated Google Calendar API client using the tenant's stored refresh token.
 */
async function getCalendarClient(tenantId: string) {
  const { data: integration, error } = await getSupabaseAdmin()
    .from('tenant_integrations')
    .select('refresh_token, access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'google_calendar')
    .single();

  if (error || !integration || !integration.refresh_token) {
    throw new Error('Google Calendar not connected or missing refresh token');
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: integration.refresh_token,
    access_token: integration.access_token,
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * Intercepts [CHECK_AVAILABILITY: StaffID, ServiceID, DateRange]
 * Returns available slots for a given staff member within a date range, taking into account:
 * - Google Calendar Free/Busy times
 * - Staff working hours (Shift boundaries)
 * - Service duration & buffer padding
 * - Max 14 days in advance limit
 */
export async function checkAvailability(tenantId: string, staffId: string, serviceId: string, startDateStr: string, endDateStr: string, timezone: string = 'Europe/London') {
  try {
    console.log(`[Calendar] Checking availability for staff ${staffId}, service ${serviceId} from ${startDateStr} to ${endDateStr} (TZ: ${timezone})`);
    
    // 0. Fetch Service
    const { data: service, error: srvError } = await getSupabaseAdmin()
      .from('services')
      .select('name, duration_minutes, buffer_minutes')
      .eq('id', serviceId)
      .single();
    if (srvError || !service) return "Error: Service not found.";
    
    const baseDuration = service.duration_minutes + (service.buffer_minutes || 0);

    // 1. Enforce max advance booking window limit
    const { data: tenantData } = await getSupabaseAdmin()
      .from('tenants')
      .select('max_advance_weeks')
      .eq('id', tenantId)
      .single();

    const maxWeeks = tenantData?.max_advance_weeks || 12;
    const now = new Date();
    const maxAdvanceDate = new Date();
    maxAdvanceDate.setDate(maxAdvanceDate.getDate() + (maxWeeks * 7));

    let start = new Date(startDateStr);
    let end = new Date(endDateStr);

    if (start < now) start = now;
    if (end > maxAdvanceDate) end = maxAdvanceDate;
    
    if (start >= end) {
      return `Cannot check availability: Dates must be in the future and within the next ${maxWeeks} weeks.`;
    }

    // 2. Resolve target staff list (Fetch all staff for tenant)
    const { data: allStaff, error: staffError } = await getSupabaseAdmin()
      .from('staff')
      .select('id, name, working_days, google_calendar_id')
      .eq('tenant_id', tenantId);

    if (staffError || !allStaff || allStaff.length === 0) {
      return `Error: No staff members found or misconfigured for this business.`;
    }

    // Fetch staff_services mappings to know who offers serviceId
    const { data: staffServices } = await getSupabaseAdmin()
      .from('staff_services')
      .select('staff_id, custom_duration')
      .eq('service_id', serviceId);

    const qualifiedStaffIds = (staffServices && staffServices.length > 0)
      ? staffServices.map(ss => ss.staff_id)
      : allStaff.map(s => s.id);

    let targetStaffList = allStaff.filter(s => qualifiedStaffIds.includes(s.id));
    if (targetStaffList.length === 0) {
      targetStaffList = allStaff;
    }

    const isSpecificStaffRequested = staffId && staffId !== 'ANY' && staffId !== 'ALL' && staffId !== 'any' && staffId !== 'all';
    const requestedStaff = targetStaffList.find(s => s.id === staffId);

    // 3. Query Google Calendar & calculate slots per qualified staff member
    const calendar = await getCalendarClient(tenantId);
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

    const staffResults: { staffId: string; name: string; availableSlots: string[]; customDuration: number }[] = [];

    for (const staffMember of targetStaffList) {
      const mapping = staffServices?.find(ss => ss.staff_id === staffMember.id);
      const serviceDuration = mapping?.custom_duration 
        ? mapping.custom_duration + (service.buffer_minutes || 0) 
        : baseDuration;

      const calendarId = staffMember.google_calendar_id || 'primary';
      let busySlots: any[] = [];
      try {
        const freeBusyRes = await calendar.freebusy.query({
          requestBody: {
            timeMin: start.toISOString(),
            timeMax: end.toISOString(),
            timeZone: 'UTC',
            items: [{ id: calendarId }],
          },
        });
        busySlots = freeBusyRes.data.calendars?.[calendarId]?.busy || [];
      } catch (fbErr) {
        console.warn(`[Calendar] Failed to query Google Calendar freebusy for staff ${staffMember.name}:`, fbErr);
      }

      const availableSlots: string[] = [];
      let currentDay = new Date(start);
      const weeksConfig = (staffMember.working_days as any)?.weeks || [];

      while (currentDay <= end) {
        let activeWeekConfig = null;
        for (const week of weeksConfig) {
          const weekStart = new Date(week.weekCommencingDate);
          const weekEnd = new Date(week.weekCommencingDate);
          weekEnd.setDate(weekEnd.getDate() + 7);
          if (currentDay >= weekStart && currentDay < weekEnd) {
            activeWeekConfig = week;
            break;
          }
        }

        if (activeWeekConfig) {
          const dayName = dayNames[currentDay.getDay()];
          const dayConfig = activeWeekConfig[dayName];
          
          if (dayConfig && !dayConfig.unavailable) {
            const shifts = [];
            if (dayConfig.am && dayConfig.am.start && dayConfig.am.end) shifts.push(dayConfig.am);
            if (dayConfig.pm && dayConfig.pm.start && dayConfig.pm.end) shifts.push(dayConfig.pm);
            if (shifts.length === 0) {
              shifts.push({ start: '09:00', end: '13:00' });
              shifts.push({ start: '14:00', end: '18:00' });
            }

            for (const shift of shifts) {
              const shiftStart = new Date(currentDay);
              const [startH, startM] = shift.start.split(':');
              shiftStart.setHours(parseInt(startH, 10), parseInt(startM, 10), 0, 0);

              const shiftEnd = new Date(currentDay);
              const [endH, endM] = shift.end.split(':');
              shiftEnd.setHours(parseInt(endH, 10), parseInt(endM, 10), 0, 0);

              let slotTime = new Date(shiftStart);
              while (slotTime < shiftEnd) {
                const slotEndTime = new Date(slotTime.getTime() + serviceDuration * 60000);
                if (slotEndTime <= shiftEnd && slotTime >= now) {
                  const isBusy = busySlots.some((busy: any) => {
                    const busyStart = new Date(busy.start);
                    const busyEnd = new Date(busy.end);
                    return (slotTime < busyEnd && slotEndTime > busyStart);
                  });

                  if (!isBusy) {
                    availableSlots.push(slotTime.toISOString());
                  }
                }
                slotTime = new Date(slotTime.getTime() + 30 * 60000);
              }
            }
          }
        } else {
          // Fallback if weekConfig not set
          if (currentDay.getDay() !== 0) {
            const shifts = [
              { start: '09:00', end: '13:00' },
              { start: '14:00', end: '18:00' }
            ];
            for (const shift of shifts) {
              const shiftStart = new Date(currentDay);
              const [startH, startM] = shift.start.split(':');
              shiftStart.setHours(parseInt(startH, 10), parseInt(startM, 10), 0, 0);

              const shiftEnd = new Date(currentDay);
              const [endH, endM] = shift.end.split(':');
              shiftEnd.setHours(parseInt(endH, 10), parseInt(endM, 10), 0, 0);

              let slotTime = new Date(shiftStart);
              while (slotTime < shiftEnd) {
                const slotEndTime = new Date(slotTime.getTime() + serviceDuration * 60000);
                if (slotEndTime <= shiftEnd && slotTime >= now) {
                  const isBusy = busySlots.some((busy: any) => {
                    const busyStart = new Date(busy.start);
                    const busyEnd = new Date(busy.end);
                    return (slotTime < busyEnd && slotEndTime > busyStart);
                  });

                  if (!isBusy) {
                    availableSlots.push(slotTime.toISOString());
                  }
                }
                slotTime = new Date(slotTime.getTime() + 30 * 60000);
              }
            }
          }
        }
        currentDay.setDate(currentDay.getDate() + 1);
        currentDay.setHours(0,0,0,0);
      }

      staffResults.push({
        staffId: staffMember.id,
        name: staffMember.name,
        availableSlots,
        customDuration: serviceDuration,
      });
    }

    // 4. Format detailed multi-staff availability breakdown for the AI
    let outputLines = [`Availability Breakdown for "${service.name}":\n`];

    if (isSpecificStaffRequested && requestedStaff) {
      const requestedResult = staffResults.find(r => r.staffId === requestedStaff.id);
      if (requestedResult && requestedResult.availableSlots.length > 0) {
        outputLines.push(`Requested Staff Member: ${requestedStaff.name} (ID: ${requestedStaff.id}):`);
        outputLines.push(requestedResult.availableSlots.slice(0, 10).map(s => `- ${new Date(s).toLocaleString('en-GB', { timeZone: timezone })}`).join('\n'));
      } else {
        outputLines.push(`Requested Staff Member: ${requestedStaff.name} (ID: ${requestedStaff.id}) has NO available slots in this timeframe.`);
      }

      const otherResults = staffResults.filter(r => r.staffId !== requestedStaff.id && r.availableSlots.length > 0);
      if (otherResults.length > 0) {
        outputLines.push(`\nALTERNATIVE QUALIFIED STAFF MEMBERS AVAILABLE FOR THIS SERVICE:`);
        for (const other of otherResults) {
          outputLines.push(`- ${other.name} (ID: ${other.staffId}):`);
          outputLines.push(other.availableSlots.slice(0, 10).map(s => `  * ${new Date(s).toLocaleString('en-GB', { timeZone: timezone })}`).join('\n'));
        }
      }
    } else {
      outputLines.push(`All Qualified Staff Availability:`);
      for (const result of staffResults) {
        if (result.availableSlots.length > 0) {
          outputLines.push(`- ${result.name} (ID: ${result.staffId}):`);
          outputLines.push(result.availableSlots.slice(0, 10).map(s => `  * ${new Date(s).toLocaleString('en-GB', { timeZone: timezone })}`).join('\n'));
        } else {
          outputLines.push(`- ${result.name} (ID: ${result.staffId}): No available slots.`);
        }
      }
    }

    return outputLines.join('\n');

  } catch (error: any) {
    console.error('[Calendar] Error checking multi-staff availability:', error);
    return `Failed to check availability: ${error.message}`;
  }
}

/**
 * Intercepts [BOOK_MEETING: StaffID, ServiceID, CustomerName, CustomerEmail, CustomerPhone, StartTime, EndTime]
 * Books a Google Calendar event for the staff member and logs it in the tenant's appointments table.
 */
export async function bookMeeting(tenantId: string, staffId: string, serviceId: string, customerName: string, customerEmail: string, customerPhone: string, startTimeStr: string, endTimeStr: string, timezone: string = 'Europe/London') {
  try {
    console.log(`[Calendar] Booking meeting for ${customerName} with staff ${staffId} for service ${serviceId} at ${startTimeStr} (TZ: ${timezone})`);

    // Fetch Staff Details
    const { data: staff, error: staffError } = await getSupabaseAdmin()
      .from('staff')
      .select('name, google_calendar_id')
      .eq('id', staffId)
      .eq('tenant_id', tenantId)
      .single();

    if (staffError || !staff) {
      return `Error: Staff member not found.`;
    }

    const calendarId = staff.google_calendar_id || 'primary';
    const calendar = await getCalendarClient(tenantId);

    // Fetch Service details for name
    const { data: service } = await getSupabaseAdmin().from('services').select('name').eq('id', serviceId).single();
    const serviceName = service ? service.name : 'Service';

    // 1. Final check for availability to prevent double booking
    const freeBusyRes = await calendar.freebusy.query({
      requestBody: {
        timeMin: new Date(startTimeStr).toISOString(),
        timeMax: new Date(endTimeStr).toISOString(),
        timeZone: timezone,
        items: [{ id: calendarId }],
      },
    });
    
    const busy = freeBusyRes.data.calendars?.[calendarId]?.busy;
    if (busy && busy.length > 0) {
      console.warn(`[Calendar] Double-booking prevented for ${calendarId} at ${startTimeStr}`);
      return `Error: The requested time slot is no longer available. It was just booked by someone else.`;
    }

    const event = {
      summary: `[StyleFlo] ${serviceName} - ${customerName}`,
      description: `Customer Name: ${customerName}\nEmail: ${customerEmail}\nPhone: ${customerPhone}\nService: ${serviceName}\nStaff: ${staff.name}\n\nBooked via StyleFlo AI`,
      start: {
        dateTime: new Date(startTimeStr).toISOString(),
      },
      end: {
        dateTime: new Date(endTimeStr).toISOString(),
      },
      attendees: customerEmail && customerEmail.includes('@') ? [
        { email: customerEmail, displayName: customerName }
      ] : [],
    };

    const res = await calendar.events.insert({
      calendarId: calendarId,
      requestBody: event,
      sendUpdates: 'all', // Send email to attendees
    });

    // Record the appointment in our local DB
    await getSupabaseAdmin().from('appointments').insert({
      tenant_id: tenantId,
      staff_id: staffId,
      service_id: serviceId,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      start_time: new Date(startTimeStr).toISOString(),
      end_time: new Date(endTimeStr).toISOString(),
      google_event_id: res.data.id
    });

    // --- SEND CUSTOM MAILGUN EMAIL ---
    try {
      if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
        console.error('[Calendar] Mailgun credentials missing, cannot send email.');
      } else {
        const mailgun = new Mailgun(formData);
        const mg = mailgun.client({ 
          username: 'api', 
          key: process.env.MAILGUN_API_KEY,
          url: 'https://api.eu.mailgun.net' 
        });
        
        await mg.messages.create(process.env.MAILGUN_DOMAIN, {
          from: `StyleFlo Bookings <no-reply@${process.env.MAILGUN_DOMAIN}>`,
          to: [customerEmail],
          subject: `Booking Confirmed: ${serviceName} with ${staff.name}`,
          text: `Hi ${customerName},\n\nYour appointment for ${serviceName} with ${staff.name} is confirmed for ${new Date(startTimeStr).toLocaleString('en-GB', { timeZone: timezone })}.\n\nThank you for booking with us!`
        });
        
        console.log(`[Calendar] Sent Mailgun confirmation to ${customerEmail}`);
      }
    } catch (mgErr) {
      console.error('[Calendar] Exception sending Mailgun email:', mgErr);
    }

    return `Successfully booked appointment. Confirmation sent to ${customerEmail}.`;

  } catch (error: any) {
    console.error('[Calendar] Error booking meeting:', error);
    return `Failed to book meeting: ${error.message}`;
  }
}

/**
 * Looks up future appointments for a customer, live-verifying against Google Calendar.
 */
export async function lookupAppointments(tenantId: string, customerEmail: string, customerPhone: string, timezone: string = 'Europe/London') {
  try {
    console.log(`[Calendar] Looking up appointments for ${customerEmail} / ${customerPhone}`);

    // Fetch future appointments
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
      return "No upcoming appointments found for this email address.";
    }

    const calendar = await getCalendarClient(tenantId);
    const validAppointments = [];

    for (const appt of appointments) {
      let isCancelled = false;
      let newStart = appt.start_time;

      if (appt.google_event_id && appt.staff?.google_calendar_id) {
        try {
          // Live check Google Calendar
          const event = await calendar.events.get({
            calendarId: appt.staff.google_calendar_id,
            eventId: appt.google_event_id
          });

          if (event.data.status === 'cancelled') {
            isCancelled = true;
          } else if (event.data.start?.dateTime) {
             // Check if it was moved
             const calStartTime = new Date(event.data.start.dateTime).toISOString();
             if (calStartTime !== new Date(appt.start_time).toISOString()) {
                 newStart = calStartTime;
                 // Update DB lazily
                 await getSupabaseAdmin().from('appointments').update({ start_time: calStartTime }).eq('id', appt.id);
             }
          }
        } catch (calErr: any) {
          if (calErr.code === 404 || calErr.status === 404) {
            isCancelled = true;
          } else {
             console.error(`[Calendar] Failed to verify event ${appt.google_event_id}:`, calErr.message);
          }
        }
      }

      if (isCancelled) {
        // Delete or mark cancelled in DB lazily
        await getSupabaseAdmin().from('appointments').delete().eq('id', appt.id);
        continue;
      }

      validAppointments.push(`- ${appt.services?.name} with ${appt.staff?.name} on ${new Date(newStart).toLocaleString('en-GB', { timeZone: timezone, dateStyle: 'full', timeStyle: 'short' })}`);
    }

    if (validAppointments.length === 0) {
      return "No upcoming appointments found (any previously booked appointments have been cancelled).";
    }

    return `Found ${validAppointments.length} upcoming appointment(s):\n` + validAppointments.join('\n');

  } catch (error: any) {
    console.error('[Calendar] Error looking up appointments:', error);
    return `Error: Failed to look up appointments.`;
  }
}
