import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const tenantId = searchParams.get('state');

    if (!code || !tenantId) {
      return NextResponse.json({ error: 'Missing code or state (tenantId)' }, { status: 400 });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/integrations/google/callback`
    );

    const { tokens } = await oauth2Client.getToken(code);
    
    // Store tokens in Supabase
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null;

    const { error: upsertError } = await supabaseAdmin
      .from('tenant_integrations')
      .upsert({
        tenant_id: tenantId,
        provider: 'google_calendar',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token, // Might be undefined if not first time
        expiry_date: expiryDate,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'tenant_id,provider'
      });

    if (upsertError) {
      console.error('Failed to store Google Calendar tokens:', upsertError);
      return NextResponse.json({ error: 'Failed to store tokens in database' }, { status: 500 });
    }

    // Redirect the user back to the dashboard integrations page
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/dashboard?success=google_calendar`);

  } catch (err: any) {
    console.error('Error handling Google OAuth callback:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
