'use client';

import { getPublicAppOrigin, publicAppPath } from './public-app-url';
import { resolveEmbedParentOrigin, embedParentAppEntryUrl } from './embed-parent';

export const STYLEFLO_EMBED_STORAGE_KEY = 'styleflo_embed_mode';
export const STYLEFLO_EMBED_VALUE = 'styleflo';
export const STYLEFLO_EMBED_HELLO = 'STYLEFLO_EMBED_HELLO';
export const STYLEFLO_EMBED_ACK = 'STYLEFLO_EMBED_ACK';
export const STYLEFLO_AUTH_DONE = 'STYLEFLO_AUTH_DONE';
export const STYLEFLO_OAUTH_DONE = 'STYLEFLO_OAUTH_DONE';

const pinnedParentOrigins = (): Set<string> => {
  const origins = new Set<string>();
  try {
    origins.add(resolveEmbedParentOrigin());
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    origins.add(window.location.origin);
  }
  return origins;
};

export function isFramed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function readEmbedFlagFromStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(STYLEFLO_EMBED_STORAGE_KEY) === STYLEFLO_EMBED_VALUE;
  } catch {
    return false;
  }
}

export function persistEmbedMode(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STYLEFLO_EMBED_STORAGE_KEY, STYLEFLO_EMBED_VALUE);
  } catch {
    // ignore
  }
}

export function initEmbedFromQuery(searchParams: URLSearchParams): boolean {
  const embed = searchParams.get('embed');
  if (embed === 'styleflo' || embed === 'true') {
    persistEmbedMode();
    return true;
  }
  return false;
}

export function isStylefloEmbed(): boolean {
  if (typeof window === 'undefined') return false;
  if (readEmbedFlagFromStorage()) return true;
  const params = new URLSearchParams(window.location.search);
  return initEmbedFromQuery(params);
}

export function isAllowedEmbedParentOrigin(origin: string): boolean {
  if (!origin) return false;
  return pinnedParentOrigins().has(origin);
}

export function installEmbedHelloListener(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onMessage = (event: MessageEvent) => {
    if (!event.data || event.data.type !== STYLEFLO_EMBED_HELLO) return;
    if (!isAllowedEmbedParentOrigin(event.origin)) return;
    persistEmbedMode();
    try {
      event.source?.postMessage({ type: STYLEFLO_EMBED_ACK }, { targetOrigin: event.origin });
    } catch {
      // ignore
    }
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

export function parseAppPathWithQuery(path: string): { pathname: string; params: Record<string, string> } {
  const parsed = new URL(path.startsWith('/') ? path : `/${path}`, 'http://embed.local');
  const params: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return { pathname: parsed.pathname, params };
}

export function embeddedReturnUrl(
  path: string,
  extraParams: Record<string, string | undefined> = {},
): string {
  const { pathname, params } = parseAppPathWithQuery(path);
  const merged = { ...params, ...extraParams };
  if (!isStylefloEmbed()) {
    const base = publicAppPath(pathname);
    const url = new URL(base);
    Object.entries(merged).forEach(([key, value]) => {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    });
    return url.href;
  }
  return embedParentAppEntryUrl(pathname, merged);
}

export function appOriginForPostMessage(): string {
  return getPublicAppOrigin();
}

export function resolveSfPathRedirect(searchParams: URLSearchParams): string | null {
  const sfPath = searchParams.get('sf_path');
  if (!sfPath || !sfPath.startsWith('/') || sfPath.startsWith('//')) return null;
  const parsed = new URL(sfPath, 'http://embed.local');
  const merged = new URLSearchParams(parsed.search);
  searchParams.forEach((value, key) => {
    if (key === 'sf_path' || key === 'embed') return;
    if (!merged.has(key)) merged.set(key, value);
  });
  const query = merged.toString();
  return query ? `${parsed.pathname}?${query}` : parsed.pathname;
}

/** Normalised in-app path + search for sf_path redirect comparisons (no origin). */
export function normalizedAppPathSearch(pathname: string, search: string): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const qs = search.startsWith('?') ? search : search ? `?${search}` : '';
  return `${path}${qs}`;
}