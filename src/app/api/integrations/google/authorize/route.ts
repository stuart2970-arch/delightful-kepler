import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
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
      .select('tenant_id, is_super_admin')
      .eq('id', auth.userId)
      .single();

    if (!profile?.tenant_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!profile.is_super_admin) {
      const { getTenantEffectiveLimit, getTenantChannelFlags } = await import('@/lib/entitlements');
      const [channelFlags, effectiveLimit] = await Promise.all([
        getTenantChannelFlags(profile.tenant_id),
        getTenantEffectiveLimit(profile.tenant_id, 'google_calendar'),
      ]);

      if (!channelFlags.has_google_calendar && (!effectiveLimit || effectiveLimit <= 0)) {
        return NextResponse.redirect(`${appUrl}/dashboard?tab=scheduling&error=google_calendar_addon_required`);
      }
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

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${appUrl}/api/integrations/google/callback`
    );

    const authorizeUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly'
      ],
      state,
    });

    return NextResponse.redirect(authorizeUrl);
  } catch (err: any) {
    console.error('Error generating Google OAuth URL:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
