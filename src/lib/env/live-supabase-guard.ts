/**
 * STYL-210 / STYL-203: Guard against accidental use of the live Supabase project
 * outside production (local dev, staging, tests).
 *
 * Production (Cloud Run / Docker) sets NODE_ENV=production but does not
 * currently set APP_ENV. When APP_ENV is unset we treat NODE_ENV=production
 * as production so this guard never logs or breaks the live service.
 *
 * Staging (APP_ENV=staging) MUST fail loudly if the live project appears —
 * never warn-and-continue.
 */

/** Live StyleFlo Supabase project ref — never point local/dev/test/staging at this. */
export const LIVE_SUPABASE_PROJECT_REF = 'tkoasyjvrgaglofpzduq';

/** Staging Supabase project ref (styleflo-staging). */
export const STAGING_SUPABASE_PROJECT_REF = 'lriugykhrfnnouexqqhm';

export const LIVE_SUPABASE_URL = `https://${LIVE_SUPABASE_PROJECT_REF}.supabase.co`;

export const STAGING_SUPABASE_URL = `https://${STAGING_SUPABASE_PROJECT_REF}.supabase.co`;

export type EnvLike = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_URL?: string;
  APP_ENV?: string;
  NODE_ENV?: string;
};

/**
 * True when the URL hosts the live StyleFlo Supabase project.
 */
export function isLiveSupabaseUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const normalised = url.trim().toLowerCase();
  if (!normalised) return false;
  return (
    normalised.includes(`${LIVE_SUPABASE_PROJECT_REF}.supabase.co`) ||
    normalised.includes(`://${LIVE_SUPABASE_PROJECT_REF}.`) ||
    normalised.includes(`/${LIVE_SUPABASE_PROJECT_REF}.`)
  );
}

/**
 * Resolve effective app environment.
 * Prefer explicit APP_ENV; if unset, fall back to NODE_ENV so production
 * Docker/Cloud Run (NODE_ENV=production, APP_ENV unset) stays quiet without
 * requiring a production config change.
 */
export function resolveAppEnv(env: EnvLike): string {
  const explicit = env.APP_ENV?.trim();
  if (explicit) return explicit.toLowerCase();
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === 'production') return 'production';
  return nodeEnv || 'development';
}

/**
 * Warn when the configured Supabase URL is the live project and we are not
 * in production. Safe for production: returns false when APP_ENV is
 * "production", or when APP_ENV is unset and NODE_ENV is "production".
 */
export function shouldWarnAboutLiveSupabase(env: EnvLike): boolean {
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  if (!isLiveSupabaseUrl(url)) return false;
  return resolveAppEnv(env) !== 'production';
}

export function formatLiveSupabaseWarning(url: string | undefined | null): string {
  const shown = (url || '').trim() || '(empty)';
  return [
    '[STYL-210] WARNING: NEXT_PUBLIC_SUPABASE_URL points at the LIVE Supabase project',
    `(${shown}).`,
    'Local development and tests must use the local Supabase CLI stack',
    '(http://127.0.0.1:54321) or a dedicated staging project — never live.',
    'Run `npx supabase start` then `npm run env:local`, or see',
    '.agents/skills/local-testing-environment/SKILL.md.',
  ].join(' ');
}

export type WarnLogger = {
  warn: (...args: unknown[]) => void;
};

/**
 * Log a one-shot console warning when the live Supabase URL is configured
 * outside production. No-op in production (including Cloud Run with APP_ENV unset).
 */
export function warnIfLiveSupabaseInNonProduction(
  env: EnvLike = process.env,
  logger: WarnLogger = console,
): boolean {
  if (!shouldWarnAboutLiveSupabase(env)) return false;
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  logger.warn(formatLiveSupabaseWarning(url));
  return true;
}

/**
 * STYL-203: When APP_ENV=staging, throw if the configured Supabase URL is the
 * live project. Staging builds and runtimes must never silently use live.
 */
export function assertNoLiveSupabaseWhenStaging(env: EnvLike = process.env): void {
  if (resolveAppEnv(env) !== 'staging') return;
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  if (!isLiveSupabaseUrl(url)) return;
  throw new Error(
    [
      '[STYL-203] FATAL: APP_ENV=staging but NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL',
      `points at the LIVE Supabase project (${LIVE_SUPABASE_PROJECT_REF}).`,
      `Staging must use ${STAGING_SUPABASE_URL} only.`,
      `Got: ${(url || '').trim() || '(empty)'}`,
    ].join(' '),
  );
}
