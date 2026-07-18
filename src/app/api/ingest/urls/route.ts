import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

async function getSupabaseAuthClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;

  return createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {}
      },
    },
  });
}

export async function GET(req: Request) {
  try {
    const supabase = await getSupabaseAuthClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Get profile to check for superadmin
    const { data: profile } = await supabase.from('profiles').select('tenant_id, is_super_admin').eq('id', user.id).single();
    const tenantId = profile?.tenant_id;
    const isSuperAdmin = profile?.is_super_admin === true;

    const { searchParams } = new URL(req.url);
    const chatbotId = searchParams.get('chatbotId');

    if (!chatbotId) {
      return NextResponse.json({ error: 'Missing chatbotId' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // Verify ownership if not super admin
    if (!isSuperAdmin) {
      const { data: bot } = await supabaseAdmin.from('chatbots').select('id').eq('id', chatbotId).eq('tenant_id', tenantId).single();
      if (!bot) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from('document_chunks')
      .select('id, source_url, created_at')
      .eq('chatbot_id', chatbotId);

    if (error) throw error;

    // Group by source_url in memory
    const urlMap = new Map<string, { url: string; chunkCount: number; latestDate: string }>();

    for (const chunk of data || []) {
      const url = chunk.source_url || 'Unknown Source';
      if (!urlMap.has(url)) {
        urlMap.set(url, { url, chunkCount: 0, latestDate: chunk.created_at });
      }
      const entry = urlMap.get(url)!;
      entry.chunkCount += 1;
      if (new Date(chunk.created_at) > new Date(entry.latestDate)) {
        entry.latestDate = chunk.created_at;
      }
    }

    const urlsList = Array.from(urlMap.values());
    urlsList.sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());

    return NextResponse.json({ urls: urlsList });
  } catch (error: any) {
    console.error('Failed to fetch knowledge base URLs:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = await getSupabaseAuthClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Get profile to check for superadmin
    const { data: profile } = await supabase.from('profiles').select('tenant_id, is_super_admin').eq('id', user.id).single();
    const tenantId = profile?.tenant_id;
    const isSuperAdmin = profile?.is_super_admin === true;

    const { searchParams } = new URL(req.url);
    const chatbotId = searchParams.get('chatbotId');
    const sourceUrl = searchParams.get('sourceUrl');

    if (!chatbotId || !sourceUrl) {
      return NextResponse.json({ error: 'Missing chatbotId or sourceUrl' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // Verify ownership if not super admin
    if (!isSuperAdmin) {
      const { data: bot } = await supabaseAdmin.from('chatbots').select('id').eq('id', chatbotId).eq('tenant_id', tenantId).single();
      if (!bot) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let query = supabaseAdmin
      .from('document_chunks')
      .delete()
      .eq('chatbot_id', chatbotId);

    if (sourceUrl === 'Unknown Source') {
      query = query.is('source_url', null);
    } else {
      query = query.eq('source_url', sourceUrl);
    }

    const { error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete knowledge base URLs:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

