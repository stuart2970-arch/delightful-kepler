import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  try {
    // Initialize Supabase Admin Client using service role key to bypass RLS for reading
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: personas, error } = await supabaseAdmin
      .from('voice_personas')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;

    return NextResponse.json(personas, { headers: corsHeaders });
  } catch (err: any) {
    console.error('Failed to fetch voice personas:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabase = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    });

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Since RLS is enabled, the insertion will fail if the user is not a superadmin
    const body = await request.json();

    const { data: persona, error } = await supabase
      .from('voice_personas')
      .insert([body])
      .select()
      .single();

    if (error) {
      console.error('Failed to create voice persona:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(persona);
  } catch (err: any) {
    console.error('Failed to create voice persona:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
