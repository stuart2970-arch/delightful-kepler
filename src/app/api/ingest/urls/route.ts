import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUser } from '@/lib/auth/require-superadmin';
import { getTenantEffectiveLimit } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) {
      return auth.response;
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

    // Get user profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id, is_super_admin')
      .eq('id', auth.userId)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'User tenant profile not found' }, { status: 403 });
    }

    const isSuperAdmin = profile.is_super_admin === true;
    let tenantId = profile.tenant_id;

    // Verify chatbot ownership
    if (isSuperAdmin) {
      const { data: bot } = await supabaseAdmin
        .from('chatbots')
        .select('id, tenant_id')
        .eq('id', chatbotId)
        .maybeSingle();

      if (!bot) {
        return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
      }
      tenantId = bot.tenant_id;
    } else {
      const { data: bot } = await supabaseAdmin
        .from('chatbots')
        .select('id, tenant_id')
        .eq('id', chatbotId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!bot) {
        return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
      }
    }

    // Query document chunks for this chatbot
    const { data, error } = await supabaseAdmin
      .from('document_chunks')
      .select('id, source_url, created_at, metadata')
      .eq('chatbot_id', chatbotId)
      .order('created_at', { ascending: false })
      .limit(10000);

    if (error) throw error;

    // Group by source_url in memory
    const urlMap = new Map<string, {
      url: string;
      title: string;
      sourceType: 'url' | 'text' | 'file';
      chunkCount: number;
      latestDate: string;
    }>();

    for (const chunk of data || []) {
      const url = chunk.source_url || 'Unknown Source';
      const meta = (chunk.metadata as any) || {};
      const title = meta.title || meta.site_name || url;
      let sourceType: 'url' | 'text' | 'file' = 'url';
      if (meta.source_type === 'raw_text') sourceType = 'text';
      else if (meta.source_type === 'file') sourceType = 'file';
      else if (!url.startsWith('http://') && !url.startsWith('https://')) sourceType = 'file';

      if (!urlMap.has(url)) {
        urlMap.set(url, {
          url,
          title,
          sourceType,
          chunkCount: 0,
          latestDate: chunk.created_at,
        });
      }
      const entry = urlMap.get(url)!;
      entry.chunkCount += 1;
      if (new Date(chunk.created_at) > new Date(entry.latestDate)) {
        entry.latestDate = chunk.created_at;
      }
    }

    const urlsList = Array.from(urlMap.values());
    urlsList.sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());

    // Calculate tenant-wide knowledge items quota
    const { count: tenantTotalChunks } = await supabaseAdmin
      .from('document_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    const limit = await getTenantEffectiveLimit(tenantId, 'knowledge_data_chunks');
    const effectiveLimit = limit ?? 500;
    const currentUsage = tenantTotalChunks ?? 0;
    const remaining = Math.max(0, effectiveLimit - currentUsage);

    return NextResponse.json({
      urls: urlsList,
      totalChunks: urlsList.reduce((acc, u) => acc + u.chunkCount, 0),
      quota: {
        limit: effectiveLimit,
        currentUsage,
        remaining,
      }
    });
  } catch (error: any) {
    console.error('Failed to fetch knowledge base URLs:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(req.url);
    const chatbotId = searchParams.get('chatbotId');
    const sourceUrl = searchParams.get('sourceUrl');
    const all = searchParams.get('all') === 'true';

    if (!chatbotId) {
      return NextResponse.json({ error: 'Missing chatbotId' }, { status: 400 });
    }

    if (!all && !sourceUrl) {
      return NextResponse.json({ error: 'Missing sourceUrl or all=true' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // Get user profile to check role and tenant
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id, is_super_admin, role')
      .eq('id', auth.userId)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'User tenant profile not found' }, { status: 403 });
    }

    const isSuperAdmin = profile.is_super_admin === true;
    const isOwner = profile.role === 'owner';
    let tenantId = profile.tenant_id;

    // Verify chatbot ownership
    if (isSuperAdmin) {
      const { data: bot } = await supabaseAdmin
        .from('chatbots')
        .select('id, tenant_id')
        .eq('id', chatbotId)
        .maybeSingle();

      if (!bot) {
        return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
      }
      tenantId = bot.tenant_id;
    } else {
      const { data: bot } = await supabaseAdmin
        .from('chatbots')
        .select('id, tenant_id')
        .eq('id', chatbotId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!bot) {
        return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
      }
    }

    // "Delete all" action: owner or superadmin only (STYL-186)
    if (all) {
      if (!isSuperAdmin && !isOwner) {
        return NextResponse.json(
          { error: 'Only account owners and superadmins can delete all knowledge items for this chatbot' },
          { status: 403 }
        );
      }

      const { data: deletedChunks, error } = await supabaseAdmin
        .from('document_chunks')
        .delete()
        .eq('chatbot_id', chatbotId)
        .select('id');

      if (error) throw error;

      console.log(`[RAG Deletion] Deleted all ${deletedChunks?.length || 0} chunks for chatbot ${chatbotId}`);
      return NextResponse.json({
        success: true,
        deletedCount: deletedChunks?.length || 0,
        message: `Successfully deleted all knowledge items for this chatbot.`
      });
    }

    // Delete single source
    let query = supabaseAdmin
      .from('document_chunks')
      .delete()
      .eq('chatbot_id', chatbotId);

    if (sourceUrl === 'Unknown Source') {
      query = query.is('source_url', null);
    } else {
      query = query.eq('source_url', sourceUrl);
    }

    const { data: deletedChunks, error } = await query.select('id');
    if (error) throw error;

    console.log(`[RAG Deletion] Deleted ${deletedChunks?.length || 0} chunks for chatbot ${chatbotId} and source ${sourceUrl}`);
    return NextResponse.json({
      success: true,
      deletedCount: deletedChunks?.length || 0,
      message: `Successfully deleted knowledge items for "${sourceUrl}".`
    });
  } catch (error: any) {
    console.error('Failed to delete knowledge base URLs:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
