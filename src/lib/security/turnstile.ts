/**
 * Cloudflare's published always-pass and always-fail test secrets.
 * These are not project credentials. Production uses CLOUDFLARE_TURNSTILE_SECRET_KEY.
 */
const ALWAYS_PASS_SECRET = '1x0000000000000000000000000000000AA';
const ALWAYS_FAIL_SECRET = '2x0000000000000000000000000000000AA';

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_ENV === 'production';
}

export function readTurnstileSecret(): string | undefined {
  return process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY || undefined;
}

export async function verifyTurnstileToken(
  token: string | null,
  remoteIp: string,
): Promise<{ ok: true } | { ok: false; status: number }> {
  if (!token) return { ok: false, status: 403 };

  const configured = readTurnstileSecret();
  if (isProduction() && !configured) {
    console.error('[Security] Turnstile secret is missing in production.');
    return { ok: false, status: 503 };
  }

  let secret = configured || ALWAYS_PASS_SECRET;
  if (!isProduction()) {
    if (token.startsWith('2x')) secret = ALWAYS_FAIL_SECRET;
    else if (token.startsWith('1x')) secret = ALWAYS_PASS_SECRET;
  }

  // The published dummy secrets have a fixed siteverify result.
  if (secret === ALWAYS_PASS_SECRET) return { ok: true };
  if (secret === ALWAYS_FAIL_SECRET) return { ok: false, status: 403 };

  try {
    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', token);
    form.set('remoteip', remoteIp);

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const result = (await response.json()) as { success?: boolean };
    if (!result.success) return { ok: false, status: 403 };
    return { ok: true };
  } catch {
    console.error('[Security] Turnstile verification could not be completed.');
    return { ok: false, status: 503 };
  }
}
