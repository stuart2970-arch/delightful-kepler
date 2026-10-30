import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIVE_SUPABASE_PROJECT_REF } from '../src/lib/env/live-supabase-guard';

const root = process.cwd();

const REQUIRED_SECRET_NAMES = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'VAPI_API_KEY',
  'NEXT_PUBLIC_VAPI_PUBLIC_KEY',
  'VAPI_MASTER_ASSISTANT_ID',
  'VAPI_PRIVATE_API_KEY',
  'VAPI_PRIVATE_KEY',
  'VAPI_PUBLIC_KEY',
  'VAPI_SECRET_KEY',
  'MAILGUN_API_KEY',
  'MAILGUN_DOMAIN',
  'CRON_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET',
  'ELEVENLABS_API_KEY',
  'GOOGLE_PLACES_SERVER_API_KEY',
];

const REQUIRED_TWILIO_SID_NAMES = [
  'TWILIO_BUNDLE_SID_LOCAL',
  'TWILIO_BUNDLE_SID_MOBILE',
  'TWILIO_ADDRESS_SID',
];

test.describe('STYL-226: App Hosting staging secrets and public URL', () => {
  test('both yaml files use the staging custom domain and never the live ref', () => {
    const base = readFileSync(join(root, 'apphosting.yaml'), 'utf8');
    const staging = readFileSync(join(root, 'apphosting.staging.yaml'), 'utf8');
    expect(base).toContain('https://staging.styleflo.ai');
    expect(staging).toContain('https://staging.styleflo.ai');
    expect(base).not.toContain(LIVE_SUPABASE_PROJECT_REF);
    expect(staging).not.toContain(LIVE_SUPABASE_PROJECT_REF);
    expect(base).not.toContain('sk_live');
    expect(staging).not.toContain('sk_live');
  });

  test('staging yaml lists the wired secret names and Twilio SID names, not WordPress', () => {
    const staging = readFileSync(join(root, 'apphosting.staging.yaml'), 'utf8');
    for (const name of REQUIRED_SECRET_NAMES) {
      expect(staging, name).toContain(`variable: ${name}`);
    }
    for (const name of REQUIRED_TWILIO_SID_NAMES) {
      expect(staging, name).toContain(`variable: ${name}`);
    }
    expect(staging).toContain('secret: STRIPE_SECRET_KEY');
    expect(staging).not.toContain('STYLEFLO_WP_API_SECRET');
    expect(staging).not.toContain('STYLEFLO_WP_CREATE_BUSINESS_TOKEN');
    expect(staging).not.toContain('WPMUDEV_WEBHOOK_SECRET');

    const envBody = staging
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    expect(envBody).not.toMatch(/^\s*value:\s*["']{2}\s*$/m);
  });

  test('check:apphosting-yaml and check:staging-no-live-ref still pass', async () => {
    const { spawnSync } = await import('node:child_process');
    const yaml = spawnSync(process.execPath, [join(root, 'scripts/check-apphosting-yaml.mjs')], {
      encoding: 'utf8',
      cwd: root,
    });
    expect(yaml.status, yaml.stderr + yaml.stdout).toBe(0);

    const live = spawnSync(process.execPath, [join(root, 'scripts/check-staging-no-live-ref.mjs')], {
      encoding: 'utf8',
      cwd: root,
    });
    expect(live.status, live.stderr + live.stdout).toBe(0);
  });
});
