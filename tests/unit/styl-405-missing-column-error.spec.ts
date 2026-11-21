import { test, expect } from '@playwright/test';
import {
  isPostgresMissingColumnError,
  missingPostgresColumnName,
  MINIMAL_TENANT_ACTIVE_ADDON_COLUMNS,
} from '../../src/lib/postgres/missing-column-error';
import { shouldFallbackStripeCancelGuardColumn as shouldFallbackGuard } from '../../src/lib/billing/process-stripe-webhook';

test.describe('STYL-405 missing column error parsing', () => {
  test('detects Postgres 42703 and PostgREST PGRST204', () => {
    expect(isPostgresMissingColumnError({ code: '42703', message: 'irrelevant' })).toBe(true);
    expect(isPostgresMissingColumnError({ code: 'PGRST204', message: 'irrelevant' })).toBe(true);
    expect(isPostgresMissingColumnError({ message: 'column foo.bar does not exist' })).toBe(true);
    expect(isPostgresMissingColumnError({ code: '42P01', message: 'relation missing' })).toBe(false);
  });

  test('parses unquoted, qualified, and PostgREST column names', () => {
    expect(
      missingPostgresColumnName({
        code: '42703',
        message: 'column tenant_active_addons.price_paid_pence does not exist',
      }),
    ).toBe('price_paid_pence');
    expect(
      missingPostgresColumnName({
        code: 'PGRST204',
        message: "Could not find the 'stripe_cancel_event_created_at' column of 'tenant_active_addons' in the schema cache",
      }),
    ).toBe('stripe_cancel_event_created_at');
    expect(
      missingPostgresColumnName({
        code: '42703',
        message: 'column "stripe_cancel_event_created_at" of relation "tenant_active_addons" does not exist',
      }),
    ).toBe('stripe_cancel_event_created_at');
  });

  test('returns null for unparseable missing-column errors', () => {
    expect(
      missingPostgresColumnName({ code: '42703', message: 'column reference "bad name" is ambiguous' }),
    ).toBeNull();
  });

  test('exposes a minimal safe tenant_active_addons column list', () => {
    expect(MINIMAL_TENANT_ACTIVE_ADDON_COLUMNS).toEqual([
      'id',
      'addon_catalog_id',
      'quantity',
      'is_active',
    ]);
  });

  test('stripe cancel guard falls back when the guard column is missing or unknown', () => {
    const guardMissing = {
      code: 'PGRST204',
      message: "Could not find the 'stripe_cancel_event_created_at' column of 'tenant_active_addons' in the schema cache",
    };
    expect(shouldFallbackGuard(guardMissing, { includesGuardColumn: true })).toBe(true);

    const unknownColumn = { code: '42703', message: 'column reference "foo" is ambiguous' };
    expect(shouldFallbackGuard(unknownColumn, { includesGuardColumn: true })).toBe(true);
    expect(shouldFallbackGuard(unknownColumn, { includesGuardColumn: false })).toBe(false);
    expect(shouldFallbackGuard(unknownColumn, { updatingGuardColumn: true })).toBe(true);

    const otherMissing = {
      code: '42703',
      message: 'column tenant_active_addons.cancel_at does not exist',
    };
    expect(shouldFallbackGuard(otherMissing, { includesGuardColumn: true })).toBe(false);
  });
});