import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createAdminClient } from '@/utils/supabase-admin';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state64 = searchParams.get('state');

  if (!code || !state64) {
    return NextResponse.json({ error: 'Missing code or state params' }, { status: 400 });
  }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

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

    const { tokens } = await oauth2Client.getToken(code);
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

      if (error) throw error;
    } else if (userId) {
      // Route B: Save token parameters globally in the tenant settings
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('tenant_id')
        .eq('id', userId)
        .single();

      if (profile) {
        let accountEmail = null;
        try {
          oauth2Client.setCredentials(tokens);
          const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
          const userInfo = await oauth2.userinfo.get();
          accountEmail = userInfo.data.email;
        } catch (e) {
          console.error('Failed to fetch user email:', e);
        }

        const { error } = await supabaseAdmin
          .from('tenant_integrations')
          .upsert({
            tenant_id: profile.tenant_id,
            provider: 'google_calendar',
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
            account_email: accountEmail,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'tenant_id,provider'
          });

        if (error) throw error;
      }
    } else {
      // Legacy fallback if state was tenantId
      const tenantId = state64;
      const { error } = await supabaseAdmin
        .from('tenant_integrations')
        .upsert({
          tenant_id: tenantId,
          provider: 'google_calendar',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
          updated_at: new Date().toISOString()
        }, {
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
