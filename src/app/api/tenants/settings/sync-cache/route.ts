import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSuperAdmin } from '@/lib/auth/require-superadmin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const wpHeader = req.headers.get('x-styleflo-wp-secret') || req.headers.get('x-wp-secret');
    const expectedSecret = process.env.STYLEFLO_WP_API_SECRET;
    const isWpAuthorized = Boolean(
      expectedSecret &&
      wpHeader &&
      wpHeader.length === expectedSecret.length &&
      crypto.timingSafeEqual(Buffer.from(wpHeader), Buffer.from(expectedSecret))
    );

    if (!isWpAuthorized) {
      const auth = await requireSuperAdmin(req);
      if (!auth.ok) {
        return auth.response;
      }
    }

    const body = await req.json();
    const { tenant_slug } = body;

    if (!tenant_slug) {
      return NextResponse.json({ success: false, error: 'Missing tenant_slug' }, { status: 400 });
    }

    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL || 'https://styleflo.test';
    const wpApiUrl = `${wordpressSiteUrl}/wp-json/styleflo/v1/clear-cache`;
    const sharedSecret = process.env.STYLEFLO_WP_API_SECRET;
    if (!sharedSecret) {
      return NextResponse.json({ success: false, error: 'STYLEFLO_WP_API_SECRET is not configured' }, { status: 500 });
    }
    
    const payload = JSON.stringify({ tenant_slug });

    const signature = crypto
      .createHmac('sha256', sharedSecret)
      .update(payload)
      .digest('hex');

    const wpResponse = await fetch(wpApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-StyleFlo-Signature': signature
      },
      body: payload
    });

    if (!wpResponse.ok) {
      const errText = await wpResponse.text();
      throw new Error(`WordPress rejection: ${errText}`);
    }

    const wpResult = await wpResponse.json();
    return NextResponse.json({ success: true, wp_data: wpResult }, { status: 200 });

  } catch (error: any) {
    console.error('[Sync Cache API] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
