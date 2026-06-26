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

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    
    const { data: conversations, error: convError } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .limit(10);

    const { data: messages, error: msgError } = await supabaseAdmin
      .from('messages')
      .select('*')
      .limit(20);

    const { data: chatbots, error: botError } = await supabaseAdmin
      .from('chatbots')
      .select('*')
      .limit(5);

    return NextResponse.json({
      conversations: conversations || [],
      messages: messages || [],
      chatbots: chatbots || [],
      errors: {
        convError: convError?.message || null,
        msgError: msgError?.message || null,
        botError: botError?.message || null,
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
