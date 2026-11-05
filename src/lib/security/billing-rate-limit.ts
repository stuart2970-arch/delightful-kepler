import { clientIp } from '@/lib/security/auth-rate-limit';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const HOUR_MS = 60 * 60 * 1000;

export const BILLING_RATE_WINDOW_MS = HOUR_MS;

function parseLimit(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

/**
 * Production: 10 portal sessions / hour.
 * Playwright's shared suite raises this unless BILLING_PORTAL_RATE_LIMIT is set.
 */
export function billingPortalRateLimit(): number {
  const explicit = process.env.BILLING_PORTAL_RATE_LIMIT;
  if (explicit != null && explicit.trim() !== '') return parseLimit(explicit, 10);
  if (process.env.PLAYWRIGHT_TEST === 'true') return 10_000;
  return 10;
}

/** Production: 20 Checkout sessions / hour. */
export function billingCheckoutRateLimit(): number {
  const explicit = process.env.BILLING_CHECKOUT_RATE_LIMIT;
  if (explicit != null && explicit.trim() !== '') return parseLimit(explicit, 20);
  if (process.env.PLAYWRIGHT_TEST === 'true') return 10_000;
  return 20;
}

/** Per-IP ceiling for unauthenticated (401) billing POSTs. */
export function billingUnauthRateLimit(): number {
  const explicit = process.env.BILLING_UNAUTH_RATE_LIMIT;
  if (explicit != null && explicit.trim() !== '') return parseLimit(explicit, 30);
  if (process.env.PLAYWRIGHT_TEST === 'true') return 10_000;
  return 30;
}

export function consumeMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number = BILLING_RATE_WINDOW_MS,
): boolean {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

export function resetBillingRateLimitsForTests(): void {
  buckets.clear();
}

export function billingClientIp(req: Request): string {
  return clientIp(req);
}
