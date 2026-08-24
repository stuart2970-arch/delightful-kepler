import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // 1. Authenticate user session
    const authClient = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {}
      },
    });

    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Authorize: Only Superadmins can access global platform settings
    const { data: profile } = await authClient
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single();

    if (!profile || !profile.is_super_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 3. Parse request payload
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

    // 4. Generate HMAC signature to verify authorization
    const signature = crypto
      .createHmac('sha256', sharedSecret)
      .update(payload)
      .digest('hex');

    // 5. Dispatch the authenticated flush command to WordPress
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
