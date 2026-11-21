import { resolveServerPublicAppOrigin } from '@/lib/env/public-app-url';

function normalizeHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).hostname.replace(/^www\./, '');
  } catch {
    return trimmed.replace(/^www\./, '').split('/')[0].split(':')[0];
  }
}

export function embedRequestOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  }
  const referer = request.headers.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function configuredAppOrigins(): Set<string> {
  const origins = new Set<string>();
  const candidates = [
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  ];
  for (const value of candidates) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // ignore malformed env
    }
  }
  try {
    origins.add(new URL(resolveServerPublicAppOrigin()).origin);
  } catch {
    // ignore
  }
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://localhost:3001');
    origins.add('http://127.0.0.1:3000');
    origins.add('http://127.0.0.1:3001');
  }
  return origins;
}

/**
 * Widget calls may come from the app origin (script on StyleFlo) or from the
 * tenant's registered website domain. When tenants.domain is unset, any
 * browser origin is allowed so salons are not blocked before they save a URL.
 */
export function isAllowedEmbedOrigin(request: Request, tenantDomain: string | null | undefined): boolean {
  const requestOrigin = embedRequestOrigin(request);
  if (!requestOrigin) return true;

  if (configuredAppOrigins().has(requestOrigin)) return true;

  const host = normalizeHost(requestOrigin);
  const allowed = normalizeHost(tenantDomain || '');
  if (!allowed) return true;

  return host === allowed || host.endsWith(`.${allowed}`);
}