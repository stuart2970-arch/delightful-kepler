import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { consumeMemoryRateLimit } from '@/lib/security/billing-rate-limit';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
]);

export class OutboundUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundUrlError';
  }
}

function ipv4Blocked(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const normalised = ip.toLowerCase().replace(/^::ffff:/, '');
  if (normalised === '::1' || normalised === '::' || normalised === '0.0.0.0') return true;
  if (normalised.startsWith('fe80:') || normalised.startsWith('fc') || normalised.startsWith('fd')) return true;
  if (normalised.includes(':')) return false;
  const parts = normalised.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  return ipv4Blocked(parts);
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundUrlError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OutboundUrlError('Only http and https URLs are allowed');
  }
  const host = url.hostname.replace(/\.+$/, '').toLowerCase();
  if (
    !host
    || BLOCKED_HOSTS.has(host)
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
  ) {
    throw new OutboundUrlError('That address is not allowed');
  }
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new OutboundUrlError('That address is not allowed');
    return url;
  }
  const records = await lookup(host, { all: true, verbatim: true });
  if (records.length === 0 || records.some((record) => isBlockedAddress(record.address))) {
    throw new OutboundUrlError('That address is not allowed');
  }
  return url;
}

/** Follow redirects one hop at a time and re-check the destination each time. */
export async function fetchPublic(
  rawUrl: string,
  init: RequestInit = {},
  maxRedirects = 3,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const checked = await assertPublicHttpUrl(current);
    const response = await fetchImpl(checked.toString(), { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    current = new URL(location, checked).toString();
  }
  throw new OutboundUrlError('Too many redirects');
}

export function outboundFetchLimit(req?: Request): number {
  if (req && process.env.PLAYWRIGHT_TEST === 'true') {
    const raw = req.headers.get('x-test-outbound-rate-limit');
    if (raw != null && raw.trim() !== '') {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 1) return parsed;
    }
  }
  return 30;
}

export function consumeTenantOutboundLimit(tenantId: string, req?: Request): boolean {
  return consumeMemoryRateLimit(
    `outbound-fetch:${tenantId}`,
    outboundFetchLimit(req),
    60_000,
  );
}
