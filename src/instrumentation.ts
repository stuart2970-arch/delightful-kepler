/**
 * Next.js instrumentation — runs once when a Node server instance starts.
 * STYL-210: warn if the process is pointed at the live Supabase project
 * outside production. Production Cloud Run keeps NODE_ENV=production and
 * does not set APP_ENV; the guard treats that as production (no log spam).
 */
export async function register() {
  // Only run on the Node.js runtime (not Edge).
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { warnIfLiveSupabaseInNonProduction } = await import(
    '@/lib/env/live-supabase-guard'
  );
  warnIfLiveSupabaseInNonProduction(process.env, console);
}
