import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clearTenantPhonePurchase } from '../src/lib/telephony/provision-safety';

const TENANT = '10000000-0000-0000-0000-000000000002';
const root = process.cwd();

test.describe('STYL-226: deprovision clears the phone reservation', () => {
  test('deprovision route clears tenant_phone_number_purchases', () => {
    const src = readFileSync(join(root, 'src/app/api/telephony/deprovision/route.ts'), 'utf8');
    expect(src).toContain('clearTenantPhonePurchase');
    expect(src.match(/clearTenantPhonePurchase/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test('clearTenantPhonePurchase removes the unique reservation row', async () => {
    const purchases: Array<Record<string, unknown>> = [{ tenant_id: TENANT, status: 'active' }];
    const store = {
      from() {
        return {
          insert: async () => ({ error: null }),
          update: () => ({ eq: async () => ({ error: null }) }),
          delete() {
            return {
              async eq(column: string, value: string) {
                const index = purchases.findIndex((row) => row[column] === value);
                if (index >= 0) purchases.splice(index, 1);
                return { error: null };
              },
            };
          },
        };
      },
    };
    const result = await clearTenantPhonePurchase(store, TENANT);
    expect(result.error).toBeNull();
    expect(purchases).toHaveLength(0);
  });
});
