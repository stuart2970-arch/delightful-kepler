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
            const filters: Array<[string, string, any]> = [];
            const apply = async () => {
              for (let index = purchases.length - 1; index >= 0; index -= 1) {
                const row = purchases[index];
                const ok = filters.every(([op, column, value]) => {
                  if (op === 'eq') return row[column] === value;
                  if (op === 'neq') return row[column] !== value;
                  return true;
                });
                if (ok) purchases.splice(index, 1);
              }
              return { data: [], error: null };
            };
            const chain: any = {
              eq(column: string, value: string) {
                filters.push(['eq', column, value]);
                return chain;
              },
              neq(column: string, value: string) {
                filters.push(['neq', column, value]);
                return chain;
              },
              then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
                return apply().then(resolve, reject);
              },
            };
            return chain;
          },
        };
      },
    };
    const result = await clearTenantPhonePurchase(store, TENANT);
    expect(result.error).toBeNull();
    expect(purchases).toHaveLength(0);
  });

  test('deprovision keeps orphan reservation rows', async () => {
    const src = readFileSync(join(root, 'src/lib/telephony/provision-safety.ts'), 'utf8');
    expect(src).toMatch(/neq\('status', 'orphan'\)/);
    const purchases: Array<Record<string, unknown>> = [{ tenant_id: TENANT, status: 'orphan', twilio_sid: 'PN1' }];
    const store = {
      from() {
        return {
          delete() {
            const filters: Array<[string, string, any]> = [];
            const apply = async () => {
              for (let index = purchases.length - 1; index >= 0; index -= 1) {
                const row = purchases[index];
                const ok = filters.every(([op, column, value]) => {
                  if (op === 'eq') return row[column] === value;
                  if (op === 'neq') return row[column] !== value;
                  return true;
                });
                if (ok) purchases.splice(index, 1);
              }
              return { data: [], error: null };
            };
            const chain: any = {
              eq(column: string, value: string) {
                filters.push(['eq', column, value]);
                return chain;
              },
              neq(column: string, value: string) {
                filters.push(['neq', column, value]);
                return chain;
              },
              then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
                return apply().then(resolve, reject);
              },
            };
            return chain;
          },
        };
      },
    };
    const result = await clearTenantPhonePurchase(store, TENANT);
    expect(result.error).toBeNull();
    expect(purchases).toHaveLength(1);
    expect(purchases[0].status).toBe('orphan');
  });
});
