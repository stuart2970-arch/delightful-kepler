import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

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

    const cleanName = businessName.trim();
    let baseSlug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!baseSlug) baseSlug = 'business';

    // Guarantee uniqueness for the updated slug, appending sequential numbers if needed
    let finalSlug = baseSlug;
    let counter = 1;
    while (true) {
      const { data: existing } = await supabase
        .from('tenants')
        .select('id')
        .eq('slug', finalSlug)
        .neq('id', tenantId)
        .maybeSingle();

      if (!existing) break;
      finalSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    // 1. Overwrite placeholder company_name and update slug in Supabase
    const { error: updateErr } = await supabase
      .from('tenants')
      .update({
        company_name: cleanName,
        slug: finalSlug
      })
      .eq('id', tenantId);

    if (updateErr) {
      console.error('[Publish Business Page] Supabase update error:', updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 2. Dispatch manual creation / sync call to WordPress
    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL || 'https://styleflo.ai';
    const wpApiUrl = `${wordpressSiteUrl}/wp-json/styleflo/v1/create-business`;
    const token = process.env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN || 'd1f5e82b79a83604f05c48b2';

    console.log(`[Publish Business Page] Dispatching page creation for "${cleanName}" (${finalSlug}) to WordPress: ${wpApiUrl}`);

    const wpRes = await fetch(wpApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: finalSlug,
        title: cleanName,
        token: token
      })
    });

    if (!wpRes.ok) {
      const errText = await wpRes.text();
      console.error('[Publish Business Page] WordPress rejection:', errText);
      return NextResponse.json({ error: `WordPress rejection: ${errText}` }, { status: wpRes.status });
    }

    const wpResult = await wpRes.json();
    const pageUrl = `${wordpressSiteUrl}/business/${finalSlug}`;

    return NextResponse.json({
      success: true,
      slug: finalSlug,
      company_name: cleanName,
      pageUrl: pageUrl,
      wp_data: wpResult
    }, { status: 200 });

  } catch (error: any) {
    console.error('[Publish Business Page] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
