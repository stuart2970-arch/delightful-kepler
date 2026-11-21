import { expect, test } from '@playwright/test';
import { createTestUser } from './test-auth-helper';
import { verifyOAuthState } from '../src/lib/auth/oauth-state';

const ACME = '10000000-0000-0000-0000-000000000001';

function assertNoCalendarSignInParams(url: string, context: string) {
  const lower = url.toLowerCase();
  expect(lower, context).not.toContain('auth%2Fcalendar');
  expect(lower, context).not.toMatch(/auth\/calendar(?!\.)/);
  expect(lower, context).not.toContain('prompt=consent');
  expect(lower, context).not.toContain('access_type=offline');

  if (url.includes('accounts.google.com')) {
    const params = new URL(url).searchParams;
    expect(params.get('prompt'), context).not.toBe('consent');
    expect(params.get('access_type'), context).not.toBe('offline');
    const scope = decodeURIComponent(params.get('scope') || '');
    expect(scope, context).not.toMatch(/https:\/\/www\.googleapis\.com\/auth\/calendar([^./]|$)/);
  }

  if (url.includes('/auth/v1/authorize')) {
    const params = new URL(url).searchParams;
    const scopes = params.get('scopes') || '';
    expect(scopes, context).not.toContain('calendar');
    expect(params.get('prompt'), context).not.toBe('consent');
  }
}

async function captureGoogleSignInUrl(page: import('@playwright/test').Page, path: string) {
  let captured = '';
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/authorize') || url.includes('accounts.google.com')) {
      captured = url;
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.goto(path);
  if (path === '/onboard') {
    await page.waitForFunction(() => {
      return typeof (window as Window & { stylefloGoogleSignIn?: () => void }).stylefloGoogleSignIn === 'function';
    });
    await page.evaluate(() => {
      const w = window as Window & { stylefloGoogleSignIn?: () => void };
      w.stylefloGoogleSignIn?.();
    });
  } else {
    await page.getByRole('button', { name: /1-Click with Google/i }).click({ force: true });
  }
  await expect
    .poll(() => captured, { timeout: 15_000, message: `Expected OAuth request from ${path}` })
    .not.toBe('');

  await page.unroute('**/*');
  return captured;
}

test.describe('STYL-231 Google sign-in vs calendar connect scopes', () => {
  test('login, register and onboard Google sign-in omit calendar scope and consent offline params', async ({
    page,
  }) => {
    for (const path of ['/login', '/register', '/onboard'] as const) {
      const captured = await captureGoogleSignInUrl(page, path);
      assertNoCalendarSignInParams(captured, path);
    }
  });

  test('calendar connect authorisation requests incremental calendar scopes with offline consent', async ({
    request,
  }) => {
    const owner = await createTestUser({ tenantId: ACME, role: 'owner' });
    try {
      const google = await request.get('/api/integrations/google/authorize', {
        headers: { Authorization: `Bearer ${owner.token}` },
        maxRedirects: 0,
      });
      expect(google.status()).toBeGreaterThanOrEqual(300);
      expect(google.status()).toBeLessThan(400);
      const location = google.headers().location || '';
      expect(location).toContain('accounts.google.com');

      const params = new URL(location).searchParams;
      expect(params.get('access_type')).toBe('offline');
      expect(params.get('prompt')).toBe('consent');

      const scope = decodeURIComponent(params.get('scope') || '');
      expect(scope).toContain('https://www.googleapis.com/auth/calendar.events');
      expect(scope).toContain('https://www.googleapis.com/auth/calendar.readonly');

      const claims = verifyOAuthState(params.get('state'));
      expect(claims?.userId).toBe(owner.user.id);
      expect(claims?.tenantId).toBe(ACME);
    } finally {
      await owner.cleanup();
    }
  });
});