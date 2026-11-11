import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIVE_SUPABASE_PROJECT_REF } from '../src/lib/env/live-supabase-guard';

const root = process.cwd();

const REQUIRED_SECRET_NAMES = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PORTAL_CONFIG_OWNER',
  'STRIPE_PORTAL_CONFIG_ADMIN',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'VAPI_API_KEY',
  'NEXT_PUBLIC_VAPI_PUBLIC_KEY',
  'VAPI_MASTER_ASSISTANT_ID',
  'VAPI_PRIVATE_API_KEY',
  'VAPI_PRIVATE_KEY',
  'VAPI_PUBLIC_KEY',
  'VAPI_WEBHOOK_SECRET',
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
    expect(staging).toContain('secret: VAPI_WEBHOOK_SECRET');
    expect(staging).not.toContain('VAPI_SECRET_KEY');
    expect(staging).toContain('variable: VOICE_ENABLED');
    expect(staging).toMatch(/variable: VOICE_ENABLED\n\s+value: ["']?false["']?/);
    expect(staging).not.toContain('secret: VOICE_ENABLED');
    expect(staging).not.toContain('STYLEFLO_WP_API_SECRET');
    expect(staging).not.toContain('WPMUDEV_WEBHOOK_SECRET');
    expect(staging).not.toContain('https://styleflo.ai');
    expect(staging).not.toContain('projects/styleflo-ai');
    expect(staging).not.toContain('NEXT_PUBLIC_META_APP_ID');
    expect(staging).not.toContain('NEXT_PUBLIC_META_ES_CONFIG_ID');
    expect(staging).not.toContain('NEXT_PUBLIC_META_GRAPH_VERSION');

    // Production App Hosting (styleflo-ai / delightful-kepler-1) reads the base
    // file only. Those bindings stay. The staging file replaces the ones
    // styleflo-staging cannot resolve; omission would keep the base secret.
    const base = readFileSync(join(root, 'apphosting.yaml'), 'utf8');
    const nonComment = (text: string) =>
      text
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n');
    const envBlockFrom = (text: string, variable: string) => {
      const body = nonComment(text);
      const marker = `- variable: ${variable}`;
      const start = body.indexOf(marker);
      expect(start, variable).toBeGreaterThanOrEqual(0);
      const next = body.indexOf('\n  - variable:', start + marker.length);
      return body.slice(start, next === -1 ? undefined : next).trim();
    };
    const envBlock = (variable: string) => envBlockFrom(base, variable);
    const secretBinding = (variable: string) =>
      [
        `- variable: ${variable}`,
        `    secret: ${variable}`,
        '    availability:',
        '      - RUNTIME',
      ].join('\n');

    expect(envBlock('TENANT_CREATED_WEBHOOK_SECRET')).toBe(
      secretBinding('TENANT_CREATED_WEBHOOK_SECRET'),
    );
    expect(envBlock('WORDPRESS_SITE_URL')).toBe(
      [
        '- variable: WORDPRESS_SITE_URL',
        '    value: "https://styleflo.ai"',
        '    availability:',
        '      - RUNTIME',
      ].join('\n'),
    );
    expect(envBlock('STYLEFLO_WP_CREATE_BUSINESS_TOKEN')).toBe(
      secretBinding('STYLEFLO_WP_CREATE_BUSINESS_TOKEN'),
    );
    expect(envBlock('STYLEFLO_WP_CREATE_BUSINESS_TOKEN')).not.toContain('STYLEFLO_WP_API_SECRET');
    expect(envBlock('META_APP_SECRET')).toBe(secretBinding('META_APP_SECRET'));
    expect(envBlock('TOKEN_ENC_KEY')).toBe(secretBinding('TOKEN_ENC_KEY'));

    const blankOverride = (variable: string) =>
      [
        `- variable: ${variable}`,
        '    value: "   "',
        '    availability:',
        '      - RUNTIME',
      ].join('\n');
    expect(envBlockFrom(staging, 'TENANT_CREATED_WEBHOOK_SECRET')).toBe(
      blankOverride('TENANT_CREATED_WEBHOOK_SECRET'),
    );
    expect(envBlockFrom(staging, 'STYLEFLO_WP_CREATE_BUSINESS_TOKEN')).toBe(
      blankOverride('STYLEFLO_WP_CREATE_BUSINESS_TOKEN'),
    );
    expect(envBlockFrom(staging, 'META_APP_SECRET')).toBe(blankOverride('META_APP_SECRET'));
    expect(envBlockFrom(staging, 'WORDPRESS_SITE_URL')).toBe(
      [
        '- variable: WORDPRESS_SITE_URL',
        '    value: "https://wordpress.invalid"',
        '    availability:',
        '      - RUNTIME',
      ].join('\n'),
    );
    expect(envBlockFrom(staging, 'TOKEN_ENC_KEY')).toBe(secretBinding('TOKEN_ENC_KEY'));

    const secretNames = nonComment(staging)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('secret:'))
      .map((line) => line.replace(/^secret:\s*/, '').trim());
    for (const forbidden of [
      'TENANT_CREATED_WEBHOOK_SECRET',
      'STYLEFLO_WP_CREATE_BUSINESS_TOKEN',
      'META_APP_SECRET',
      'STYLEFLO_WP_API_SECRET',
      'WPMUDEV_WEBHOOK_SECRET',
    ]) {
      expect(secretNames, forbidden).not.toContain(forbidden);
    }

    // Documented merge: environment file wins per variable; other base entries stay.
    const namesIn = (text: string) => {
      const names: string[] = [];
      for (const match of nonComment(text).matchAll(/- variable: ([A-Z0-9_]+)/g)) {
        names.push(match[1]);
      }
      return names;
    };
    const effective = new Map<string, string>();
    for (const name of namesIn(base)) effective.set(name, envBlockFrom(base, name));
    for (const name of namesIn(staging)) effective.set(name, envBlockFrom(staging, name));
    for (const name of [
      'TENANT_CREATED_WEBHOOK_SECRET',
      'STYLEFLO_WP_CREATE_BUSINESS_TOKEN',
      'META_APP_SECRET',
    ]) {
      expect(effective.get(name), name).toBe(blankOverride(name));
      expect(effective.get(name), name).not.toContain('secret:');
    }
    expect(effective.get('WORDPRESS_SITE_URL')).toBe(
      envBlockFrom(staging, 'WORDPRESS_SITE_URL'),
    );
    expect(effective.get('WORDPRESS_SITE_URL')).not.toContain('https://styleflo.ai');
    expect(effective.get('TOKEN_ENC_KEY')).toBe(secretBinding('TOKEN_ENC_KEY'));
    expect(effective.get('NEXT_PUBLIC_META_APP_ID')).toContain('value:');
    expect(effective.get('NEXT_PUBLIC_META_APP_ID')).not.toContain('secret:');

    const envBody = nonComment(staging);
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
