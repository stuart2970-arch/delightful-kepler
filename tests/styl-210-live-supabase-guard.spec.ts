import { test, expect } from '@playwright/test';
import {
  LIVE_SUPABASE_PROJECT_REF,
  LIVE_SUPABASE_URL,
  formatLiveSupabaseWarning,
  isLiveSupabaseUrl,
  resolveAppEnv,
  shouldWarnAboutLiveSupabase,
  warnIfLiveSupabaseInNonProduction,
} from '../src/lib/env/live-supabase-guard';

test.describe('STYL-210: live Supabase guard', () => {
  test('detects the live project URL and ignores local/staging URLs', () => {
    expect(isLiveSupabaseUrl(LIVE_SUPABASE_URL)).toBe(true);
    expect(isLiveSupabaseUrl(`https://${LIVE_SUPABASE_PROJECT_REF}.supabase.co/`)).toBe(true);
    expect(isLiveSupabaseUrl('http://127.0.0.1:54321')).toBe(false);
    expect(isLiveSupabaseUrl('http://localhost:54321')).toBe(false);
    expect(isLiveSupabaseUrl('https://staging-example.supabase.co')).toBe(false);
    expect(isLiveSupabaseUrl(undefined)).toBe(false);
    expect(isLiveSupabaseUrl('')).toBe(false);
  });

  test('resolveAppEnv prefers APP_ENV and falls back to NODE_ENV for production', () => {
    expect(resolveAppEnv({ APP_ENV: 'staging', NODE_ENV: 'production' })).toBe('staging');
    expect(resolveAppEnv({ APP_ENV: 'production', NODE_ENV: 'development' })).toBe('production');
    // Cloud Run / Docker today: NODE_ENV=production, APP_ENV unset
    expect(resolveAppEnv({ NODE_ENV: 'production' })).toBe('production');
    expect(resolveAppEnv({ NODE_ENV: 'development' })).toBe('development');
    expect(resolveAppEnv({})).toBe('development');
  });

  test('warns for live URL outside production, including unset APP_ENV in development', () => {
    expect(
      shouldWarnAboutLiveSupabase({
        NEXT_PUBLIC_SUPABASE_URL: LIVE_SUPABASE_URL,
        NODE_ENV: 'development',
      }),
    ).toBe(true);

    expect(
      shouldWarnAboutLiveSupabase({
        NEXT_PUBLIC_SUPABASE_URL: LIVE_SUPABASE_URL,
        APP_ENV: 'staging',
        NODE_ENV: 'production',
      }),
    ).toBe(true);

    expect(
      shouldWarnAboutLiveSupabase({
        NEXT_PUBLIC_SUPABASE_URL: LIVE_SUPABASE_URL,
        APP_ENV: 'test',
      }),
    ).toBe(true);
  });

  test('does not warn in production — including Cloud Run with APP_ENV unset', () => {
    // Explicit APP_ENV=production
    expect(
      shouldWarnAboutLiveSupabase({
        NEXT_PUBLIC_SUPABASE_URL: LIVE_SUPABASE_URL,
        APP_ENV: 'production',
        NODE_ENV: 'production',
      }),
    ).toBe(false);

    // Production Docker/Cloud Run: APP_ENV unset, NODE_ENV=production (no config change required)
    expect(
      shouldWarnAboutLiveSupabase({
        NEXT_PUBLIC_SUPABASE_URL: LIVE_SUPABASE_URL,
        NODE_ENV: 'production',
      }),
    ).toBe(false);

    // Local stack never warns
    expect(
      shouldWarnAboutLiveSupabase({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NODE_ENV: 'development',
      }),
    ).toBe(false);
  });

  test('warnIfLiveSupabaseInNonProduction logs once-style message and is a no-op in production', () => {
    const warnings: unknown[][] = [];
    const logger = { warn: (...args: unknown[]) => warnings.push(args) };

    const warned = warnIfLiveSupabaseInNonProduction(
      {
        NEXT_PUBLIC_SUPABASE_URL: LIVE_SUPABASE_URL,
        NODE_ENV: 'development',
      },
      logger,
    );
    expect(warned).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0][0])).toContain('[STYL-210]');
    expect(String(warnings[0][0])).toContain(LIVE_SUPABASE_PROJECT_REF);

    warnings.length = 0;
    const silent = warnIfLiveSupabaseInNonProduction(
      {
        NEXT_PUBLIC_SUPABASE_URL: LIVE_SUPABASE_URL,
        NODE_ENV: 'production',
      },
      logger,
    );
    expect(silent).toBe(false);
    expect(warnings).toHaveLength(0);

    expect(formatLiveSupabaseWarning(LIVE_SUPABASE_URL)).toContain('LIVE Supabase');
  });
});
