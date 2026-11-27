/**
 * STYL-423: WordPress parent host for styleflo.ai/app/ iframe embeds.
 * Server-safe (no sessionStorage / window).
 */

import { isStagingAppEnv, publicAppPath } from './public-app-url';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

const PRODUCTION_EMBED_PARENT = 'https://styleflo.ai';
const STAGING_EMBED_PARENT = 'https://staging.styleflo.ai';

function originFromUrl(raw: string | undefined | null): string | null {
  const value = (raw || '').trim();
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function resolveEmbedParentOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = originFromUrl(env.NEXT_PUBLIC_EMBED_PARENT_URL);
  if (fromEnv) return stripTrailingSlash(fromEnv);
  const wp = originFromUrl(env.WORDPRESS_SITE_URL);
  if (wp) return stripTrailingSlash(wp);
  if (isStagingAppEnv(env)) return STAGING_EMBED_PARENT;
  return PRODUCTION_EMBED_PARENT;
}

export function embedParentAppEntryUrl(
  sfPath: string,
  params: Record<string, string | undefined> = {},
  env: NodeJS.ProcessEnv = process.env,
): string {
  const parent = resolveEmbedParentOrigin(env);
  const path = sfPath.startsWith('/') ? sfPath : `/${sfPath}`;
  const parsed = new URL(path, 'http://embed.local');
  const search = new URLSearchParams();
  search.set('sf_path', parsed.pathname);
  parsed.searchParams.forEach((value, key) => {
    search.set(key, value);
  });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  return `${parent}/app/?${search.toString()}`;
}

/**
 * When NEXT_PUBLIC_EMBED_EMAIL_VIA_PARENT=true, emailed links land on the WP /app/ shell.
 * Default off so cross-device token_hash confirmation (STYL-420) stays on the app origin.
 */
export function embedAwarePublicPath(
  inAppPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const viaParent = (env.NEXT_PUBLIC_EMBED_EMAIL_VIA_PARENT || '').trim().toLowerCase() === 'true';
  if (viaParent) {
    return embedParentAppEntryUrl(inAppPath, {}, env);
  }
  return publicAppPath(inAppPath, env);
}

export { isAllowedEmbedParentReturnUrl } from './public-app-url';
