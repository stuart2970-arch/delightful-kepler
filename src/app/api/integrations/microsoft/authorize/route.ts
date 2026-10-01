import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/utils/supabase-server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const staffId = searchParams.get('staffId');

    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const clientId = process.env.MICROSOFT_CLIENT_ID || process.env.AZURE_CLIENT_ID || 'mock_microsoft_client_id';

    const statePayload = JSON.stringify({
      userId: user.id,
      staffId: staffId || null,
    });

    const redirectUri = `${appUrl}/api/integrations/microsoft/callback`;
    const scopes = encodeURIComponent('openid profile offline_access https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read');
    const state = Buffer.from(statePayload).toString('base64');

    const authorizeUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${scopes}&state=${state}&prompt=consent`;

    return NextResponse.redirect(authorizeUrl);
  } catch (err: any) {
    console.error('Error generating Microsoft OAuth URL:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
