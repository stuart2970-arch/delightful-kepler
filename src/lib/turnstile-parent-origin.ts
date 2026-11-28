/**
 * Turnstile iframe postMessage targets must not follow an attacker-controlled
 * parent_origin when it disagrees with document.referrer. StyleFlo infra hosts
 * are allowlisted for mobile Chrome when referrer is stripped (STYL-361).
 *
 * Keep public/turnstile.html parentTargetOrigin() in sync with this module.
 */

const EXACT_ORIGINS = new Set([
  'https://styleflo.ai',
  'http://styleflo.ai',
  'https://staging.styleflo.ai',
  'http://staging.styleflo.ai',
  'https://styleflo.test',
  'http://styleflo.test',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
]);

const HOST_SUFFIXES = ['.styleflo.ai', '.hosted.app', '.web.app', '.styleflo.test'];

export function normalizeBrowserOrigin(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function originFromReferrer(referrer: string | null | undefined): string | null {
  const trimmed = (referrer || '').trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

export function isAllowedTurnstileParentOrigin(origin: string | null | undefined): boolean {
  const normalized = normalizeBrowserOrigin(origin);
  if (!normalized) return false;
  if (EXACT_ORIGINS.has(normalized)) return true;

  let host = '';
  try {
    host = new URL(normalized).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (host === 'styleflo.ai' || host === 'styleflo.test') return true;

  return HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export type TurnstilePostMessageTarget =
  | { ok: true; targetOrigin: string }
  | { ok: false; code: string };

/**
 * Choose the postMessage target for turnstile.html.
 * Referrer wins when present; otherwise allowlisted parent_origin only.
 */
export function resolveTurnstilePostMessageTarget(
  parentOriginParam: string | null | undefined,
  referrer: string | null | undefined,
): TurnstilePostMessageTarget {
  const declared = normalizeBrowserOrigin(parentOriginParam);
  const fromReferrer = originFromReferrer(referrer);

  if (fromReferrer) {
    if (declared && declared !== fromReferrer) {
      return { ok: false, code: 'parent_origin_mismatch' };
    }
    return { ok: true, targetOrigin: fromReferrer };
  }

  if (declared && isAllowedTurnstileParentOrigin(declared)) {
    return { ok: true, targetOrigin: declared };
  }

  return { ok: false, code: 'invalid_parent_origin' };
}