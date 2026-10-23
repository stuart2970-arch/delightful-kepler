import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { getMicrosoftAccessToken, createMicrosoftCalendarEvent } from '@/lib/microsoft-calendar';

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

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface CalendarEventPayload {
  tenantId: string;
  summary: string;
  description?: string;
  startTime: string; // ISO 8601 string
  endTime: string;   // ISO 8601 string
  attendeeEmail?: string;
  attendeeName?: string;
  attendeePhone?: string;
  calendarId?: string;
}

export interface CalendarEventResult {
  id: string;
  provider: 'google' | 'microsoft';
  webLink?: string;
}

export interface StaffCalendarTarget {
  id: string;
  name?: string;
  email?: string;
  calendar_provider?: 'google' | 'microsoft' | string;
  google_calendar_id?: string;
  microsoft_calendar_id?: string;
}

/**
 * Determines whether a staff member or tenant uses Google or Microsoft calendar.
 */
export async function resolveCalendarProvider(
  tenantId: string,
  staff?: StaffCalendarTarget
): Promise<'google' | 'microsoft' | null> {
  // If explicitly designated on staff
  if (staff?.calendar_provider === 'microsoft') return 'microsoft';
  if (staff?.calendar_provider === 'google') return 'google';
  if (staff?.microsoft_calendar_id && !staff?.google_calendar_id) return 'microsoft';
  if (staff?.google_calendar_id && !staff?.microsoft_calendar_id) return 'google';

  // Fallback to active tenant integrations
  const { data: integrations } = await getSupabaseAdmin()
    .from('tenant_integrations')
    .select('provider, refresh_token')
    .eq('tenant_id', tenantId);

  const googleInt = integrations?.find((i) => i.provider === 'google_calendar' && i.refresh_token);
  const msInt = integrations?.find((i) => i.provider === 'microsoft_calendar' && i.refresh_token);

  if (msInt && !googleInt) return 'microsoft';
  if (googleInt) return 'google';
  if (msInt) return 'microsoft';

  return null;
}

/**
 * Gets an authenticated Google Calendar API client using the tenant's stored refresh token.
 */
