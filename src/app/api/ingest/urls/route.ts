import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { jwtDecode } from 'jwt-decode';

export const dynamic = 'force-dynamic';

function getTenantIdFromCookie(): string | null {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get('sb-access-token')?.value;
    if (!token) return null;
    
    const decoded = jwtDecode<any>(token);
    return decoded.tenant_id || null;
  } catch (err) {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const tenantId = getTenantIdFromCookie();
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    // Determine if user is super admin
    const cookieStore = await cookies();
    const token = cookieStore.get('sb-access-token')?.value;
    let isSuperAdmin = false;
    
    if (token) {
      const decoded = jwtDecode<any>(token);
      if (decoded.sub) {
        const { data: profile } = await supabaseAdmin.from('profiles').select('is_super_admin').eq('id', decoded.sub).single();
        if (profile?.is_super_admin) isSuperAdmin = true;
      }
    }

    // Verify ownership if not super admin
    if (!isSuperAdmin) {
      const { data: bot } = await supabaseAdmin.from('chatbots').select('id').eq('id', chatbotId).eq('tenant_id', tenantId).single();
      if (!bot) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from('document_chunks')
      .select('id, source_url, created_at')
      .eq('chatbot_id', chatbotId);

    if (error) {
      throw error;
    }

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
    const tenantId = getTenantIdFromCookie();
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    // Determine if user is super admin
    const cookieStore = await cookies();
    const token = cookieStore.get('sb-access-token')?.value;
    let isSuperAdmin = false;
    
    if (token) {
      const decoded = jwtDecode<any>(token);
      if (decoded.sub) {
        const { data: profile } = await supabaseAdmin.from('profiles').select('is_super_admin').eq('id', decoded.sub).single();
        if (profile?.is_super_admin) isSuperAdmin = true;
      }
    }

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

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete knowledge base URLs:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
