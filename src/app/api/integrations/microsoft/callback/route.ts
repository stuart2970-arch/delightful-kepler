import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase-admin';
import { publicAppPath } from '@/lib/env/public-app-url';
import { requireOAuthCallback } from '@/lib/auth/oauth-callback-guard';

type MicrosoftTokens = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  account_email?: string;
};

/** Staff connects update that staff row. Salon connects update the tenant token. */
export async function saveMicrosoftCalendarConnection(
  supabaseAdmin: { from: (table: string) => any },
  input: { staffId: string | null; tenantId: string; tokens: MicrosoftTokens },
): Promise<void> {
  const { staffId, tenantId, tokens } = input;
  if (staffId) {
    const { data: staff } = await supabaseAdmin
      .from('staff')
      .select('id, tenant_id')
      .eq('id', staffId)
      .maybeSingle();

    if (staff && String(staff.tenant_id) === tenantId) {
      const { error } = await supabaseAdmin
        .from('staff')
        .update({
          calendar_provider: 'microsoft',
          microsoft_calendar_id: tokens.account_email || 'primary',
        })
        .eq('id', staffId)
        .eq('tenant_id', tenantId);

      if (error) {
        console.error('[Microsoft OAuth] Staff update note:', error.message);
      }
    }
    return;
  }

  if (tokens.refresh_token) {
    await supabaseAdmin
      .from('tenants')
      .update({ microsoft_refresh_token: tokens.refresh_token })
      .eq('id', tenantId);
  }

  await supabaseAdmin
    .from('tenant_integrations')
    .upsert({
      tenant_id: tenantId,
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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state64 = searchParams.get('state');

  const gate = await requireOAuthCallback(request, code, state64);
  if (!gate.ok) return gate.response;

  try {
    const appUrl = publicAppPath('');
    const clientId = process.env.MICROSOFT_CLIENT_ID || process.env.AZURE_CLIENT_ID || '';
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '';
    const redirectUri = `${appUrl}/api/integrations/microsoft/callback`;

    let tokens: { access_token?: string; refresh_token?: string; expires_in?: number; account_email?: string } = {};

    if (gate.code.startsWith('mock_')) {
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
        code: gate.code,
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

    await saveMicrosoftCalendarConnection(createAdminClient(), {
      staffId: gate.staffId,
      tenantId: gate.tenantId,
      tokens,
    });

    return NextResponse.redirect(`${appUrl}/dashboard?tab=scheduling&success=microsoft_calendar`);
  } catch (err: any) {
    console.error('[Microsoft OAuth Callback Error]:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
