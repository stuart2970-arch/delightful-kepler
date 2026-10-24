#!/usr/bin/env node
/**
 * STYL-203: Fail the build loudly when APP_ENV=staging points at the live
 * Supabase project. No-op for other environments (local, production Cloud Run).
 * Keep the live/staging refs in sync with src/lib/env/live-supabase-guard.ts.
 */
const LIVE_REF = 'tkoasyjvrgaglofpzduq';
const STAGING_REF = 'lriugykhrfnnouexqqhm';

function isLive(url) {
  if (!url || typeof url !== 'string') return false;
  return url.toLowerCase().includes(LIVE_REF);
}

function resolveAppEnv(env) {
  const explicit = env.APP_ENV?.trim();
  if (explicit) return explicit.toLowerCase();
  if (env.NODE_ENV?.trim().toLowerCase() === 'production') return 'production';
  return (env.NODE_ENV || 'development').toLowerCase();
}

const appEnv = resolveAppEnv(process.env);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';

if (appEnv === 'staging') {
  if (isLive(url)) {
    console.error(
      `[STYL-203] Refusing to build: APP_ENV=staging but Supabase URL points at the LIVE project (${LIVE_REF}).`,
      `Use staging project ${STAGING_REF} only.`,
      `URL was: ${url || '(empty)'}`,
    );
    process.exit(1);
  }
  if (!url) {
    console.error(
      '[STYL-203] Refusing to build: APP_ENV=staging but NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL is empty.',
    );
    process.exit(1);
  }
  console.log(`[STYL-203] Staging build env OK (Supabase URL does not reference live ${LIVE_REF}).`);
}

process.exit(0);
