import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

export const VAPI_SECRET_HEADER = 'x-vapi-secret';

function isTestProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.PLAYWRIGHT_TEST === 'true' ||
    env.NODE_ENV === 'test' ||
    (env.APP_ENV || '').trim().toLowerCase() === 'test'
  );
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
  const expected = (env.VAPI_WEBHOOK_SECRET || '').trim();
  if (!expected) {
    if (isTestProcess(env)) {
      return { ok: true };
    }
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'VAPI_WEBHOOK_SECRET is not configured.' },
        { status: 503 },
      ),
    };
  }

  const provided = request.headers.get(VAPI_SECRET_HEADER) || '';
  if (!safeEqual(provided, expected)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true };
}
