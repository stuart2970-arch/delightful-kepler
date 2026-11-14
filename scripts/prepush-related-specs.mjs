#!/usr/bin/env node
/**
 * STYL-356: map changed files to Playwright specs for the pre-push hook.
 * Reads newline-separated paths on stdin. Prints spec paths on stdout.
 * Prints a small smoke set when nothing matches. Never prints the whole suite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();

// page, route, and layout are generic on purpose. A change to
// src/app/dashboard/page.tsx or src/app/api/foo/route.ts falls back to the
// smoke specs. Matching the parent directory would treat "dashboard" as a
// needle and select most of the suite.
const GENERIC_STEMS = new Set([
  'index',
  'page',
  'route',
  'layout',
  'utils',
  'types',
  'constants',
  'helpers',
  'embed',
]);

export const FALLBACK_SMOKE_SPECS = [
  'tests/addon-text.spec.ts',
  'tests/styl-226-release-source.spec.ts',
];

function listSpecFiles(dir = path.join(root, 'tests'), prefix = 'tests') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      found.push(...listSpecFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.spec.ts')) {
      found.push(rel);
    }
  }
  return found;
}

function needlesFor(file) {
  const normalised = file.replace(/\\/g, '/');
  const base = path.basename(normalised);
  const stem = base.replace(/\.(tsx?|jsx?|mjs|cjs|html|css|md|yml|yaml)$/, '');
  const needles = [];
  if (!normalised.startsWith('public/') && !GENERIC_STEMS.has(stem) && stem.length >= 8) {
    needles.push(stem);
  }
  if (normalised.startsWith('src/') && /\.(tsx?|jsx?|mjs|cjs)$/.test(normalised)) {
    const importPath = normalised.replace(/^src\//, '').replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
    const last = importPath.split('/').pop() || '';
    if (!GENERIC_STEMS.has(last)) {
      needles.push(importPath);
      needles.push(`@/${importPath}`);
    }
  }
  if (normalised.startsWith('public/')) needles.push(base);
  if (normalised.includes('/widget/') || normalised.endsWith('turnstile.html')) {
    needles.push('widget.js', 'turnstile.html');
  }
  return needles.filter((needle) => needle.length >= 6);
}

export function selectRelatedSpecs(changedFiles, specBodies) {
  const selected = new Set();
  for (const file of changedFiles) {
    const normalised = file.replace(/\\/g, '/').trim();
    if (!normalised) continue;
    const considered = normalised.startsWith('src/')
      || normalised.startsWith('public/')
      || normalised.startsWith('tests/');
    if (!considered) continue;
    if (normalised.startsWith('tests/') && normalised.endsWith('.spec.ts')) {
      if (fs.existsSync(path.join(root, normalised))) selected.add(normalised);
      continue;
    }
    const needles = needlesFor(normalised);
    if (needles.length === 0) continue;
    for (const [spec, body] of specBodies) {
      if (needles.some((needle) => body.includes(needle))) selected.add(spec);
    }
  }
  const specs = [...selected].filter((spec) => fs.existsSync(path.join(root, spec))).sort();
  if (specs.length > 0) return specs;
  return FALLBACK_SMOKE_SPECS.filter((spec) => fs.existsSync(path.join(root, spec)));
}

function readChangedFiles() {
  const fromStdin = fs.readFileSync(0, 'utf8');
  return fromStdin.split('\n').map((line) => line.trim()).filter(Boolean);
}

function main() {
  const changed = readChangedFiles();
  const specBodies = new Map(
    listSpecFiles().map((spec) => [spec, fs.readFileSync(path.join(root, spec), 'utf8')]),
  );
  const specs = selectRelatedSpecs(changed, specBodies);
  process.stdout.write(`${specs.join('\n')}\n`);
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
