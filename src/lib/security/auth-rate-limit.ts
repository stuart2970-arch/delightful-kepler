import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const MAGIC_LINK_LIMITS = { ip: 200, email: 3, windowSeconds: 15 * 60 };
export const CHECK_EMAIL_LIMITS = { ip: 200, email: 5, windowSeconds: 15 * 60 };

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
