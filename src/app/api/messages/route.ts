import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env['NEXT_PUBLIC_' + 'SUPABASE_URL'];
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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');
    const tenantId = searchParams.get('tenantId');

    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId parameter is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    
    let query = supabaseAdmin
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId);

    if (tenantId && tenantId !== 'undefined') {
      query = query.eq('tenant_id', tenantId);
    }

    const { data: messages, error } = await query.order('created_at', { ascending: true });

    if (error) {
      console.error('[Messages API] Error querying database:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ messages: messages || [] }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      }
    });
  } catch (err: any) {
    console.error('[Messages API] Unexpected failure:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
