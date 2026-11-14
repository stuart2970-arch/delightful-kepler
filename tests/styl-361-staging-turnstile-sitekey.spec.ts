import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * STYL-361 follow-up: the staging App Hosting build inlined Cloudflare's
 * always-pass secret as NEXT_PUBLIC_TURNSTILE_SITE_KEY. embed.js copies that
 * value into /turnstile.html, the widget errors, and the client throws
 * "Security verification failed" before public-init. The dashboard test area
 * still works because turnstile-client skips any 1x key.
 *
 * The shared apphosting.yaml value stays put. Production App Hosting
 * (styleflo-ai / delightful-kepler-1, no environment name) reads that file
 * and does not merge apphosting.staging.yaml. Staging replaces the variable
 * when its Environment name is staging.
 */

const root = process.cwd();

/** Cloudflare's documented always-pass Turnstile sitekey (public). */
const STAGING_SITE_KEY = '1x00000000000000000000AA';

function read(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

function envBlock(text: string, variable: string) {
  const body = text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  const marker = `- variable: ${variable}`;
  const start = body.indexOf(marker);
  expect(start, `${variable} is missing`).toBeGreaterThanOrEqual(0);
  const next = body.indexOf('\n  - variable:', start + marker.length);
  return body.slice(start, next === -1 ? undefined : next).trim();
}

test.describe('STYL-361: staging Turnstile site key', () => {
  test('staging override is the always-pass sitekey and production config is unchanged', () => {
    const base = read('apphosting.yaml');
    const staging = read('apphosting.staging.yaml');
    const deploy = read('.github/workflows/deploy.yml');
    const docs = read('docs/staging.md');

    expect(envBlock(base, 'NEXT_PUBLIC_TURNSTILE_SITE_KEY')).toBe(
      [
        '- variable: NEXT_PUBLIC_TURNSTILE_SITE_KEY',
        '    value: "1x0000000000000000000000000000000AA"',
        '    availability:',
        '      - BUILD',
        '      - RUNTIME',
      ].join('\n'),
    );

    const stagingBlock = envBlock(staging, 'NEXT_PUBLIC_TURNSTILE_SITE_KEY');
    expect(stagingBlock).toBe(
      [
        '- variable: NEXT_PUBLIC_TURNSTILE_SITE_KEY',
        `    value: "${STAGING_SITE_KEY}"`,
        '    availability:',
        '      - BUILD',
        '      - RUNTIME',
      ].join('\n'),
    );
    expect(stagingBlock).not.toContain('secret:');
    expect(STAGING_SITE_KEY).toHaveLength(24);
    expect(stagingBlock).not.toContain('1x0000000000000000000000000000000AA');

    expect(envBlock(staging, 'CLOUDFLARE_TURNSTILE_SECRET_KEY')).toBe(
      [
        '- variable: CLOUDFLARE_TURNSTILE_SECRET_KEY',
        '    secret: CLOUDFLARE_TURNSTILE_SECRET_KEY',
        '    availability:',
        '      - RUNTIME',
      ].join('\n'),
    );

    expect(deploy).toContain(
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY=${{ secrets.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '0x4AAAAAAEcGPat6Ll-AhKbf' }}",
    );
    expect(deploy).not.toContain(STAGING_SITE_KEY);

    expect(docs).toContain(
      '`apphosting.staging.yaml` sets `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to `1x00000000000000000000AA`',
    );
  });
});
