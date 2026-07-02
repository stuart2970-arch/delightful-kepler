import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

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
 * Intercepts [CHECK_AVAILABILITY: StaffID, ServiceDuration, DateRange]
 * Returns available slots for a given staff member within a date range, taking into account:
 * - Google Calendar Free/Busy times
 * - Staff working hours (Shift boundaries)
 * - Service duration & buffer padding
 * - Max 14 days in advance limit
 */
export async function checkAvailability(tenantId: string, staffId: string, serviceDuration: number, startDateStr: string, endDateStr: string) {
  try {
    console.log(`[Calendar] Checking availability for staff ${staffId}, duration ${serviceDuration}m from ${startDateStr} to ${endDateStr}`);
    
    // 1. Enforce 2-week limit
    const now = new Date();
    const twoWeeksFromNow = new Date();
    twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);

    let start = new Date(startDateStr);
    let end = new Date(endDateStr);

    if (start < now) start = now;
    if (end > twoWeeksFromNow) end = twoWeeksFromNow;
    
    if (start >= end) {
      return "Cannot check availability: Dates must be in the future and within the next 14 days.";
    }

    // 2. Fetch Staff Details (Working days, Google Calendar ID)
    const { data: staff, error: staffError } = await getSupabaseAdmin()
      .from('staff')
      .select('name, working_days, google_calendar_id')
      .eq('id', staffId)
      .eq('tenant_id', tenantId)
      .single();

    if (staffError || !staff) {
      return `Error: Staff member not found or misconfigured.`;
    }

    const calendarId = staff.google_calendar_id || 'primary';

    // 3. Query Google Calendar Free/Busy
    const calendar = await getCalendarClient(tenantId);
    
    const freeBusyRes = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        timeZone: 'UTC',
        items: [{ id: calendarId }],
      },
    });

    const busySlots = freeBusyRes.data.calendars?.[calendarId]?.busy || [];

    // 4. Calculate Available Slots
    let availableSlots: string[] = [];
    let currentDay = new Date(start);
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

    // parse weeks config
    const weeksConfig = (staff.working_days as any)?.weeks || [];

    while (currentDay <= end) {
      const currentDayStr = currentDay.toISOString().split('T')[0];
      
      // Find the appropriate week configuration for currentDay
      let activeWeekConfig = null;
      for (const week of weeksConfig) {
        const weekStart = new Date(week.weekCommencingDate);
        const weekEnd = new Date(week.weekCommencingDate);
        weekEnd.setDate(weekEnd.getDate() + 7); // Exclusive end
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

          for (const shift of shifts) {
            // Build start and end Date objects for the shift
            const shiftStart = new Date(currentDay);
            const [startH, startM] = shift.start.split(':');
            shiftStart.setHours(parseInt(startH, 10), parseInt(startM, 10), 0, 0);

            const shiftEnd = new Date(currentDay);
            const [endH, endM] = shift.end.split(':');
            shiftEnd.setHours(parseInt(endH, 10), parseInt(endM, 10), 0, 0);

            // Step through shift in 30 min increments
            let slotTime = new Date(shiftStart);
            while (slotTime < shiftEnd) {
              const slotEndTime = new Date(slotTime.getTime() + serviceDuration * 60000);
              
              if (slotEndTime <= shiftEnd && slotTime >= now) {
                // Check against busy slots from Google Calendar
                const isBusy = busySlots.some((busy: any) => {
                  const busyStart = new Date(busy.start);
                  const busyEnd = new Date(busy.end);
                  return (slotTime < busyEnd && slotEndTime > busyStart); // Overlap condition
                });

                if (!isBusy) {
                  availableSlots.push(slotTime.toISOString());
                }
              }
              // Increment by 30 mins
              slotTime = new Date(slotTime.getTime() + 30 * 60000);
            }
          }
        }
      }
      currentDay.setDate(currentDay.getDate() + 1);
      currentDay.setHours(0,0,0,0);
    }

    if (availableSlots.length === 0) {
      return `No available slots found for ${staff.name} between those dates. Please ask the user for a different date or different staff member.`;
    }

    // Return a summary of slots (limit to 10 to not overwhelm the AI)
    return `Available slots for ${staff.name}:\n` + availableSlots.slice(0, 10).map(s => `- ${new Date(s).toLocaleString()}`).join('\n');

  } catch (error: any) {
    console.error('[Calendar] Error checking availability:', error);
    return `Failed to check availability: ${error.message}`;
  }
}

/**
 * Intercepts [BOOK_MEETING: StaffID, CustomerName, CustomerEmail, StartTime, EndTime]
 * Books the meeting on Google Calendar.
 */
export async function bookMeeting(tenantId: string, staffId: string, customerName: string, customerEmail: string, startTimeStr: string, endTimeStr: string) {
  try {
    console.log(`[Calendar] Booking meeting for ${customerName} with staff ${staffId} at ${startTimeStr}`);

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

    const event = {
      summary: `Appointment with ${customerName}`,
      description: `Customer Email: ${customerEmail}\nBooked via StyleFlo AI.`,
      start: {
        dateTime: new Date(startTimeStr).toISOString(),
      },
      end: {
        dateTime: new Date(endTimeStr).toISOString(),
      },
      attendees: [
        { email: customerEmail }
      ],
    };

    const res = await calendar.events.insert({
      calendarId: calendarId,
      requestBody: event,
      sendUpdates: 'all', // Send email to attendees
    });

    return `Successfully booked appointment. Confirmation sent to ${customerEmail}.`;

  } catch (error: any) {
    console.error('[Calendar] Error booking meeting:', error);
    return `Failed to book meeting: ${error.message}`;
  }
}
