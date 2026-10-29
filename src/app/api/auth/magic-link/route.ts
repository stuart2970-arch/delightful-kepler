import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isAllowedOrigin } from '@/lib/auth/request-origin';
import {
  MAGIC_LINK_LIMITS,
  clientIp,
  consumeAuthRateLimit,
  hashEmail,
} from '@/lib/security/auth-rate-limit';
import { verifyTurnstileToken } from '@/lib/security/turnstile';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status });
}

/**
 * The emailed link lands on /login so the browser can read the session
 * fragment. The redirect is chosen on the server, never from the request body.
 */
function emailRedirectTo(request: Request): string {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const hostname = host.split(':')[0];
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocal) {
    const proto = request.headers.get('x-forwarded-proto') || 'http';
    return `${proto}://${host}/login`;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      return `${new URL(appUrl).origin}/login`;
    } catch {
      // Fall through to the production app origin.
    }
  }
  return 'https://app.styleflo.ai/login';
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    console.warn('[Magic Link] Rejected foreign origin.');
    return json({ ok: false }, 403);
  }

  const ip = clientIp(request);
  const turnstile = await verifyTurnstileToken(request.headers.get('x-turnstile-token'), ip);
  if (!turnstile.ok) {
    return json({ ok: false }, turnstile.status);
  }

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || body.clientEmail || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, error: 'Valid email address required' }, 400);
  }

  const ipAllowed = await consumeAuthRateLimit(
    `auth:magic:ip:${ip}`,
    MAGIC_LINK_LIMITS.ip,
    MAGIC_LINK_LIMITS.windowSeconds,
  );
  const emailAllowed = await consumeAuthRateLimit(
    `auth:magic:email:${hashEmail(email)}`,
    MAGIC_LINK_LIMITS.email,
    MAGIC_LINK_LIMITS.windowSeconds,
  );
  if (!ipAllowed || !emailAllowed) {
    console.warn('[Magic Link] Rate limited.');
    return json({ ok: false }, 429);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    console.error('[Magic Link] Auth is not configured.');
    return json({ ok: false }, 503);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: emailRedirectTo(request),
    },
  });

  if (error) {
    console.warn('[Magic Link] Sign-in email was not dispatched.');
  } else {
    console.info('[Magic Link] Sign-in email accepted.');
  }

  return json({ ok: true }, 200);
}
