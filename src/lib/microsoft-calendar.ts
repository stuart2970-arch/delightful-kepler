import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function getMicrosoftAccessToken(tenantId: string): Promise<string | null> {
  const supabaseAdmin = getSupabaseAdmin();

  // Try tenant_integrations first, then fall back to tenants.microsoft_refresh_token
  const [{ data: integration }, { data: tenant }] = await Promise.all([
    supabaseAdmin
      .from('tenant_integrations')
      .select('access_token, refresh_token, expiry_date')
      .eq('tenant_id', tenantId)
      .eq('provider', 'microsoft_calendar')
      .maybeSingle(),
    supabaseAdmin
      .from('tenants')
      .select('microsoft_refresh_token')
      .eq('id', tenantId)
      .maybeSingle(),
  ]);

  const refreshToken = integration?.refresh_token || tenant?.microsoft_refresh_token;

  if (!refreshToken) {
    if (process.env.NODE_ENV === 'development' || refreshToken === 'mock_ms_refresh_token') {
      return 'mock_ms_access_token';
    }
    return null;
  }

  // Check if current access token is still valid
  if (integration?.access_token && integration?.expiry_date) {
    const expires = new Date(integration.expiry_date).getTime();
    if (Date.now() < expires - 60000) {
      return integration.access_token;
    }
  }

  // Refresh token via Microsoft OAuth token endpoint
  const clientId = process.env.MICROSOFT_CLIENT_ID || process.env.AZURE_CLIENT_ID || '';
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '';

  try {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'https://graph.microsoft.com/Calendars.ReadWrite offline_access',
    });

    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      console.error('[Microsoft Graph] Token refresh failed:', await res.text());
      return null;
    }

    const data = await res.json();
    const newAccessToken = data.access_token;
    const newRefreshToken = data.refresh_token || refreshToken;
    const expiryDate = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();

    // Update refreshed tokens
    await supabaseAdmin
      .from('tenant_integrations')
      .upsert({
        tenant_id: tenantId,
        provider: 'microsoft_calendar',
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expiry_date: expiryDate,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,provider' });

    return newAccessToken;
  } catch (err) {
    console.error('[Microsoft Graph] Error refreshing access token:', err);
    return null;
  }
}

export interface CreateMicrosoftEventParams {
  tenantId: string;
  summary: string;
  description?: string;
  startTime: string; // ISO String
  endTime: string;   // ISO String
  attendeeEmail?: string;
  calendarId?: string;
}

export async function createMicrosoftCalendarEvent(params: CreateMicrosoftEventParams): Promise<{ id: string; webLink?: string } | null> {
  const token = await getMicrosoftAccessToken(params.tenantId);
  if (!token) {
    console.error('[Microsoft Graph] No valid access token found for tenant:', params.tenantId);
    return null;
  }

  if (token === 'mock_ms_access_token') {
    return { id: `ms-mock-${Date.now()}` };
  }

  const calendarTarget = params.calendarId && params.calendarId !== 'primary'
    ? `me/calendars/${params.calendarId}/events`
    : 'me/events';

  const eventPayload: any = {
    subject: params.summary,
    body: {
      contentType: 'HTML',
      content: params.description || '',
    },
    start: {
      dateTime: params.startTime,
      timeZone: 'UTC',
    },
    end: {
      dateTime: params.endTime,
      timeZone: 'UTC',
    },
  };

  if (params.attendeeEmail) {
    eventPayload.attendees = [
      {
        emailAddress: { address: params.attendeeEmail },
        type: 'required',
      },
    ];
  }

  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/${calendarTarget}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventPayload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[Microsoft Graph] Event creation failed:', errText);
      return null;
    }

    const data = await res.json();
    return { id: data.id, webLink: data.webLink };
  } catch (err) {
    console.error('[Microsoft Graph] Error creating event:', err);
    return null;
  }
}
