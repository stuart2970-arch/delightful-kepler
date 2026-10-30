import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/** Production default: 20 requests per IP per 15 minutes. Tests raise this via AUTH_RATE_LIMIT_PER_IP. */
const DEFAULT_AUTH_RATE_LIMIT_PER_IP = 20;

/**
 * Per-IP ceiling for magic-link and check-email. Unset, blank, or invalid
 * values use the production default. Per-email limits are not affected.
 */
export function authRateLimitPerIp(): number {
  const raw = process.env.AUTH_RATE_LIMIT_PER_IP;
  if (raw == null || raw.trim() === '') return DEFAULT_AUTH_RATE_LIMIT_PER_IP;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_AUTH_RATE_LIMIT_PER_IP;
  return parsed;
}

export const MAGIC_LINK_LIMITS = {
  get ip() {
    return authRateLimitPerIp();
  },
  email: 3,
  windowSeconds: 15 * 60,
};

export const CHECK_EMAIL_LIMITS = {
  get ip() {
    return authRateLimitPerIp();
  },
  email: 5,
  windowSeconds: 15 * 60,
};

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment is missing.');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') || 'unknown';
}

export function hashEmail(email: string): string {
  return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/**
 * Returns true when the request is inside the window. Any database or RPC
 * failure is denied so a limiter outage cannot open the route.
 */
export async function consumeAuthRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('consume_auth_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error('[AuthRateLimit] Limiter unavailable.');
      return false;
    }
    return data === true;
  } catch {
    console.error('[AuthRateLimit] Limiter unavailable.');
    return false;
  }
}
