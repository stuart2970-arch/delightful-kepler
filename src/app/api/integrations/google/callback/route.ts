import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createAdminClient } from '@/utils/supabase-admin';
import { publicAppPath } from '@/lib/env/public-app-url';
import {
  emailInMockCode,
  resolveGoogleAccountEmail,
  unsignedIdTokenForEmail,
} from '@/lib/google-account-email';

async function connectedAccountEmail(oauth2Client: InstanceType<typeof google.auth.OAuth2>, tokens: { id_token?: string | null }): Promise<string | null> {
  const fromToken = resolveGoogleAccountEmail({ idToken: tokens.id_token });
  if (fromToken) return fromToken;

  try {
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const primary = await calendar.calendarList.get({ calendarId: 'primary' });
    return resolveGoogleAccountEmail({ calendarId: primary.data.id });
  } catch (error) {
    console.error('Failed to read connected Google account email:', error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state64 = searchParams.get('state');

  if (!code || !state64) {
    return NextResponse.json({ error: 'Missing code or state params' }, { status: 400 });
  }

  try {
    const appUrl = publicAppPath('');

    // Decode base64 state parameter
    let userId: string | null = null;
    let staffId: string | null = null;

    try {
      const decoded = JSON.parse(Buffer.from(state64, 'base64').toString('utf-8'));
      userId = decoded.userId || null;
      staffId = decoded.staffId || null;
    } catch {
      // Fallback if state was passed as plain tenantId string (legacy compatibility)
      userId = null;
      staffId = null;
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${appUrl}/api/integrations/google/callback`
    );

    let tokens: any = {};
    if (code.startsWith('mock_')) {
      const mockEmail = emailInMockCode(code);
      tokens = {
        access_token: 'mock_access_token',
        refresh_token: 'mock_refresh_token',
        expiry_date: Date.now() + 3600000,
        id_token: mockEmail ? unsignedIdTokenForEmail(mockEmail) : undefined,
      };
    } else {
      const result = await oauth2Client.getToken(code);
      tokens = result.tokens;
    }
    const supabaseAdmin = createAdminClient();

    if (staffId) {
      // Route A: Save individual token parameters in the staff profile
      const { error } = await supabaseAdmin
        .from('staff')
        .update({
          google_access_token: tokens.access_token,
          google_refresh_token: tokens.refresh_token,
          google_token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        })
        .eq('id', staffId);

      if (error) {
        console.error('Staff Google Token Update Note:', error.message || error);
      }
    } else if (userId) {
      // Route B: Save token parameters globally in the tenant settings
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('tenant_id')
        .eq('id', userId)
        .single();

      if (profile) {
        const accountEmail = await connectedAccountEmail(oauth2Client, tokens);
        const integrationRow: Record<string, unknown> = {
          tenant_id: profile.tenant_id,
          provider: 'google_calendar',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
          updated_at: new Date().toISOString(),
        };
        if (accountEmail) integrationRow.account_email = accountEmail;

        const { error } = await supabaseAdmin
          .from('tenant_integrations')
          .upsert(integrationRow, {
            onConflict: 'tenant_id,provider'
          });

        if (error) throw error;
      }
    } else {
      // Legacy fallback if state was tenantId
      const tenantId = state64;
      const accountEmail = await connectedAccountEmail(oauth2Client, tokens);
      const integrationRow: Record<string, unknown> = {
        tenant_id: tenantId,
        provider: 'google_calendar',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        updated_at: new Date().toISOString(),
      };
      if (accountEmail) integrationRow.account_email = accountEmail;
      const { error } = await supabaseAdmin
        .from('tenant_integrations')
        .upsert(integrationRow, {
          onConflict: 'tenant_id,provider'
        });

      if (error) throw error;
    }

    // Redirect user back to the scheduling dashboard page
    return NextResponse.redirect(`${appUrl}/dashboard?tab=scheduling&success=google_calendar`);
  } catch (err: any) {
    console.error('OAuth Callback Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
