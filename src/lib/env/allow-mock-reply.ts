import { resolveAppEnv, type EnvLike } from '@/lib/env/live-supabase-guard';

export type MockReplyEnv = EnvLike & { ALLOW_MOCK_REPLY?: string };

/**
 * STYL-199: caller-supplied mock replies are honoured only when both are true:
 * - ALLOW_MOCK_REPLY is explicitly "true" or "1" (trim + lowercase; "false", "0",
 *   empty, and anything else are off), and
 * - resolveAppEnv is not production.
 *
 * Production is APP_ENV=production, or APP_ENV unset with NODE_ENV=production
 * (Cloud Run today). Never set ALLOW_MOCK_REPLY on production. Do not put it in
 * App Hosting yaml — staging salon traffic must use the real model.
 * When this returns false, callers must treat the mock fields as absent.
 * Do not answer with a dedicated 4xx that would confirm the fields exist,
 * and do not log the mock payload.
 */
export function isMockReplyAllowed(env: MockReplyEnv = process.env): boolean {
  const flag = (env.ALLOW_MOCK_REPLY || '').trim().toLowerCase();
  if (flag !== 'true' && flag !== '1') return false;
  if (resolveAppEnv(env) === 'production') return false;
  return true;
}

/**
 * Returns the caller mock only when allowed. Accepts a string or an array of
 * strings (stream chunks). Anything else, including an empty string, is absent.
 */
export function resolveMockModelReply(
  raw: unknown,
  env: MockReplyEnv = process.env,
): string | string[] | undefined {
  if (!isMockReplyAllowed(env)) return undefined;
  if (typeof raw === 'string') return raw.length > 0 ? raw : undefined;
  if (Array.isArray(raw) && raw.length > 0 && raw.every((part) => typeof part === 'string')) {
    return raw;
  }
  return undefined;
}
