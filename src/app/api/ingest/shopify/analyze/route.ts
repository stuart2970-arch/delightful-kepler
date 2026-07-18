import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { checkFeatureEntitlement } from '@/lib/entitlements';

const AnalyzeRequestSchema = z.object({
  storeUrl: z.string().url({ message: 'Invalid URL format' }),
  chatbotId: z.string().uuid({ message: 'Invalid chatbot ID format' }),
});

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
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
    }
  );

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validation = AnalyzeRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
    }

    const { storeUrl, chatbotId } = validation.data;

    // Get Tenant ID
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile?.tenant_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 });
    }

    const tenantId = profile.tenant_id;

    // Verify Chatbot Ownership
    const { data: chatbot } = await supabase
      .from('chatbots')
      .select('id')
      .eq('id', chatbotId)
      .eq('tenant_id', tenantId)
      .single();

    if (!chatbot) {
      return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
    }

    // Clean URL and Fetch Products
    const cleanUrl = storeUrl.replace(/\/$/, '');
    const targetJsonUrl = `${cleanUrl}/collections/all/products.json?limit=250`;

    let totalProducts = 0;
    try {
      const response = await fetch(targetJsonUrl, {
        headers: { 'User-Agent': 'StyleFloIngestEngine/2.0 (Agentic Knowledge Base Ingest)' },
        next: { revalidate: 0 }
      });
      if (!response.ok) {
         // Not a shopify store or blocked
         return NextResponse.json({ error: 'Could not access Shopify products.json on this domain.' }, { status: 400 });
      }
      const data = await response.json();
      totalProducts = Array.isArray(data.products) ? data.products.length : 0;
    } catch (e) {
      return NextResponse.json({ error: 'Failed to fetch Shopify products array.' }, { status: 400 });
    }

    // Calculate Estimated Chunks
    // Roughly 1 chunk per product + 4 policies (maybe 2 chunks each)
    const estimatedChunks = totalProducts + 8; 

    // Check Entitlement
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const entitlement = await checkFeatureEntitlement(adminClient, tenantId, 'knowledge_data_chunks', estimatedChunks);

    return NextResponse.json({
      success: true,
      totalProducts,
      estimatedChunks,
      willHitLimit: !entitlement.allowed,
      limitLimit: entitlement.limit || 0,
      currentUsage: entitlement.currentUsage || 0,
      limitError: entitlement.error || null
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
