import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const authClient = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {}
      },
    });

    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await authClient
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single();

    if (!profile || !profile.is_super_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const { branding_html, branding_url, global_voice_disclaimer } = body;

    const adminClient = createClient(supabaseUrl, serviceKey);
    const globalBotId = '00000000-0000-0000-0000-000000000000';

    // Fetch existing config
    const { data: existingBot } = await adminClient
      .from('chatbots')
      .select('configuration_json')
      .eq('id', globalBotId)
      .single();

    const newConfig = {
      ...(existingBot?.configuration_json || {}),
      ...(branding_html !== undefined && { branding_html }),
      ...(branding_url !== undefined && { branding_url }),
      ...(global_voice_disclaimer !== undefined && { global_voice_disclaimer }),
    };

    const { error } = await adminClient
      .from('chatbots')
      .upsert({
        id: globalBotId,
        tenant_id: '00000000-0000-0000-0000-000000000000',
        name: 'GLOBAL_PLATFORM_SETTINGS',
        primary_color: '#000000',
        configuration_json: newConfig
      }, { onConflict: 'id' });

    if (error) {
      console.error('[Global Settings API] Error updating:', error);
      return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Global Settings API] Unexpected failure:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
