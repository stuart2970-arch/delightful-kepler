#!/usr/bin/env node
/**
 * STYL-210: Safe local development entrypoint.
 * Ensures .env.local exists and does not point at the live Supabase project,
 * then starts `next dev`.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const LIVE_REF = 'tkoasyjvrgaglofpzduq';
const envLocalPath = path.join(root, '.env.local');

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

function isLiveUrl(url) {
  // Only the live StyleFlo project — staging *.supabase.co hosts are allowed.
  return typeof url === 'string' && new RegExp(LIVE_REF, 'i').test(url);
}

function ensureLocalEnv() {
  let env = readEnvFile(envLocalPath);
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;

  if (!fs.existsSync(envLocalPath) || !url || isLiveUrl(url)) {
    if (isLiveUrl(url)) {
      console.error(
        '[dev] .env.local currently points at the LIVE Supabase project. Regenerating from local Supabase…',
      );
    } else {
      console.log('[dev] .env.local missing or incomplete. Generating from local Supabase…');
    }
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/write-local-env.mjs')], {
      cwd: root,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      console.error(
        '[dev] Could not create a safe .env.local. Run `npx supabase start` then `npm run env:local`.',
      );
      process.exit(result.status || 1);
    }
    env = readEnvFile(envLocalPath);
  }

  const finalUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  if (isLiveUrl(finalUrl)) {
    console.error(
      `[dev] Refusing to start: NEXT_PUBLIC_SUPABASE_URL is still the live project (${finalUrl}).`,
    );
    console.error('[dev] Use the local stack (http://127.0.0.1:54321) or a staging project — never live.');
    process.exit(1);
  }

  console.log(`[dev] Using Supabase at ${finalUrl || '(unset)'}`);
}

ensureLocalEnv();

const child = spawn('npx', ['next', 'dev', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
