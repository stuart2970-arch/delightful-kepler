import crypto from 'crypto';

export type MetaSignedRequestResult =
  | { ok: true; userId: string }
  | { ok: false; status: 400 | 401; error: string };

function base64UrlDecode(input: string): Buffer | null {
  if (!input || /[^A-Za-z0-9_-]/.test(input)) return null;
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  try {
    const decoded = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a Meta signed_request. The signature is HMAC-SHA256 over the
 * base64url payload, using the trimmed app secret, compared in constant time.
 * A missing or whitespace-only secret fails closed.
 */
export function verifyMetaSignedRequest(
  signedRequest: string,
  appSecret: string | undefined,
): MetaSignedRequestResult {
  const secret = (appSecret ?? '').trim();
  if (!secret) {
    console.error(
      '[Meta Data Deletion] META_APP_SECRET is missing or whitespace-only; rejecting signed_request',
    );
    return {
      ok: false,
      status: 401,
      error: 'META_APP_SECRET is missing or whitespace-only',
    };
  }

  const parts = signedRequest.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, status: 400, error: 'Malformed signed_request' };
  }

  const [encodedSignature, encodedPayload] = parts;
  const provided = base64UrlDecode(encodedSignature);
  if (!provided) {
    return { ok: false, status: 400, error: 'Malformed signed_request' };
  }

  const expected = crypto.createHmac('sha256', secret).update(encodedPayload).digest();
  if (provided.length !== expected.length) {
    return { ok: false, status: 401, error: 'Invalid signed_request signature' };
  }
  const matches = crypto.timingSafeEqual(provided, expected);
  if (!matches) {
    return { ok: false, status: 401, error: 'Invalid signed_request signature' };
  }

  let payload: unknown;
  try {
    const json = base64UrlDecode(encodedPayload);
    if (!json) return { ok: false, status: 400, error: 'Malformed signed_request' };
    payload = JSON.parse(json.toString('utf8'));
  } catch {
    return { ok: false, status: 400, error: 'Malformed signed_request' };
  }

  if (!payload || typeof payload !== 'object') {
    return { ok: false, status: 400, error: 'Malformed signed_request' };
  }

  const record = payload as { algorithm?: unknown; user_id?: unknown };
  if (record.algorithm !== 'HMAC-SHA256') {
    return { ok: false, status: 400, error: 'Malformed signed_request' };
  }

  const userId =
    typeof record.user_id === 'number' && Number.isFinite(record.user_id)
      ? String(record.user_id)
      : typeof record.user_id === 'string'
        ? record.user_id.trim()
        : '';
  if (!userId) {
    return { ok: false, status: 400, error: 'Malformed signed_request' };
  }

  return { ok: true, userId };
}
