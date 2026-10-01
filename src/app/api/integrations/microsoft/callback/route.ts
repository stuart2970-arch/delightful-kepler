import { NextRequest, NextResponse } from 'next/server';
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
    const clientId = process.env.MICROSOFT_CLIENT_ID || process.env.AZURE_CLIENT_ID || '';
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '';
    const redirectUri = `${appUrl}/api/integrations/microsoft/callback`;

    let userId: string | null = null;
    let staffId: string | null = null;

    try {
      const decoded = JSON.parse(Buffer.from(state64, 'base64').toString('utf-8'));
      userId = decoded.userId || null;
      staffId = decoded.staffId || null;
    } catch {
      userId = null;
      staffId = null;
    }

    let tokens: { access_token?: string; refresh_token?: string; expires_in?: number; account_email?: string } = {};

    if (code.startsWith('mock_')) {
      tokens = {
        access_token: 'mock_ms_access_token',
        refresh_token: 'mock_ms_refresh_token',
        expires_in: 3600,
        account_email: 'user@outlook.com',
      };
    } else {
      const bodyParams = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });

      const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyParams.toString(),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error('[Microsoft OAuth] Token exchange failed:', errText);
        return NextResponse.json({ error: 'Failed to exchange Microsoft OAuth token', details: errText }, { status: 400 });
      }

      const tokenData = await tokenRes.json();
      tokens = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
      };

      // Fetch user email from Microsoft Graph
      try {
        const userRes = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          tokens.account_email = userData.mail || userData.userPrincipalName;
        }
      } catch (meErr) {
        console.error('[Microsoft OAuth] Error fetching Graph profile:', meErr);
      }
    }

    const supabaseAdmin = createAdminClient();

    if (staffId) {
      const { error } = await supabaseAdmin
        .from('staff')
        .update({
          calendar_provider: 'microsoft',
          microsoft_calendar_id: tokens.account_email || 'primary',
        })
        .eq('id', staffId);

      if (error) {
        console.error('[Microsoft OAuth] Staff update note:', error.message);
      }
    }

    if (userId) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('tenant_id')
        .eq('id', userId)
        .single();

      if (profile?.tenant_id) {
        // Save refresh token on tenant table per migration specification
        if (tokens.refresh_token) {
          await supabaseAdmin
            .from('tenants')
            .update({ microsoft_refresh_token: tokens.refresh_token })
            .eq('id', profile.tenant_id);
        }

        // Also record in tenant_integrations table for UI status component parity
        await supabaseAdmin
          .from('tenant_integrations')
          .upsert({
            tenant_id: profile.tenant_id,
            provider: 'microsoft_calendar',
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expiry_date: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
            account_email: tokens.account_email || null,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'tenant_id,provider',
          });
      }
    }

    return NextResponse.redirect(`${appUrl}/dashboard?tab=scheduling&success=microsoft_calendar`);
  } catch (err: any) {
    console.error('[Microsoft OAuth Callback Error]:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
