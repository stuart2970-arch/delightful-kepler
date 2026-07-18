import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query) {
      return NextResponse.json({ results: [] });
    }

    const cookieStore = await cookies();
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

    // Verify superadmin status
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single();

    if (!profile || !profile.is_super_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Create a service role client to bypass RLS since we verified superadmin
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const queryWords = query.trim().split(/\s+/);
    let tenantQuery = supabaseAdmin.from('tenants').select('id, company_name');
    let botQuery = supabaseAdmin.from('chatbots').select('id, name, tenant_id');

    // Build ILIKE chain for each word to make it an AND search
    queryWords.forEach(word => {
      tenantQuery = tenantQuery.ilike('company_name', `%${word}%`);
      botQuery = botQuery.ilike('name', `%${word}%`);
    });

    const { data: tenants } = await tenantQuery.limit(20);
    const { data: chatbots } = await botQuery.limit(20);

    const tenantIdsToFetch = new Set<string>();
    
    // Add tenants found by chatbot name that weren't in the tenant search
    if (chatbots) {
      chatbots.forEach(bot => tenantIdsToFetch.add(bot.tenant_id));
    }

    let extraTenants: any[] = [];
    if (tenantIdsToFetch.size > 0) {
      const existingIds = new Set(tenants?.map(t => t.id) || []);
      const missingIds = Array.from(tenantIdsToFetch).filter(id => !existingIds.has(id));
      
      if (missingIds.length > 0) {
        const { data: moreTenants } = await supabaseAdmin
          .from('tenants')
          .select('id, company_name')
          .in('id', missingIds);
        if (moreTenants) extraTenants = moreTenants;
      }
    }

    const allTenants = [...(tenants || []), ...extraTenants];

    // Build response array
    const results = allTenants.map(tenant => {
      const tenantBots = chatbots?.filter(b => b.tenant_id === tenant.id) || [];
      return {
        tenant_id: tenant.id,
        company_name: tenant.company_name,
        matched_chatbots: tenantBots.map(b => b.name)
      };
    });

    return NextResponse.json({ results });
  } catch (err: any) {
    console.error('[Impersonate Search API] Error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
