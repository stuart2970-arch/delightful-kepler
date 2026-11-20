import { NextRequest, NextResponse } from 'next/server';
import { publicAppPath } from '@/lib/env/public-app-url';
import { requireUser } from '@/lib/auth/require-superadmin';
import { signOAuthState } from '@/lib/auth/oauth-state';
import { calendarConnectAllowed } from '@/lib/auth/oauth-callback-guard';
import { createAdminClient } from '@/utils/supabase-admin';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const staffId = searchParams.get('staffId');
    const appUrl = publicAppPath('');
    const supabase = createAdminClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', auth.userId)
      .single();

    if (!profile?.tenant_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const connectAllowed = await calendarConnectAllowed(auth.userId, String(profile.tenant_id), staffId);
    if (!connectAllowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const state = signOAuthState({
      userId: auth.userId,
      tenantId: String(profile.tenant_id),
      staffId: staffId || null,
    });
    if (!state) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID || process.env.AZURE_CLIENT_ID || 'mock_microsoft_client_id';
    const redirectUri = `${appUrl}/api/integrations/microsoft/callback`;
    const scopes = encodeURIComponent('openid profile offline_access https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read');

    const authorizeUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${scopes}&state=${encodeURIComponent(state)}&prompt=consent`;

    return NextResponse.redirect(authorizeUrl);
  } catch (err: any) {
    console.error('Error generating Microsoft OAuth URL:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
