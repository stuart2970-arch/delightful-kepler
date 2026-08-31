import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();

    if (!email || !/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(email)) {
      return NextResponse.json(
        { exists: false, error: 'Valid email address required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.warn('[Check Email Route] Missing Supabase admin keys');
      return NextResponse.json({ exists: false }, { status: 200, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Check profiles table for matching email
    const { data: profileMatch } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .ilike('email', email)
      .limit(1)
      .maybeSingle();

    if (profileMatch) {
      console.log(`[Check Email Route] Email ${email} found in profiles table.`);
      return NextResponse.json({ exists: true, email }, { status: 200, headers: corsHeaders });
    }

    // 2. Check tenants table for owner_email match
    const { data: tenantMatch } = await supabaseAdmin
      .from('tenants')
      .select('id, owner_email')
      .ilike('owner_email', email)
      .limit(1)
      .maybeSingle();

    if (tenantMatch) {
      console.log(`[Check Email Route] Email ${email} found in tenants table owner_email.`);
      return NextResponse.json({ exists: true, email }, { status: 200, headers: corsHeaders });
    }

    // 3. Probe Supabase Auth admin generateLink to detect existing user account
    const { error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
    });

    const isUserFound = !linkError || (!linkError.message.includes('User not found') && linkError.status !== 404);

    if (isUserFound) {
      console.log(`[Check Email Route] Email ${email} detected in Supabase auth.users.`);
      return NextResponse.json({ exists: true, email }, { status: 200, headers: corsHeaders });
    }

    return NextResponse.json({ exists: false, email }, { status: 200, headers: corsHeaders });
  } catch (err: any) {
    console.error('[Check Email Route Error]', err);
    return NextResponse.json(
      { exists: false, error: err?.message || 'Server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
