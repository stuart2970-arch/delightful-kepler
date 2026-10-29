import { NextResponse } from 'next/server';
import { isAllowedOrigin } from '@/lib/auth/request-origin';
import {
  CHECK_EMAIL_LIMITS,
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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

/**
 * Kept so older clients do not 404. The body is the same for every valid
 * address: this route does not look up accounts.
 */
export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    console.warn('[Check Email] Rejected foreign origin.');
    return json({ ok: false }, 403);
  }

  const ip = clientIp(request);
  const turnstile = await verifyTurnstileToken(request.headers.get('x-turnstile-token'), ip);
  if (!turnstile.ok) {
    return json({ ok: false }, turnstile.status);
  }

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, error: 'Valid email address required' }, 400);
  }

  const ipAllowed = await consumeAuthRateLimit(
    `auth:check:ip:${ip}`,
    CHECK_EMAIL_LIMITS.ip,
    CHECK_EMAIL_LIMITS.windowSeconds,
  );
  const emailAllowed = await consumeAuthRateLimit(
    `auth:check:email:${hashEmail(email)}`,
    CHECK_EMAIL_LIMITS.email,
    CHECK_EMAIL_LIMITS.windowSeconds,
  );
  if (!ipAllowed || !emailAllowed) {
    console.warn('[Check Email] Rate limited.');
    return json({ ok: false }, 429);
  }

  return json({ ok: true }, 200);
}
