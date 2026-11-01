import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

test.describe('STYL-226: connected-accounts drops VAPI_SECRET_KEY alias', () => {
  test('superadmin connected-accounts does not read VAPI_SECRET_KEY', () => {
    const src = readFileSync(join(root, 'src/app/api/superadmin/connected-accounts/route.ts'), 'utf8');
    expect(src).not.toContain('VAPI_SECRET_KEY');
    expect(src).toContain('VAPI_API_KEY');
  });
});
