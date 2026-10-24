/**
 * STYL-202: Safety helpers for `npm run db:reset`.
 * Pure functions shared by scripts/db-reset.mjs and Playwright tests.
 */

/** Live StyleFlo Supabase project — hard refuse. */
export const LIVE_SUPABASE_PROJECT_REF = 'tkoasyjvrgaglofpzduq';

/** Known staging project (STYL-202). */
export const STAGING_SUPABASE_PROJECT_REF = 'lriugykhrfnnouexqqhm';

export type DbResetOptions = {
  linked?: boolean;
  dbUrl?: string | null;
  yes?: boolean;
  help?: boolean;
  extra?: string[];
};

/**
 * True when a URL or project-ref string names the live StyleFlo project.
 */
export function isLiveSupabaseTarget(value: string | undefined | null): boolean {
  if (!value || typeof value !== 'string') return false;
  return new RegExp(LIVE_SUPABASE_PROJECT_REF, 'i').test(value.trim());
}

/**
 * Parse argv after the script name into reset options.
 */
export function parseDbResetArgs(argv: string[]): DbResetOptions {
  const args = [...argv];
  const options: DbResetOptions = {
    linked: false,
    dbUrl: null,
    yes: true,
    extra: [],
  };

  while (args.length) {
    const token = args.shift()!;
    if (token === '--linked') {
      options.linked = true;
    } else if (token === '--db-url' || token === '--db_url') {
      options.dbUrl = args.shift() || null;
    } else if (token === '--no-yes') {
      options.yes = false;
    } else if (token === '--help' || token === '-h') {
      options.help = true;
    } else {
      options.extra!.push(token);
    }
  }
  return options;
}

/**
 * Collect strings that might identify the target project (refuse if live).
 */
export function collectTargetHints(
  options: Pick<DbResetOptions, 'dbUrl'>,
  env: Record<string, string | undefined> = {},
): string[] {
  const hints: string[] = [];
  if (options.dbUrl) hints.push(options.dbUrl);
  for (const key of [
    'SUPABASE_DB_URL',
    'DATABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_PROJECT_ID',
    'SUPABASE_PROJECT_REF',
  ]) {
    if (env[key]) hints.push(String(env[key]));
  }
  return hints;
}

export type SafetyResult = { ok: true } | { ok: false; reason: string };

/**
 * Refuse reset when any hint names the live project.
 */
export function assertSafeDbResetTarget(
  options: Pick<DbResetOptions, 'dbUrl' | 'linked'>,
  env: Record<string, string | undefined> = {},
): SafetyResult {
  const hints = collectTargetHints(options, env);
  for (const hint of hints) {
    if (isLiveSupabaseTarget(hint)) {
      return {
        ok: false,
        reason:
          `Refusing to reset: target mentions the LIVE Supabase project ` +
          `(${LIVE_SUPABASE_PROJECT_REF}). Use the local stack or staging ` +
          `(${STAGING_SUPABASE_PROJECT_REF}) only.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Build `npx supabase db reset` argv (without npx prefix).
 */
export function buildSupabaseResetArgs(options: DbResetOptions): string[] {
  const args = ['supabase', 'db', 'reset'];
  if (options.yes !== false) args.push('--yes');
  if (options.linked) args.push('--linked');
  if (options.dbUrl) {
    args.push('--db-url', options.dbUrl);
  }
  if (options.extra?.length) args.push(...options.extra);
  return args;
}
