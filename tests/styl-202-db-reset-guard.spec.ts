import { test, expect } from '@playwright/test';
import {
  LIVE_SUPABASE_PROJECT_REF,
  STAGING_SUPABASE_PROJECT_REF,
  isLiveSupabaseTarget,
  assertSafeDbResetTarget,
  parseDbResetArgs,
  buildSupabaseResetArgs,
  collectTargetHints,
} from '../src/lib/env/db-reset-guard';

test.describe('STYL-202: db:reset refuses live Supabase', () => {
  test('detects the live project ref in URLs and env-like strings', () => {
    expect(isLiveSupabaseTarget(`https://${LIVE_SUPABASE_PROJECT_REF}.supabase.co`)).toBe(true);
    expect(
      isLiveSupabaseTarget(
        `postgresql://postgres:x@db.${LIVE_SUPABASE_PROJECT_REF}.supabase.co:5432/postgres`,
      ),
    ).toBe(true);
    expect(isLiveSupabaseTarget(LIVE_SUPABASE_PROJECT_REF)).toBe(true);
    expect(isLiveSupabaseTarget(`https://${STAGING_SUPABASE_PROJECT_REF}.supabase.co`)).toBe(false);
    expect(isLiveSupabaseTarget('http://127.0.0.1:54321')).toBe(false);
    expect(isLiveSupabaseTarget('')).toBe(false);
    expect(isLiveSupabaseTarget(undefined)).toBe(false);
  });

  test('assertSafeDbResetTarget blocks live --db-url and live env hints', () => {
    const liveUrl = `https://${LIVE_SUPABASE_PROJECT_REF}.supabase.co`;
    const blocked = assertSafeDbResetTarget({ dbUrl: liveUrl }, {});
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toContain(LIVE_SUPABASE_PROJECT_REF);
    }

    const blockedEnv = assertSafeDbResetTarget({}, { NEXT_PUBLIC_SUPABASE_URL: liveUrl });
    expect(blockedEnv.ok).toBe(false);

    const stagingOk = assertSafeDbResetTarget(
      { dbUrl: `https://${STAGING_SUPABASE_PROJECT_REF}.supabase.co` },
      { NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_SUPABASE_PROJECT_REF}.supabase.co` },
    );
    expect(stagingOk.ok).toBe(true);

    const localOk = assertSafeDbResetTarget(
      {},
      { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' },
    );
    expect(localOk.ok).toBe(true);
  });

  test('parseDbResetArgs and buildSupabaseResetArgs wire linked / db-url flags', () => {
    const parsed = parseDbResetArgs(['--linked', '--db-url', 'postgresql://staging.example/db']);
    expect(parsed.linked).toBe(true);
    expect(parsed.dbUrl).toBe('postgresql://staging.example/db');
    expect(parsed.yes).toBe(true);

    const args = buildSupabaseResetArgs(parsed);
    expect(args).toEqual([
      'supabase',
      'db',
      'reset',
      '--yes',
      '--linked',
      '--db-url',
      'postgresql://staging.example/db',
    ]);
  });

  test('collectTargetHints gathers db URL and common env keys', () => {
    const hints = collectTargetHints(
      { dbUrl: 'postgresql://local/db' },
      {
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_PROJECT_REF: STAGING_SUPABASE_PROJECT_REF,
      },
    );
    expect(hints).toContain('postgresql://local/db');
    expect(hints).toContain('http://127.0.0.1:54321');
    expect(hints).toContain(STAGING_SUPABASE_PROJECT_REF);
  });
});
