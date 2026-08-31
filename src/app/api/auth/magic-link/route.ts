import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = (body.email || body.clientEmail || '').trim();
    const name = (body.name || body.clientName || '').trim();

    if (!email || !/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(email)) {
      return NextResponse.json(
        { redirectUrl: '/login', error: 'Valid email address required' },
        { status: 200, headers: corsHeaders }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      console.warn('[Magic Link Route] Supabase environment variables missing.');
      return NextResponse.json(
        { redirectUrl: '/login' },
        { status: 200, headers: corsHeaders }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    console.log(`[Magic Link Route] Ensuring user account exists for ${email}...`);

    // 1. Ensure user exists in Supabase Auth and generate magic link token
    let { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
    });

    if (linkError && (linkError.message.includes('User not found') || linkError.status === 404)) {
      console.log(`[Magic Link Route] Creating account for ${email}...`);
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        email_confirm: true,
        user_metadata: {
          full_name: name || email.split('@')[0],
          source: 'onboarding_flobot',
        },
      });

      if (!createError && newUser?.user) {
        const retryRes = await supabaseAdmin.auth.admin.generateLink({
          type: 'magiclink',
          email: email,
        });
        linkData = retryRes.data;
        linkError = retryRes.error;
      }
    }

    const emailOtp = linkData?.properties?.email_otp;
    const hashedToken = linkData?.properties?.hashed_token;

    // 2. Server-side session authentication using createServerClient so cookies are set directly on response!
    const cookieStore = await cookies();
    const supabaseServer = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Safe to ignore in Route Handlers
          }
        },
      },
    });

    // 3. Attempt server-side OTP verification with email_otp
    if (emailOtp) {
      console.log(`[Magic Link Route] Verifying OTP server-side for ${email}...`);
      let { data: verifyData, error: verifyError } = await supabaseServer.auth.verifyOtp({
        email,
        token: emailOtp,
        type: 'email',
      });

      if (verifyError) {
        const fallbackRes = await supabaseServer.auth.verifyOtp({
          email,
          token: emailOtp,
          type: 'magiclink',
        });
        verifyData = fallbackRes.data;
        verifyError = fallbackRes.error;
      }

      if (!verifyError && verifyData?.session) {
        console.log(`[Magic Link Route] Successfully authenticated session for ${email}. Session cookies set!`);
        return NextResponse.json(
          { success: true, redirectUrl: '/dashboard' },
          { status: 200, headers: corsHeaders }
        );
      } else {
        console.warn('[Magic Link Route] verifyOtp by emailOtp failed:', verifyError?.message);
      }
    }

    // 4. Attempt server-side verification with hashed_token
    if (hashedToken) {
      console.log(`[Magic Link Route] Verifying token_hash server-side for ${email}...`);
      const hashRes = await supabaseServer.auth.verifyOtp({
        token_hash: hashedToken,
        type: 'magiclink',
      });

      if (!hashRes.error && hashRes.data?.session) {
        console.log(`[Magic Link Route] Successfully authenticated session via token_hash for ${email}. Session cookies set!`);
        return NextResponse.json(
          { success: true, redirectUrl: '/dashboard' },
          { status: 200, headers: corsHeaders }
        );
      } else {
        console.warn('[Magic Link Route] verifyOtp by token_hash failed:', hashRes.error?.message);
      }
    }

    // 5. Fallback: Return action_link if direct server session creation failed
    const actionLink = linkData?.properties?.action_link;
    if (actionLink) {
      console.log(`[Magic Link Route] Fallback to action_link: ${actionLink}`);
      return NextResponse.json(
        { success: true, redirectUrl: actionLink },
        { status: 200, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      { redirectUrl: '/dashboard' },
      { status: 200, headers: corsHeaders }
    );
  } catch (err: any) {
    console.error('[Magic Link Route] Error:', err);
    return NextResponse.json(
      { redirectUrl: '/dashboard', error: err?.message || 'Internal error' },
      { status: 200, headers: corsHeaders }
    );
  }
}
