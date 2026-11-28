import { NextResponse } from 'next/server';
import twilio from 'twilio';

export const TWILIO_SIGNATURE_HEADER = 'x-twilio-signature';

export function shouldBypassTwilioWebhookSignature(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PLAYWRIGHT_TEST === 'true';
}

/**
 * Public URL Twilio signed against (respects App Hosting x-forwarded-* headers).
 */
export function publicTwilioWebhookUrl(request: Request): string {
  const incoming = new URL(request.url);
  const proto = (request.headers.get('x-forwarded-proto') || incoming.protocol.replace(':', '') || 'https')
    .split(',')[0]
    .trim();
  const host = (
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    incoming.host
  )
    .split(',')[0]
    .trim();
  return `${proto}://${host}${incoming.pathname}${incoming.search}`;
}

export async function extractTwilioWebhookParams(request: Request): Promise<Record<string, string>> {
  const params: Record<string, string> = {};
  const url = new URL(request.url);
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  const method = request.method.toUpperCase();
  if (method !== 'POST' && method !== 'PUT') {
    return params;
  }

  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  try {
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const bodyText = await request.text();
      const parsed = new URLSearchParams(bodyText);
      parsed.forEach((value, key) => {
        params[key] = value;
      });
      return params;
    }
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      formData.forEach((value, key) => {
        if (typeof value === 'string') params[key] = value;
      });
      return params;
    }
    const bodyText = await request.text();
    if (bodyText.includes('=')) {
      const parsed = new URLSearchParams(bodyText);
      parsed.forEach((value, key) => {
        params[key] = value;
      });
    }
  } catch {
    // Leave query params only.
  }
  return params;
}

export async function verifyTwilioWebhookRequest(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (shouldBypassTwilioWebhookSignature(env)) {
    return { ok: true };
  }

  const authToken = (env.TWILIO_AUTH_TOKEN || '').trim();
  if (!authToken) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'TWILIO_AUTH_TOKEN is not configured.' }, { status: 503 }),
    };
  }

  const signature = (request.headers.get(TWILIO_SIGNATURE_HEADER) || '').trim();
  if (!signature) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  const params = await extractTwilioWebhookParams(request.clone());
  const webhookUrl = publicTwilioWebhookUrl(request);
  const valid = twilio.validateRequest(authToken, signature, webhookUrl, params);
  if (!valid) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { ok: true };
}