import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { decryptToken } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase environment variables missing');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * GET: Real-time WhatsApp verification code polling endpoint for the Dashboard
 * Allows the salon owner to copy the 6-digit Meta code into the Embedded Signup popup.
 */
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Database credentials missing' }, { status: 500 });
    }

    const supabase = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    });

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || !profile.tenant_id) {
      return NextResponse.json({ error: 'No active salon tenant found' }, { status: 403 });
    }

    const tenantId = profile.tenant_id;
    const { searchParams } = new URL(req.url);
    const consume = searchParams.get('consume') === 'true';

    // Find the latest active, unconsumed verification code for this tenant
    const nowIso = new Date().toISOString();
    const { data: codeRecord } = await supabaseAdmin
      .from('whatsapp_verification_codes')
      .select('id, code_enc, method, expires_at, created_at')
      .eq('tenant_id', tenantId)
      .eq('consumed', false)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!codeRecord) {
      return NextResponse.json({
        available: false,
        message: 'No active verification code received yet.',
      });
    }

    let plainCode = '';
    try {
      plainCode = decryptToken(codeRecord.code_enc);
    } catch {
      return NextResponse.json({ available: false, error: 'Failed to decrypt code' }, { status: 500 });
    }

    if (consume) {
      await supabaseAdmin
        .from('whatsapp_verification_codes')
        .update({ consumed: true })
        .eq('id', codeRecord.id);
    }

    return NextResponse.json({
      available: true,
      code: plainCode,
      method: codeRecord.method,
      expires_at: codeRecord.expires_at,
      created_at: codeRecord.created_at,
    });
  } catch (err: any) {
    console.error('[WhatsApp Verification Code GET] Error:', err);
    return NextResponse.json({ error: err.message || 'Error fetching verification code' }, { status: 500 });
  }
}