export async function getGoogleCalendarClient(tenantId: string) {
  const { data: integration, error } = await getSupabaseAdmin()
    .from('tenant_integrations')
    .select('refresh_token, access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'google_calendar')
    .maybeSingle();

  if (integration?.refresh_token === 'mock_google_refresh_token') {
    return null;
  }

  if (error || !integration || !integration.refresh_token) {
    if (process.env.NODE_ENV === 'test' || process.env.PLAYWRIGHT_TEST === 'true') {
      // Mock client for tests
      return null;
    }
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
 * Fetches busy intervals from Google Calendar.
 * IMPORTANT: If query fails, throws an error so we do NOT falsely treat all slots as free.
 */
export async function getGoogleBusy(
  tenantId: string,
  calendarId: string,
  startUtc: Date,
  endUtc: Date
): Promise<BusyInterval[]> {
  const calendar = await getGoogleCalendarClient(tenantId);

  // If in a mock test environment and no real client was created
  if (!calendar) {
    return [];
  }

  const freeBusyRes = await calendar.freebusy.query({
    requestBody: {
      timeMin: startUtc.toISOString(),
      timeMax: endUtc.toISOString(),
      timeZone: 'UTC',
      items: [{ id: calendarId || 'primary' }],
    },
  });

  const calendarBusy = freeBusyRes.data.calendars?.[calendarId || 'primary']?.busy;
  if (!calendarBusy) {
    return [];
  }

  return calendarBusy
    .filter((slot) => slot.start && slot.end)
    .map((slot) => ({
      start: new Date(slot.start as string),
      end: new Date(slot.end as string),
    }));
}

/**
 * Fetches busy intervals from Microsoft Calendar using Graph API (getSchedule / calendarView).
 * IMPORTANT: If query fails, throws an error so we do NOT falsely treat all slots as free.
 */
export async function getMicrosoftBusy(
  tenantId: string,
  staff: StaffCalendarTarget,
  startUtc: Date,
  endUtc: Date
): Promise<BusyInterval[]> {
  const token = await getMicrosoftAccessToken(tenantId);
  if (!token) {
    throw new Error('Microsoft Calendar not connected or failed to acquire access token');
  }

  if (token === 'mock_ms_access_token') {
    return [];
  }

  // Use calendarView to list existing non-cancelled events
  const calTarget = staff.microsoft_calendar_id && staff.microsoft_calendar_id !== 'primary'
    ? `me/calendars/${staff.microsoft_calendar_id}/calendarView`
    : 'me/calendarView';

  const url = new URL(`https://graph.microsoft.com/v1.0/${calTarget}`);
  url.searchParams.set('startDateTime', startUtc.toISOString());
  url.searchParams.set('endDateTime', endUtc.toISOString());
  url.searchParams.set('$select', 'id,subject,start,end,isCancelled');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Prefer: 'outlook.timezone="UTC"',
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Microsoft Graph free/busy check failed (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  interface GraphEventItem {
    isCancelled?: boolean;
    start?: { dateTime: string };
    end?: { dateTime: string };
  }
  const events: GraphEventItem[] = data.value || [];

  return events
    .filter((ev): ev is GraphEventItem & { start: { dateTime: string }; end: { dateTime: string } } =>
      !ev.isCancelled && Boolean(ev.start?.dateTime) && Boolean(ev.end?.dateTime)
    )
    .map((ev) => ({
      start: new Date(ev.start.dateTime + (ev.start.dateTime.endsWith('Z') ? '' : 'Z')),
      end: new Date(ev.end.dateTime + (ev.end.dateTime.endsWith('Z') ? '' : 'Z')),
    }));
}

/**
 * Universal free/busy provider dispatcher.
 * If the provider call fails, it throws to ensure the caller does NOT assume slots are free.
 */
export async function getBusy(
  tenantId: string,
  staff: StaffCalendarTarget,
  startUtc: Date,
  endUtc: Date
): Promise<BusyInterval[]> {
  const provider = await resolveCalendarProvider(tenantId, staff);

  if (provider === 'microsoft') {
    return await getMicrosoftBusy(tenantId, staff, startUtc, endUtc);
  }

  if (provider === 'google') {
    return await getGoogleBusy(tenantId, staff.google_calendar_id || 'primary', startUtc, endUtc);
  }

  // If no calendar is connected, throw so booking fallbacks are triggered
  throw new Error('No calendar provider connected for this business or staff member');
}

/**
 * Creates an event in the connected Google or Microsoft calendar.
 */
export async function createEvent(
  tenantId: string,
  staff: StaffCalendarTarget,
  details: CalendarEventPayload
): Promise<CalendarEventResult> {
  const provider = await resolveCalendarProvider(tenantId, staff);

  if (provider === 'microsoft') {
    const result = await createMicrosoftCalendarEvent({
      tenantId,
      summary: details.summary,
      description: details.description,
      startTime: details.startTime,
      endTime: details.endTime,
      attendeeEmail: details.attendeeEmail,
      calendarId: staff.microsoft_calendar_id || details.calendarId,
    });

    if (!result?.id) {
      throw new Error('Failed to create Microsoft Calendar event');
    }

    return {
      id: result.id,
      provider: 'microsoft',
      webLink: result.webLink,
    };
  }

  if (provider === 'google') {
    const calendar = await getGoogleCalendarClient(tenantId);
    if (!calendar) {
      // Mock test environment
      return {
        id: `mock-google-evt-${Date.now()}`,
        provider: 'google',
      };
    }

    const calendarId = staff.google_calendar_id || details.calendarId || 'primary';
    const insertRes = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: details.summary,
        description: details.description,
        start: { dateTime: details.startTime },
        end: { dateTime: details.endTime },
        attendees: details.attendeeEmail ? [{ email: details.attendeeEmail }] : undefined,
      },
    });

    if (!insertRes.data?.id) {
      throw new Error('Failed to create Google Calendar event');
    }

    return {
      id: insertRes.data.id,
      provider: 'google',
      webLink: insertRes.data.htmlLink || undefined,
    };
  }

  throw new Error('No calendar provider connected to create event');
}
