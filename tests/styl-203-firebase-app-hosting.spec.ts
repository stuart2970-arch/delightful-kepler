import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  LIVE_SUPABASE_PROJECT_REF,
  STAGING_SUPABASE_PROJECT_REF,
  STAGING_SUPABASE_URL,
  assertNoLiveSupabaseWhenStaging,
  isLiveSupabaseUrl,
} from '../src/lib/env/live-supabase-guard';

const root = process.cwd();
const LIVE_REF = LIVE_SUPABASE_PROJECT_REF;

test.describe('STYL-203: Firebase App Hosting staging guards', () => {
  test('apphosting.yaml and apphosting.staging.yaml exist and never contain the live ref', () => {
    const base = join(root, 'apphosting.yaml');
    const staging = join(root, 'apphosting.staging.yaml');
    expect(existsSync(base)).toBe(true);
    expect(existsSync(staging)).toBe(true);

    const baseText = readFileSync(base, 'utf8');
    const stagingText = readFileSync(staging, 'utf8');
    expect(baseText).not.toContain(LIVE_REF);
    expect(stagingText).not.toContain(LIVE_REF);

    expect(stagingText).toContain('APP_ENV');
    expect(stagingText).toContain('staging');
    expect(stagingText).toContain('secret: SUPABASE_SERVICE_ROLE_KEY');
    expect(stagingText).toMatch(/minInstances:\s*0/);
    expect(stagingText).toMatch(/maxInstances:\s*2/);

    // Staging Supabase URL / Turnstile site key live in base apphosting.yaml
    // so BUILD works even when Environment name is unset.
    expect(baseText).toContain(STAGING_SUPABASE_PROJECT_REF);
    expect(baseText).toContain('NEXT_PUBLIC_TURNSTILE_SITE_KEY');
    expect(baseText).toContain('1x0000000000000000000000000000000AA');
  });

  test('apphosting.staging.yaml keeps only the six core secrets (plus aliases)', () => {
    const stagingText = readFileSync(join(root, 'apphosting.staging.yaml'), 'utf8');
    const secretLines = stagingText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('secret:'));
    const secretNames = secretLines.map((l) => l.replace(/^secret:\s*/, '').trim());

    // Six Secret Manager resource names (aliases reuse the same names).
    expect(new Set(secretNames)).toEqual(
      new Set([
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'GEMINI_API_KEY',
        'CLOUDFLARE_TURNSTILE_SECRET_KEY',
        'CHAT_SESSION_SIGNING_SECRET',
        'TOKEN_ENC_KEY',
      ]),
    );

    // Feature secrets must not be required at rollout time.
    for (const forbidden of [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'MAILGUN_API_KEY',
      'TWILIO_ACCOUNT_SID',
      'VAPI_API_KEY',
      'META_ACCESS_TOKEN',
      'GOOGLE_CLIENT_SECRET',
      'MICROSOFT_CLIENT_SECRET',
      'ELEVENLABS_API_KEY',
      'CRON_SECRET',
      'OPENCLAW_BEARER_TOKEN',
      'WPMUDEV_WEBHOOK_SECRET',
      'STYLEFLO_WP_API_SECRET',
      'GOOGLE_PLACES_SERVER_API_KEY',
      'NEXT_PUBLIC_VAPI_PUBLIC_KEY',
    ]) {
      expect(secretNames, forbidden).not.toContain(forbidden);
    }
  });

  test('base apphosting.yaml exposes staging NEXT_PUBLIC_* + anon secret at BUILD and RUNTIME', () => {
    const baseText = readFileSync(join(root, 'apphosting.yaml'), 'utf8');

    for (const name of [
      'APP_ENV',
      'NEXT_PUBLIC_ENV',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_APP_URL',
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ]) {
      const start = baseText.indexOf(`variable: ${name}`);
      expect(start, name).toBeGreaterThanOrEqual(0);
      const nextVar = baseText.indexOf('\n  - variable:', start + 1);
      const block = baseText.slice(start, nextVar === -1 ? undefined : nextVar);
      expect(block, `${name} BUILD`).toMatch(/-\s*BUILD\b/);
      expect(block, `${name} RUNTIME`).toMatch(/-\s*RUNTIME\b/);
    }

    expect(baseText).toContain(STAGING_SUPABASE_URL);
    expect(baseText).toMatch(
      /variable:\s*NEXT_PUBLIC_SUPABASE_ANON_KEY[\s\S]*?secret:\s*NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    );
    // Production Cloud Run must not be implied — comment documents staging-only.
    expect(baseText).toMatch(/staging only|Cloud Run.*does NOT read/i);

    // Regression: App Hosting rejects empty env values (build 4c860af7).
    // Ignore comments; assert no real env entry uses an empty string.
    const envBody = baseText
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(envBody).not.toMatch(/^\s*value:\s*["']{2}\s*$/m);
  });

  test('check-apphosting-yaml.mjs passes on repo and rejects empty value', async () => {
    const { spawnSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join: pathJoin } = await import('node:path');
    const script = join(root, 'scripts/check-apphosting-yaml.mjs');

    const ok = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      cwd: root,
    });
    expect(ok.status, ok.stderr + ok.stdout).toBe(0);
    expect(ok.stdout).toContain('apphosting');

    const dir = mkdtempSync(pathJoin(tmpdir(), 'apphosting-schema-'));
    try {
      writeFileSync(
        pathJoin(dir, 'apphosting.yaml'),
        [
          'runConfig:',
          '  cpu: 1',
          'env:',
          '  - variable: EMPTY_BAD',
          '    value: ""',
          '    availability:',
          '      - BUILD',
        ].join('\n'),
      );
      const bad = spawnSync(process.execPath, [script], {
        encoding: 'utf8',
        cwd: dir,
      });
      expect(bad.status).toBe(1);
      expect(bad.stderr + bad.stdout).toMatch(/empty string/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('login/register/onboard lazy-init Supabase (no prerender throw)', () => {
    const login = readFileSync(join(root, 'src/app/login/page.tsx'), 'utf8');
    const register = readFileSync(join(root, 'src/app/register/page.tsx'), 'utf8');
    const onboard = readFileSync(join(root, 'src/app/onboard/page.tsx'), 'utf8');
    const helper = readFileSync(join(root, 'src/lib/supabase-browser.ts'), 'utf8');

    expect(helper).toContain('export function getSupabaseBrowserClient');
    expect(helper).toContain('export function hasSupabaseBrowserEnv');

    for (const [name, src] of [
      ['login', login],
      ['register', register],
      ['onboard', onboard],
    ] as const) {
      expect(src, name).toContain('getSupabaseBrowserClient');
      // Regression: useState initializer that threw during prerender (build f287d45b).
      expect(src, name).not.toMatch(
        /useState\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?Supabase environment variables are missing/,
      );
      expect(src, name).not.toContain("from '@supabase/ssr'");
    }

    expect(login).toContain('hasSupabaseBrowserEnv');
  });

  test('production deploy workflow typechecks on Node 22', () => {
    const deploy = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
    expect(deploy).toMatch(/node-version:\s*22/);
    expect(deploy).not.toMatch(/node-version:\s*20\b/);
  });

  test('apphosting.yaml raises BUILD heap and flags App Hosting builds (no RUNTIME)', () => {
    const baseText = readFileSync(join(root, 'apphosting.yaml'), 'utf8');
    expect(baseText).toContain('STYL_APPHOSTING_BUILD');
    expect(baseText).toContain('NODE_OPTIONS');
    expect(baseText).toContain('--max-old-space-size=3072');

    // Each BUILD-only env entry: availability lists BUILD and must not list RUNTIME.
    for (const name of ['STYL_APPHOSTING_BUILD', 'NODE_OPTIONS']) {
      const start = baseText.indexOf(`variable: ${name}`);
      expect(start, name).toBeGreaterThanOrEqual(0);
      const nextVar = baseText.indexOf('\n  - variable:', start + 1);
      const block = baseText.slice(start, nextVar === -1 ? undefined : nextVar);
      expect(block, name).toMatch(/availability:\s*\n\s*-\s*BUILD\b/);
      expect(block, name).not.toMatch(/-\s*RUNTIME\b/);
    }

    const nextConfig = readFileSync(join(root, 'next.config.ts'), 'utf8');
    expect(nextConfig).toContain('ignoreBuildErrors');
    expect(nextConfig).toContain('STYL_APPHOSTING_BUILD');
  });

  test('Dockerfile has no live Supabase URL/anon-key fallback defaults', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
    // No ARG defaults that embed the live URL/key — missing args must fail the build.
    expect(dockerfile).not.toMatch(
      /ARG\s+NEXT_PUBLIC_SUPABASE_URL=https:\/\//,
    );
    expect(dockerfile).not.toMatch(
      /ARG\s+NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ/,
    );
    expect(dockerfile).toContain(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY build-args are required',
    );
    expect(dockerfile).toMatch(/FROM node:22/);
    // Defensive staging guard may mention the live ref; that is intentional.
    expect(dockerfile).toContain('APP_ENV=staging');
  });

  test('package.json engines.node is 22 and App Hosting build-time deps are in dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.engines?.node).toBe('22');
    // App Hosting runs `npm ci` with NODE_ENV=production — these must not be
    // omitted as devDependencies or the adapter build fails / OOMs reinstalling.
    for (const name of [
      '@tailwindcss/postcss',
      'tailwindcss',
      'esbuild',
      'typescript',
      '@types/node',
      '@types/react',
      '@types/react-dom',
    ]) {
      expect(pkg.dependencies[name], name).toBeTruthy();
      expect(pkg.devDependencies?.[name], name).toBeUndefined();
    }
  });

  test('assertNoLiveSupabaseWhenStaging throws for live URL under APP_ENV=staging', () => {
    expect(() =>
      assertNoLiveSupabaseWhenStaging({
        APP_ENV: 'staging',
        NEXT_PUBLIC_SUPABASE_URL: `https://${LIVE_REF}.supabase.co`,
        NODE_ENV: 'production',
      }),
    ).toThrow(/STYL-203/);

    expect(() =>
      assertNoLiveSupabaseWhenStaging({
        APP_ENV: 'staging',
        NEXT_PUBLIC_SUPABASE_URL: STAGING_SUPABASE_URL,
        NODE_ENV: 'production',
      }),
    ).not.toThrow();

    // Production / unset APP_ENV must not throw (Cloud Run stays quiet).
    expect(() =>
      assertNoLiveSupabaseWhenStaging({
        NEXT_PUBLIC_SUPABASE_URL: `https://${LIVE_REF}.supabase.co`,
        NODE_ENV: 'production',
      }),
    ).not.toThrow();
  });

  test('staging URL helpers distinguish staging from live', () => {
    expect(isLiveSupabaseUrl(STAGING_SUPABASE_URL)).toBe(false);
    expect(isLiveSupabaseUrl(`https://${LIVE_REF}.supabase.co`)).toBe(true);
    expect(STAGING_SUPABASE_PROJECT_REF).toBe('lriugykhrfnnouexqqhm');
  });

  test('check-staging-no-live-ref script exits 0 against the repo', async () => {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(
      process.execPath,
      [join(root, 'scripts/check-staging-no-live-ref.mjs')],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('STYL-203');
  });

  test('assert-staging-env.mjs fails when APP_ENV=staging and URL is live', async () => {
    const { spawnSync } = await import('node:child_process');
    const script = join(root, 'scripts/assert-staging-env.mjs');

    const fail = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_ENV: 'staging',
        NEXT_PUBLIC_SUPABASE_URL: `https://${LIVE_REF}.supabase.co`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      },
    });
    expect(fail.status).toBe(1);
    expect(fail.stderr + fail.stdout).toMatch(/STYL-203/);

    const missingAnon = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_ENV: 'staging',
        NEXT_PUBLIC_SUPABASE_URL: STAGING_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
        SUPABASE_ANON_KEY: '',
      },
    });
    expect(missingAnon.status).toBe(1);
    expect(missingAnon.stderr + missingAnon.stdout).toMatch(/ANON_KEY/);

    const ok = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_ENV: 'staging',
        NEXT_PUBLIC_SUPABASE_URL: STAGING_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      },
    });
    expect(ok.status).toBe(0);
  });
});
