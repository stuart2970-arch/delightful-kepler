import { isLiveSupabaseUrl, resolveAppEnv, type EnvLike } from '@/lib/env/live-supabase-guard';

export type MockOAuthEnv = EnvLike & { ALLOW_MOCK_OAUTH_CODES?: string };

/**
 * OAuth codes that start with mock_ are accepted only when both are true:
 * - ALLOW_MOCK_OAUTH_CODES is explicitly "true" or "1", and
 * - resolveAppEnv is not production, and
 * - the Supabase URL is not the live project.
 *
 * Production is APP_ENV=production, or APP_ENV unset with NODE_ENV=production.
 * Never set ALLOW_MOCK_OAUTH_CODES on production or staging. Playwright does
 * not set it, so mock codes stay rejected in the test server.
 */
export function isMockOAuthCodeAllowed(env: MockOAuthEnv = process.env): boolean {
  const flag = (env.ALLOW_MOCK_OAUTH_CODES || '').trim().toLowerCase();
  if (flag !== 'true' && flag !== '1') return false;
  if (resolveAppEnv(env) === 'production') return false;
  if (isLiveSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL) || isLiveSupabaseUrl(env.SUPABASE_URL)) return false;
  return true;
}
