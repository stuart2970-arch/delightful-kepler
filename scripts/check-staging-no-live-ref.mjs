#!/usr/bin/env node
/**
 * STYL-203: CI guard — fail if the live Supabase project ref appears in
 * App Hosting staging config (apphosting.yaml / apphosting.staging.yaml).
 *
 * Intentionally does NOT scan docs/staging.md (documents the live ref as
 * forbidden) or Dockerfile (may contain a defensive grep against the live ref).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIVE_REF = 'tkoasyjvrgaglofpzduq';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = ['apphosting.yaml', 'apphosting.staging.yaml'];

const failures = [];

for (const rel of FILES) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    failures.push(`${rel}: missing (required for Firebase App Hosting staging)`);
    continue;
  }
  const text = readFileSync(path, 'utf8');
  if (text.includes(LIVE_REF)) {
    failures.push(`${rel}: contains live Supabase project ref ${LIVE_REF}`);
  }
}

if (failures.length > 0) {
  console.error('[STYL-203] Staging App Hosting config must never reference the live Supabase project:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `[STYL-203] OK: no live ref ${LIVE_REF} in ${FILES.join(', ')}`,
);
process.exit(0);
