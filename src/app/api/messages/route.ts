import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireTenantRole } from '@/lib/auth/require-tenant-role';

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

export async function GET(request: Request) {
  try {
    const auth = await requireTenantRole(request, ['owner', 'admin', 'member']);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');
    const requested = searchParams.get('tenantId');

    if (
      requested
      && requested !== 'undefined'
      && requested !== auth.tenantId
      && !auth.isSuperAdmin
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId parameter is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: conversation, error: conversationError } = await supabaseAdmin
      .from('conversations')
      .select('id, tenant_id')
      .eq('id', conversationId)
      .maybeSingle();

    if (conversationError) {
      console.error('[Messages API] Error loading conversation:', conversationError);
      return NextResponse.json({ error: conversationError.message }, { status: 500 });
    }
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!auth.isSuperAdmin && String(conversation.tenant_id) !== auth.tenantId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: messages, error } = await supabaseAdmin
      .from('messages')
      .select('id, sender_type, text_content, created_at')
      .eq('conversation_id', conversationId)
      .eq('tenant_id', conversation.tenant_id)
      .order('created_at', { ascending: true });

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
