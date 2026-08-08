import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('[Tenant Created Webhook] Triggered with payload:', body);

    // Support both Supabase database webhooks (body.record) and direct JSON payloads
    const record = body.record || body;
    const { slug, company_name } = record;

    if (!slug) {
      console.warn('[Tenant Created Webhook] Missing slug in record:', record);
      return NextResponse.json({ error: 'Missing slug in payload record' }, { status: 400 });
    }

    const name = company_name || record.name || 'Unnamed Business';

    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL || 'https://styleflo.ai';
    const wpApiUrl = `${wordpressSiteUrl}/wp-json/styleflo/v1/create-business`;
    const token = process.env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN || 'd1f5e82b79a83604f05c48b2';

    console.log(`[Tenant Created Webhook] Syncing tenant "${name}" with slug "${slug}" to WordPress: ${wpApiUrl}`);

    const wpResponse = await fetch(wpApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        slug: slug,
        title: name,
        token: token
      })
    });

    if (!wpResponse.ok) {
      const errText = await wpResponse.text();
      console.error('[Tenant Created Webhook] WordPress creation failed:', errText);
      return NextResponse.json({ error: `WordPress rejection: ${errText}` }, { status: wpResponse.status });
    }

    const wpResult = await wpResponse.json();
    console.log('[Tenant Created Webhook] WordPress page created successfully:', wpResult);
    return NextResponse.json({ success: true, wp_data: wpResult }, { status: 200 });

  } catch (error: any) {
    console.error('[Tenant Created Webhook] Unhandled error during tenant sync:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
