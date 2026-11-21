import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publishBusinessPageForTenant } from '@/lib/tenants/publish-business-page';

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server configuration missing' }, { status: 500 });
    }

    const supabase = createServerClient(supabaseUrl, serviceRoleKey, {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {}
      }
    });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { tenantId, businessName } = body;

    if (!tenantId || !businessName || !businessName.trim()) {
      return NextResponse.json({ error: 'Tenant ID and Business Name are required.' }, { status: 400 });
    }

    const result = await publishBusinessPageForTenant(supabase, tenantId, businessName);
    if (!result.ok) {
      if (result.wordpressError) {
        console.error('[Publish Business Page] WordPress rejection', {
          kind: result.wordpressError,
          status: result.status,
        });
      }
      return NextResponse.json({
        error: result.error,
        wordpressError: result.wordpressError,
      }, { status: result.status });
    }

    if (!result.wordpressPublished) {
      return NextResponse.json({
        success: true,
        slug: result.finalSlug,
        company_name: result.cleanName,
        wordpressPublished: false,
        error: result.disabledReason,
      }, { status: 200 });
    }

    console.log(
      `[Publish Business Page] Published "${result.cleanName}" (${result.finalSlug})`,
    );

    return NextResponse.json({
      success: true,
      slug: result.finalSlug,
      company_name: result.cleanName,
      pageUrl: result.pageUrl,
      wp_data: result.wpData,
    }, { status: 200 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[Publish Business Page] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}