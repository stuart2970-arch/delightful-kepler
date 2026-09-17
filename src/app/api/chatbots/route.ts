import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

async function getSupabaseAuthClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase environment variables are missing');
  }

  return createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Safe to ignore in Server Components
        }
      },
    },
  });
}

export async function POST(request: Request) {
  try {
    const supabase = await getSupabaseAuthClient();
    let user = (await supabase.auth.getUser()).data?.user;

    // Fallback to Bearer token in Authorization header if cookies are blocked
    if (!user) {
      const authHeader = request.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        const { data: userData } = await supabase.auth.getUser(token);
        if (userData?.user) {
          user = userData.user;
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id, tenant_id, name, primary_color, configuration_json, voice_enabled } = body;

    if (!id || !name || !tenant_id) {
      return NextResponse.json({ error: 'id, name, and tenant_id are required' }, { status: 400 });
    }

    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile } = await adminClient
      .from('profiles')
      .select('tenant_id, is_super_admin')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 403 });
    }

    if (!profile.is_super_admin && tenant_id !== profile.tenant_id) {
      return NextResponse.json({ error: 'Forbidden: You do not own this tenant' }, { status: 403 });
    }

    const { data: chatbot, error } = await adminClient
      .from('chatbots')
      .insert({
        id,
        tenant_id,
        name,
        primary_color,
        configuration_json,
        voice_enabled,
      })
      .select()
      .single();

    if (error) {
      console.error('[Chatbots POST API] Error inserting chatbot:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, chatbot });
  } catch (err: any) {
    console.error('[Chatbots POST API] Unexpected failure:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
