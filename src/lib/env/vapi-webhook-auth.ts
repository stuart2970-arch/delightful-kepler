import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

export const VAPI_SECRET_HEADER = 'x-vapi-secret';

export function shouldBypassVapiWebhookSignature(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PLAYWRIGHT_TEST === 'true';
}

function vapiSecretHeaderPresent(request: Request): boolean {
  if (request.headers.get(VAPI_SECRET_HEADER) !== null) return true;
  const authorization = request.headers.get('authorization') || '';
  return /^Bearer\s+/i.test(authorization);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function verifyVapiWebhookSecret(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; response: NextResponse } {
  if (shouldBypassVapiWebhookSignature(env) && !vapiSecretHeaderPresent(request)) {
    return { ok: true };
  }

  const expected = (env.VAPI_WEBHOOK_SECRET || '').trim();
  if (!expected) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'VAPI_WEBHOOK_SECRET is not configured.' },
        { status: 503 },
      ),
    };
  }

  const headerSecret = (request.headers.get(VAPI_SECRET_HEADER) || '').trim();
  const authorization = request.headers.get('authorization') || '';
  const bearer = /^Bearer\s+/i.test(authorization)
    ? authorization.replace(/^Bearer\s+/i, '').trim()
    : '';
  const matches = [headerSecret, bearer].filter(Boolean).some((candidate) => safeEqual(candidate, expected));
  if (!matches) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true };
}
