/**
 * STYL-226: single origin for login, magic-link, checkout, and OAuth redirects.
 * Never fall back to the production app host when APP_ENV / NEXT_PUBLIC_ENV is staging.
 */

const PRODUCTION_APP_ORIGIN = 'https://app.styleflo.ai';
const STAGING_APP_ORIGIN = 'https://staging.styleflo.ai';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function originFromUrl(raw: string | undefined | null): string | null {
  const value = (raw || '').trim();
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isStagingAppEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const appEnv = (env.APP_ENV || env.NEXT_PUBLIC_ENV || '').trim().toLowerCase();
  return appEnv === 'staging';
}

/**
 * Server-side origin resolution. Used by API routes and by tests.
 * Unset APP_ENV on Cloud Run (NODE_ENV=production) still lands on production.
 */
export function resolveServerPublicAppOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = originFromUrl(env.NEXT_PUBLIC_APP_URL) || originFromUrl(env.NEXT_PUBLIC_SITE_URL);
  if (fromEnv) return fromEnv;
  if (isStagingAppEnv(env)) return STAGING_APP_ORIGIN;
  return PRODUCTION_APP_ORIGIN;
}

/**
 * Browser: the page origin. Server: NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_SITE_URL.
 */
export function getPublicAppOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return stripTrailingSlash(window.location.origin);
  }
  return resolveServerPublicAppOrigin(env);
}

export function publicAppPath(
  pathname: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const origin = getPublicAppOrigin(env);
  if (!pathname) return origin;
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${origin}${path}`;
}

function originOf(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** True when `candidate` is an absolute http(s) URL on this app's public origin. */
export function isSameOriginPublicUrl(
  candidate: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!candidate || typeof candidate !== 'string') return false;
  const candidateOrigin = originOf(candidate.trim());
  if (!candidateOrigin) return false;
  return candidateOrigin === getPublicAppOrigin(env);
}

/**
 * Use a client-supplied return URL only when it is same-origin.
 * Off-origin values (open redirects) fall back to `fallback`.
 */
export function safePublicReturnUrl(
  candidate: string | undefined | null,
  fallback: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = typeof candidate === 'string' ? candidate.trim() : '';
  if (!isSameOriginPublicUrl(value, env)) return fallback;
  return new URL(value).href;
}
