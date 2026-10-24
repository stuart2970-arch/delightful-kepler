#!/usr/bin/env node
/**
 * STYL-202: One-command reset + reseed for local or staging Supabase.
 *
 * Usage:
 *   npm run db:reset                  # local CLI stack (default)
 *   npm run db:reset -- --linked      # linked remote (must be staging, never live)
 *   npm run db:reset -- --db-url URL  # explicit Postgres URL (must not be live)
 *
 * Refuses to run against the live project ref tkoasyjvrgaglofpzduq.
 * Pure helpers for Playwright live in src/lib/env/db-reset-guard.ts — keep in sync.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const LIVE_SUPABASE_PROJECT_REF = 'tkoasyjvrgaglofpzduq';
const STAGING_SUPABASE_PROJECT_REF = 'lriugykhrfnnouexqqhm';

function isLiveSupabaseTarget(value) {
  if (!value || typeof value !== 'string') return false;
  return new RegExp(LIVE_SUPABASE_PROJECT_REF, 'i').test(value.trim());
}

function parseDbResetArgs(argv) {
  const args = [...argv];
  const options = { linked: false, dbUrl: null, yes: true, extra: [] };
  while (args.length) {
    const token = args.shift();
    if (token === '--linked') options.linked = true;
    else if (token === '--db-url' || token === '--db_url') options.dbUrl = args.shift() || null;
    else if (token === '--no-yes') options.yes = false;
    else if (token === '--help' || token === '-h') options.help = true;
    else options.extra.push(token);
  }
  return options;
}

function collectTargetHints(options, env = process.env) {
  const hints = [];
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

function assertSafeDbResetTarget(options, env = process.env) {
  for (const hint of collectTargetHints(options, env)) {
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

function buildSupabaseResetArgs(options) {
  const args = ['supabase', 'db', 'reset'];
  if (options.yes !== false) args.push('--yes');
  if (options.linked) args.push('--linked');
  if (options.dbUrl) args.push('--db-url', options.dbUrl);
  if (options.extra?.length) args.push(...options.extra);
  return args;
}

function printHelp() {
  console.log(`STYL-202 db:reset — wipe schema, re-apply migrations, re-seed.

Usage:
  npm run db:reset
  npm run db:reset -- --linked
  npm run db:reset -- --db-url "postgresql://..."

Safety:
  Refuses the live project ref ${LIVE_SUPABASE_PROJECT_REF}.
  Staging ref: ${STAGING_SUPABASE_PROJECT_REF}.
  Seed holds no real data (see supabase/seed.sql header).
`);
}

function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseDbResetArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const safety = assertSafeDbResetTarget(options, env);
  if (!safety.ok) {
    console.error(`[db:reset] ${safety.reason}`);
    return 1;
  }

  const resetArgs = buildSupabaseResetArgs(options);
  console.log(`[db:reset] Running: npx ${resetArgs.join(' ')}`);
  const result = spawnSync('npx', resetArgs, {
    cwd: root,
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    console.error(
      `[db:reset] supabase db reset failed with exit ${result.status ?? 'unknown'}.`,
    );
    return result.status || 1;
  }

  console.log('[db:reset] Done. Migrations applied and seed reloaded.');
  return 0;
}

process.exit(main());
