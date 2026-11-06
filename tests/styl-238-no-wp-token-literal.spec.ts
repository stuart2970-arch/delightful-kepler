import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const SCAN_ROOTS = ['tests', 'src'];
const SKIP_DIRS = new Set(['node_modules', 'playwright-report', 'test-results', '.next']);
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.md', '.json', '.sql', '.css', '.html',
]);

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
 */
const TWILIO_SID = /^(AC|AD|BU|CA|CH|CL|IS|MG|PN|SK|SM|VA)[0-9a-fA-F]{32}$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

test.describe('STYL-238: no WordPress token-shaped literals', () => {
  test('tests and src reject quoted hex string literals of 20 or more characters', () => {
    const offenders: string[] = [];

    for (const relRoot of SCAN_ROOTS) {
      for (const file of walk(join(root, relRoot))) {
        const ext = extname(file);
        if (ext && !TEXT_EXT.has(ext)) continue;
        const text = readFileSync(file, 'utf8');
        if (text.includes('\0')) continue;
        text.split('\n').forEach((line, index) => {
          QUOTED_HEX.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = QUOTED_HEX.exec(line))) {
            const literal = match[2];
            const where = `${relative(root, file)}:${index + 1} len=${literal.length}`;
            const digest = createHash('sha256').update(literal).digest('hex');
            if (digest === REMOVED_WP_TOKEN_SHA256) {
              offenders.push(`${where} matches removed token digest`);
              continue;
            }
            if (TWILIO_SID.test(literal)) continue;
            offenders.push(where);
          }
        });
      }
    }

    expect(offenders, 'token-shaped hex string literal reintroduced').toEqual([]);
  });
});
