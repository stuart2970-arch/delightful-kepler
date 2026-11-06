import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

/**
 * Production App Hosting build 20374ba7 (commit 6cd60cd1, image
 * build-2026-11-06-003) exited in `next build` because Next.js 16.3.5
 * defaults to Turbopack and this repo's Playwright webpack hook had no
 * turbopack config. Live production was not replaced.
 *
 * This calls the same Next.js check (`TURBOPACK=auto` + validateTurboNextConfig
 * during the production build phase). It fails while `webpack` is set and
 * `turbopack` is absent, and passes once the empty turbopack config is present.
 */
test('Next 16 Turbopack production check accepts the webpack hook', () => {
  const script = `
    process.env.TURBOPACK = 'auto';
    const { validateTurboNextConfig } = require('next/dist/lib/turbopack-warning');
    const { PHASE_PRODUCTION_BUILD } = require('next/dist/shared/lib/constants');
    validateTurboNextConfig({
      dir: process.cwd(),
      configPhase: PHASE_PRODUCTION_BUILD,
    }).then((cfg) => {
      const webpack = Boolean(cfg && cfg.webpack);
      const turbopack = cfg && cfg.turbopack && typeof cfg.turbopack === 'object';
      console.log('SURVIVED ' + JSON.stringify({ webpack: Boolean(webpack), turbopack: Boolean(turbopack) }));
      if (!webpack || !turbopack) process.exit(3);
    }).catch((err) => {
      console.error(err);
      process.exit(2);
    });
  `;

  const result = spawnSync(
    process.execPath,
    ['--input-type=commonjs', '-e', script],
    {
      encoding: 'utf8',
      cwd: root,
      env: { ...process.env, TURBOPACK: 'auto' },
    },
  );

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  expect(result.status, output).toBe(0);
  expect(output).not.toContain('This build is using Turbopack');
  expect(result.stdout).toContain('"webpack":true');
  expect(result.stdout).toContain('"turbopack":true');
});
