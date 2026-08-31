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

    // Method 1: Execute RPC check_email_exists in Postgres if available
    try {
      const { data: rpcExists, error: rpcError } = await supabaseAdmin.rpc('check_email_exists', {
        p_email: email,
      });

      if (!rpcError && rpcExists === true) {
        console.log(`[Check Email Route] Email ${email} confirmed via RPC check_email_exists.`);
        return NextResponse.json({ exists: true, email }, { status: 200, headers: corsHeaders });
      }
    } catch (e) {
      console.warn('[Check Email Route] RPC call fallback:', e);
    }

    // Method 2: Inspect auth.users via Supabase Auth Admin API
    try {
      const { data: usersData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
      if (!listError && usersData?.users) {
        const found = usersData.users.some((u) => u.email?.trim().toLowerCase() === email);
        if (found) {
          console.log(`[Check Email Route] Email ${email} found in auth.users list.`);
          return NextResponse.json({ exists: true, email }, { status: 200, headers: corsHeaders });
        }
      }
    } catch (e) {
      console.warn('[Check Email Route] listUsers fallback:', e);
    }

    // Method 3: Probe Supabase Auth generateLink for magic link token
    try {
      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: email,
      });

      if (linkData?.user || (linkError && !linkError.message.includes('User not found') && linkError.status !== 404)) {
        console.log(`[Check Email Route] Email ${email} detected via generateLink probe.`);
        return NextResponse.json({ exists: true, email }, { status: 200, headers: corsHeaders });
      }
    } catch (e) {
      console.warn('[Check Email Route] generateLink probe fallback:', e);
    }

    // Method 4: Check staff table for pre-invited members
    try {
      const { data: staffMatch } = await supabaseAdmin
        .from('staff')
        .select('id')
        .ilike('email', email)
        .limit(1)
        .maybeSingle();

      if (staffMatch) {
        console.log(`[Check Email Route] Email ${email} found in staff table.`);
        return NextResponse.json({ exists: true, email }, { status: 200, headers: corsHeaders });
      }
    } catch (e) {
      console.warn('[Check Email Route] staff table check fallback:', e);
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
