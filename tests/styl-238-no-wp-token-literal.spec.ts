import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

const root = process.cwd();
const SCAN_ROOTS = ['tests', 'src', 'docs', 'Styleflo AI'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'playwright-report', 'test-results', '.next']);
const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.md', '.json', '.sql', '.css', '.html',
]);
const REQUIRED_SCANS = [
  'README.md',
  'Styleflo AI/delightful-kepler/README.md',
];

/**
 * SHA-256 of the create-business token literal removed from the STYL-226 spec.
 * Stored in short chunks so this file is not itself a long hex string literal.
 */
const REMOVED_WP_TOKEN_SHA256 = [
  'ed4ae055',
  'f70e65f2',
  '1e99d8a8',
  '43753a4d',
  'faa04351',
  'dff1aace',
  '6b0c475a',
  'd5efebdb',
].join('');

const QUOTED_HEX = /(['"`])([0-9a-fA-F]{20,})\1/g;

/**
 * Twilio SID literals are 34 characters (two-letter prefix plus 32 hex).
 * They are not the 24-character create-business token shape, so they stay.
 * 32- and 40-character runs are public client ids and commit SHAs in markdown.
 */
const TWILIO_SID = /^(AC|AD|BU|CA|CH|CL|IS|MG|PN|SK|SM|VA)[0-9a-fA-F]{32}$/;
const SHAPE_ALLOW_LENGTHS = new Set([32, 40]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || LOCKFILES.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function filesToScan(): string[] {
  const files: string[] = [];
  for (const relRoot of SCAN_ROOTS) {
    walk(join(root, relRoot), files);
  }
  for (const name of readdirSync(root)) {
    if (!name.endsWith('.md') || LOCKFILES.has(name)) continue;
    const path = join(root, name);
    if (statSync(path).isFile()) files.push(path);
  }
  return files;
}

/** NUL bytes must not drop a file. Stripping them keeps a split literal visible. */
export function textForScan(raw: string): string {
  return raw.includes('\0') ? raw.replaceAll('\0', '') : raw;
}

export function collectOffenders(raw: string, whereFile: string): string[] {
  const text = textForScan(raw);
  const offenders: string[] = [];
  text.split('\n').forEach((line, index) => {
    const where = `${whereFile}:${index + 1}`;
    const runs = line.match(/[0-9a-fA-F]{20,}/g) || [];
    for (const run of runs) {
      const digest = createHash('sha256').update(run).digest('hex');
      if (digest === REMOVED_WP_TOKEN_SHA256) {
        offenders.push(`${where} len=${run.length} matches removed token digest`);
      }
    }
    QUOTED_HEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = QUOTED_HEX.exec(line))) {
      const literal = match[2];
      const digest = createHash('sha256').update(literal).digest('hex');
      if (digest === REMOVED_WP_TOKEN_SHA256) continue;
      if (TWILIO_SID.test(literal)) continue;
      if (SHAPE_ALLOW_LENGTHS.has(literal.length)) continue;
      offenders.push(`${where} len=${literal.length}`);
    }
  });
  return offenders;
}

function scanRepository(): { scanned: string[]; offenders: string[] } {
  const scanned: string[] = [];
  const offenders: string[] = [];
  for (const file of filesToScan()) {
    const ext = extname(file);
    if (ext && !TEXT_EXT.has(ext)) continue;
    if (LOCKFILES.has(basename(file))) continue;
    const rel = relative(root, file);
    const raw = readFileSync(file, 'utf8');
    scanned.push(rel);
    offenders.push(...collectOffenders(raw, rel));
  }
  return { scanned, offenders };
}

test.describe('STYL-238: no WordPress token-shaped literals', () => {
  test('tests, src, docs, and markdown reject token-shaped hex literals', () => {
    const { scanned, offenders } = scanRepository();
    for (const required of REQUIRED_SCANS) {
      expect(scanned, `${required} was not scanned`).toContain(required);
    }
    expect(offenders, 'token-shaped hex string literal reintroduced').toEqual([]);
  });

  test('NUL bytes do not hide a token-shaped literal in a README', () => {
    const raw = readFileSync(join(root, 'README.md'), 'utf8');
    expect(raw.includes('\0')).toBe(true);
    const token = 'cd'.repeat(12);
    const injected = `${raw}\nconst leaked = '${token}';\n`;
    const offenders = collectOffenders(injected, 'README.md');
    expect(offenders.length).toBeGreaterThan(0);

    const split = `const leaked = '${token.split('').join('\0')}';`;
    expect(collectOffenders(split, 'memory.md').length).toBeGreaterThan(0);
  });
});
