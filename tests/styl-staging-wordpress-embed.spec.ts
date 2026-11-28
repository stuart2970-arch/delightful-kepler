import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extraStagingEmbedParentOrigins, resolveEmbedParentOrigins } from '../src/lib/env/embed-parent';
import { isAllowedEmbedParentReturnUrl } from '../src/lib/env/public-app-url';

const STAGING_WP = 'https://styleflo-final.staging.tempurl.host';

test.describe('Staging WordPress parent embed allowlist', () => {
  test('next.config staging CSP includes tempurl host when APP_ENV is staging', () => {
    // next.config reads process.env at load time; assert source shape.
    const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');
    expect(config).toContain(STAGING_WP);
    expect(config).toContain('isStaging');
  });

  test('embed helpers allow staging WordPress /app/ return URL', () => {
    const env = { APP_ENV: 'staging', NEXT_PUBLIC_APP_URL: 'https://staging.styleflo.ai' };
    expect(extraStagingEmbedParentOrigins(env)).toContain(STAGING_WP);
    expect(resolveEmbedParentOrigins(env)).toContain(STAGING_WP);
    expect(
      isAllowedEmbedParentReturnUrl(`${STAGING_WP}/app/?sf_path=%2Fdashboard`, env),
    ).toBe(true);
  });
});