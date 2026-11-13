import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, interceptors } from 'undici';
import { consumeMemoryRateLimit } from '@/lib/security/billing-rate-limit';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
]);

export const OUTBOUND_FINAL_URL = 'x-outbound-final-url';

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
  if (a >= 224) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function ipv4FromHextets(hi: number, lo: number): number[] {
  return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
}

/** Expand a textual IPv6 address, including an embedded dotted IPv4 tail, to 8 hextets. */
function parseIpv6(raw: string): number[] | null {
  let text = raw.trim().toLowerCase().replace(/%.*/, '');
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const octets = dotted[2].split('.').map((part) => Number(part));
    if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    const hi = (octets[0] << 8) | octets[1];
    const lo = (octets[2] << 8) | octets[3];
    text = `${dotted[1]}${hi.toString(16)}:${lo.toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const groups = side.split(':');
    const nums: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      nums.push(Number.parseInt(group, 16));
    }
    return nums;
  };
  const left = parseSide(halves[0]);
  if (!left) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const right = parseSide(halves[1]);
  if (!right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array(missing).fill(0), ...right];
}

function ipv6Blocked(hextets: number[]): boolean {
  const allZero = hextets.every((part) => part === 0);
  if (allZero) return true;
  const loopback = hextets.slice(0, 7).every((part) => part === 0) && hextets[7] === 1;
  if (loopback) return true;
  const [h0, h1, h2] = hextets;
  if ((h0 & 0xffc0) === 0xfe80) return true;
  if ((h0 & 0xffc0) === 0xfec0) return true;
  if ((h0 & 0xfe00) === 0xfc00) return true;
  if ((h0 & 0xff00) === 0xff00) return true;
  if (h0 === 0x2001 && h1 === 0) return true;
  const embedded = (hi: number, lo: number) => ipv4Blocked(ipv4FromHextets(hi, lo));
  const mapped = hextets.slice(0, 5).every((part) => part === 0) && hextets[5] === 0xffff;
  if (mapped) return embedded(hextets[6], hextets[7]);
  const compatible = hextets.slice(0, 6).every((part) => part === 0);
  if (compatible) return embedded(hextets[6], hextets[7]);
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0) return embedded(hextets[6], hextets[7]);
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 1) return embedded(hextets[6], hextets[7]);
  if (h0 === 0x2002) return ipv4Blocked(ipv4FromHextets(h1, h2));
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const normalised = ip.trim().toLowerCase().replace(/%.*/, '');
  const bare = normalised.startsWith('[') && normalised.endsWith(']')
    ? normalised.slice(1, -1)
    : normalised;
  if (bare.includes(':')) {
    const hextets = parseIpv6(bare);
    if (!hextets) return true;
    return ipv6Blocked(hextets);
  }
  const parts = bare.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  return ipv4Blocked(parts);
}

function bareHostname(hostname: string): string {
  const host = hostname.replace(/\.+$/, '').toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  return host;
}

type PinnedAddress = { address: string; family: 4 | 6 };
type PinnedDispatcher = { close: () => Promise<void> };

function pinDispatcher(pin: PinnedAddress): PinnedDispatcher {
  return new Agent().compose(interceptors.dns({
    dualStack: false,
    affinity: pin.family,
    lookup: (_origin, _options, callback) => {
      callback(null, [{ address: pin.address, family: pin.family, ttl: 60_000 }]);
    },
  }));
}

async function closeAgent(agent: PinnedDispatcher | null): Promise<void> {
  if (!agent) return;
  await agent.close();
}

function releaseAgentWithBody(response: Response, finalUrl: string, agent: PinnedDispatcher | null): Response {
  const headers = new Headers(response.headers);
  headers.set(OUTBOUND_FINAL_URL, finalUrl);
  const body = response.body;
  if (!agent || !body) {
    if (agent) void closeAgent(agent);
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  const wrapped = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        await closeAgent(agent);
      }
    },
    async cancel(reason) {
      await body.cancel(reason);
      await closeAgent(agent);
    },
  });
  return new Response(wrapped, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function resolvePublicAddress(url: URL): Promise<PinnedAddress> {
  const host = bareHostname(url.hostname);
  if (
    !host
    || BLOCKED_HOSTS.has(host)
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
  ) {
    throw new OutboundUrlError('That address is not allowed');
  }
  const family = isIP(host);
  if (family === 4 || family === 6) {
    if (isBlockedAddress(host)) throw new OutboundUrlError('That address is not allowed');
    return { address: host, family };
  }
  const records = await lookup(host, { all: true, verbatim: true });
  if (records.length === 0 || records.some((record) => isBlockedAddress(record.address))) {
    throw new OutboundUrlError('That address is not allowed');
  }
  const chosen = records[0];
  const chosenFamily = chosen.family === 6 ? 6 : 4;
  return { address: chosen.address, family: chosenFamily };
}

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundUrlError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OutboundUrlError('Only http and https URLs are allowed');
  }
  return url;
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = parseHttpUrl(raw);
  await resolvePublicAddress(url);
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
    const checked = parseHttpUrl(current);
    const pin = await resolvePublicAddress(checked);
    const pinConnection = fetchImpl === fetch;
    const agent = pinConnection ? pinDispatcher(pin) : null;
    try {
      const response = await fetchImpl(checked.toString(), {
        ...init,
        redirect: 'manual',
        ...(agent ? { dispatcher: agent } : {}),
      } as RequestInit);
      if (response.status < 300 || response.status >= 400) {
        return releaseAgentWithBody(response, checked.toString(), agent);
      }
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      await closeAgent(agent);
      if (!location) return response;
      current = new URL(location, checked).toString();
    } catch (err) {
      await closeAgent(agent);
      throw err;
    }
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
