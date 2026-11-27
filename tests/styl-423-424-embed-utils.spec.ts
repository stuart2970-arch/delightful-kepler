import { test, expect } from '@playwright/test';
import {
  embedParentAppEntryUrl,
  embedAwarePublicPath,
  resolveEmbedParentOrigin,
} from '../src/lib/env/embed-parent';
import { resolveSfPathRedirect } from '../src/lib/env/embed-context';
import {
  isAllowedEmbedParentReturnUrl,
  publicAppPath,
  safePublicReturnUrl,
} from '../src/lib/env/public-app-url';

const stagingEnv = {
  NEXT_PUBLIC_APP_URL: 'https://staging.styleflo.ai',
  APP_ENV: 'staging',
  NEXT_PUBLIC_EMBED_PARENT_URL: 'https://staging.styleflo.ai',
};

test.describe('STYL-423/424 embed URL helpers', () => {
  test('embeddedReturnUrl server entry builds parent /app/ with sf_path', () => {
    const url = embedParentAppEntryUrl(
      '/dashboard?tab=billing&addon=google_calendar_addon',
      {},
      stagingEnv,
    );
    expect(url).toContain('https://staging.styleflo.ai/app/');
    expect(url).toContain('sf_path=%2Fdashboard');
    expect(url).toContain('tab=billing');
  });

  test('safePublicReturnUrl accepts app origin and parent /app/', () => {
    const fallback = publicAppPath('/dashboard', stagingEnv);
    expect(
      safePublicReturnUrl('https://staging.styleflo.ai/dashboard?tab=billing', fallback, stagingEnv),
    ).toBe('https://staging.styleflo.ai/dashboard?tab=billing');
    expect(
      safePublicReturnUrl(
        'https://staging.styleflo.ai/app/?sf_path=%2Fdashboard&tab=billing',
        fallback,
        stagingEnv,
      ),
    ).toBe('https://staging.styleflo.ai/app/?sf_path=%2Fdashboard&tab=billing');
    expect(safePublicReturnUrl('https://evil.example/app/', fallback, stagingEnv)).toBe(fallback);
  });

  test('isAllowedEmbedParentReturnUrl rejects non-/app paths on parent', () => {
    expect(
      isAllowedEmbedParentReturnUrl('https://staging.styleflo.ai/pricing', stagingEnv),
    ).toBe(false);
    expect(
      isAllowedEmbedParentReturnUrl('https://staging.styleflo.ai/app/', stagingEnv),
    ).toBe(true);
  });

  test('embedAwarePublicPath stays on app origin by default', () => {
    expect(embedAwarePublicPath('/login', stagingEnv)).toBe(
      'https://staging.styleflo.ai/login',
    );
  });

  test('embedAwarePublicPath can target parent when flag enabled', () => {
    expect(
      embedAwarePublicPath('/login', {
        ...stagingEnv,
        NEXT_PUBLIC_EMBED_EMAIL_VIA_PARENT: 'true',
      }),
    ).toContain('/app/?sf_path=%2Flogin');
  });

  test('resolveSfPathRedirect merges query encoded inside sf_path', () => {
    const params = new URLSearchParams(
      'embed=styleflo&sf_path=%2Fdashboard%3Ftab%3Dbilling&checkout_status=success',
    );
    expect(resolveSfPathRedirect(params)).toBe(
      '/dashboard?tab=billing&checkout_status=success',
    );
  });

  test('resolveEmbedParentOrigin prefers NEXT_PUBLIC_EMBED_PARENT_URL', () => {
    expect(resolveEmbedParentOrigin({ NEXT_PUBLIC_EMBED_PARENT_URL: 'https://styleflo.ai' })).toBe(
      'https://styleflo.ai',
    );
  });
});