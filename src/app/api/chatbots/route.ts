import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, tenant_id, name, primary_color, configuration_json } = body;

    if (!id || !name || !tenant_id) {
      return NextResponse.json({ error: 'id, name, and tenant_id are required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: chatbot, error } = await supabaseAdmin
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
