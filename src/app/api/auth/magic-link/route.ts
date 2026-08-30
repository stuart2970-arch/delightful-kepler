import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
        { redirectUrl: '/dashboard', error: 'Valid email address required' },
        { status: 200, headers: corsHeaders }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.warn('[Magic Link Route] Supabase admin credentials missing, falling back to /dashboard redirect.');
      return NextResponse.json(
        { redirectUrl: '/dashboard' },
        { status: 200, headers: corsHeaders }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const origin = request.headers.get('origin') || request.headers.get('referer') || 'https://app.styleflo.ai';
    const cleanOrigin = origin.replace(/\/$/, '');
    const redirectUrl = `${cleanOrigin}/dashboard`;

    console.log(`[Magic Link Route] Generating magic link for ${email}...`);

    // 1. Attempt to generate magic link directly for user
    let { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: {
        redirectTo: redirectUrl,
      },
    });

    // 2. If user doesn't exist in Supabase auth yet, create user and retry link generation
    if (error && (error.message.includes('User not found') || error.status === 404)) {
      console.log(`[Magic Link Route] User ${email} not found in Auth. Creating account...`);
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        email_confirm: true,
        user_metadata: {
          full_name: name || email.split('@')[0],
          source: 'onboarding_flobot',
        },
      });

      if (!createError && newUser?.user) {
        console.log(`[Magic Link Route] Account created for ${email}. Re-generating magic link...`);
        const retryRes = await supabaseAdmin.auth.admin.generateLink({
          type: 'magiclink',
          email: email,
          options: {
            redirectTo: redirectUrl,
          },
        });
        data = retryRes.data;
        error = retryRes.error;
      }
    }

    const actionLink = data?.properties?.action_link;

    if (actionLink) {
      console.log(`[Magic Link Route] Successfully generated instant action link for ${email}`);
      return NextResponse.json(
        { success: true, redirectUrl: actionLink },
        { status: 200, headers: corsHeaders }
      );
    }

    // 3. Fallback: Request magic link email via OTP if admin link generation failed
    console.warn('[Magic Link Route] Could not generate direct action link. Attempting OTP email fallback...', error?.message);
    await supabaseAdmin.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectUrl,
      },
    }).catch((otpErr) => console.warn('[Magic Link Route] OTP fallback error:', otpErr.message));

    return NextResponse.json(
      { success: true, redirectUrl: '/dashboard', message: 'Magic link sent' },
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
