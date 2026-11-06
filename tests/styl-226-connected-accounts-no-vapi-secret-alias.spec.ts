import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

test.describe('STYL-226: VAPI_SECRET_KEY alias is gone', () => {
  test('no remaining VAPI_SECRET_KEY readers or aliases', () => {
    for (const rel of [
      'src/app/api/superadmin/connected-accounts/route.ts',
      'apphosting.staging.yaml',
      'docs/staging.md',
      '.env.example',
      'scripts/write-local-env.mjs',
      'src/lib/env/vapi-config.ts',
    ]) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).not.toContain('VAPI_SECRET_KEY');
    }
  });
});
