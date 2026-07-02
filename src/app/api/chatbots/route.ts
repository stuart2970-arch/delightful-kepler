import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

async function getSupabaseAuthClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env['NEXT_PUBLIC_' + 'SUPABASE_URL'];
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
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id, tenant_id, name, primary_color, configuration_json } = body;

    if (!id || !name || !tenant_id) {
      return NextResponse.json({ error: 'id, name, and tenant_id are required' }, { status: 400 });
    }

    // Insert using standard RLS (requires matching tenant_id tied to user's profile)
    const { data: chatbot, error } = await supabase
      .from('chatbots')
      .insert({
        id,
        tenant_id,
        name,
        primary_color,
        configuration_json,
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
