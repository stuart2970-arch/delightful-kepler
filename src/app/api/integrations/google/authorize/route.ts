import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createServerClient } from '@/utils/supabase-server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const staffId = searchParams.get('staffId'); // Optional staff mapping

    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${appUrl}/api/integrations/google/callback`
    );

    // Encode contextual data into OAuth state payload to bypass environments safely
    const statePayload = JSON.stringify({
      userId: user.id,
      staffId: staffId || null,
    });

    const authorizeUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly'
      ],
      state: Buffer.from(statePayload).toString('base64'),
    });

    return NextResponse.redirect(authorizeUrl);
  } catch (err: any) {
    console.error('Error generating Google OAuth URL:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
