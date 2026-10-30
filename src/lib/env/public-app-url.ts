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
