import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireTenantRole } from '@/lib/auth/require-tenant-role';
import { publishBusinessPageForTenant } from '@/lib/tenants/publish-business-page';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTenantRole(req, ['owner', 'admin']);
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const { tenantId, businessName } = body;

    if (!tenantId || !businessName || !businessName.trim()) {
      return NextResponse.json({ error: 'Tenant ID and Business Name are required.' }, { status: 400 });
    }

    if (String(tenantId) !== auth.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server configuration missing' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const result = await publishBusinessPageForTenant(supabase, String(tenantId), businessName);
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
        nameReview: result.nameReview ?? null,
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