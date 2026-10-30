import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  authRateLimitPerIp,
  CHECK_EMAIL_LIMITS,
  MAGIC_LINK_LIMITS,
} from '@/lib/security/auth-rate-limit';
import { readTurnstileSecret } from '@/lib/security/turnstile';

/**
 * STYL-228 hotfix: production Docker builds must inline the public Turnstile
 * site key, /login must render the widget when that key is set, and the
 * per-IP auth limit must default to 20 unless the test env raises it.
 */

const root = path.resolve(__dirname, '..');

test.describe('STYL-228 Turnstile site key and auth rate limit', () => {
  test('the Docker builder receives the public Turnstile site key', () => {
    const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8');
    const buildAt = dockerfile.indexOf('RUN npm run build');
    expect(buildAt).toBeGreaterThan(0);
    const builder = dockerfile.slice(0, buildAt);
    expect(builder).toContain('ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=');
    expect(builder).toContain('ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY');
    expect(builder).toContain('NEXT_PUBLIC_TURNSTILE_SITE_KEY is empty');
    expect(dockerfile).toContain('Never pass CLOUDFLARE_TURNSTILE_SECRET_KEY');
    expect(dockerfile).not.toMatch(/^ARG\s+CLOUDFLARE_TURNSTILE_SECRET_KEY/m);
    expect(dockerfile).not.toMatch(/^ENV\s+CLOUDFLARE_TURNSTILE_SECRET_KEY/m);
  });

  test('deploy.yml passes the site key and smoke-checks /login', () => {
    const workflow = readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8');
    expect(workflow).toContain(
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY=${{ secrets.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ',
    );
    expect(workflow).toContain('Post-Deploy Login Turnstile Site Key Smoke Check');
    expect(workflow).toContain('data-sitekey=');
    expect(workflow).toContain('CLOUDFLARE_TURNSTILE_SECRET_KEY');
    expect(workflow).toContain('turnstile_secret_key');
    expect(workflow).not.toMatch(/CLOUDFLARE_TURNSTILE_SECRET_KEY\s*[:=]\s*\S+/);
  });

  test('the server reads CLOUDFLARE_TURNSTILE_SECRET_KEY by name', () => {
    const previous = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
    const alias = process.env.TURNSTILE_SECRET_KEY;
    try {
      delete process.env.TURNSTILE_SECRET_KEY;
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'configured';
      expect(readTurnstileSecret()).toBe('configured');
      delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
      expect(readTurnstileSecret()).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
      else process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = previous;
      if (alias === undefined) delete process.env.TURNSTILE_SECRET_KEY;
      else process.env.TURNSTILE_SECRET_KEY = alias;
    }
  });

  test('per-IP auth limit defaults to 20 and per-email stays 3', () => {
    const previous = process.env.AUTH_RATE_LIMIT_PER_IP;
    try {
      delete process.env.AUTH_RATE_LIMIT_PER_IP;
      expect(authRateLimitPerIp()).toBe(20);
      expect(MAGIC_LINK_LIMITS.ip).toBe(20);
      expect(MAGIC_LINK_LIMITS.email).toBe(3);
      expect(CHECK_EMAIL_LIMITS.ip).toBe(20);
      expect(CHECK_EMAIL_LIMITS.email).toBe(5);
      expect(MAGIC_LINK_LIMITS.windowSeconds).toBe(15 * 60);

      process.env.AUTH_RATE_LIMIT_PER_IP = '10000';
      expect(MAGIC_LINK_LIMITS.ip).toBe(10000);
      expect(CHECK_EMAIL_LIMITS.ip).toBe(10000);
      expect(MAGIC_LINK_LIMITS.email).toBe(3);

      process.env.AUTH_RATE_LIMIT_PER_IP = '0';
      expect(authRateLimitPerIp()).toBe(20);
      process.env.AUTH_RATE_LIMIT_PER_IP = 'nope';
      expect(authRateLimitPerIp()).toBe(20);
    } finally {
      if (previous === undefined) delete process.env.AUTH_RATE_LIMIT_PER_IP;
      else process.env.AUTH_RATE_LIMIT_PER_IP = previous;
    }
  });

  test('Playwright config raises the per-IP limit and day-to-day env does not', () => {
    const writer = readFileSync(path.join(root, 'scripts/write-local-env.mjs'), 'utf8');
    const branchAt = writer.indexOf('if (playwright)');
    expect(branchAt).toBeGreaterThan(0);
    expect(writer.slice(0, branchAt)).not.toContain('AUTH_RATE_LIMIT_PER_IP=10000');
    expect(writer.slice(branchAt)).toContain('AUTH_RATE_LIMIT_PER_IP=10000');

    const example = readFileSync(path.join(root, '.env.example'), 'utf8');
    expect(example).toContain('AUTH_RATE_LIMIT_PER_IP=');
    expect(example).not.toContain('AUTH_RATE_LIMIT_PER_IP=10000');

    const playwright = readFileSync(path.join(root, 'playwright.config.ts'), 'utf8');
    expect(playwright).toContain('AUTH_RATE_LIMIT_PER_IP');
    expect(playwright).toContain("'10000'");
  });

  test('login page renders the Turnstile widget when the site key is set', async ({ page }) => {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    expect(siteKey, 'NEXT_PUBLIC_TURNSTILE_SITE_KEY must be set for the test server').toBeTruthy();

    await page.goto('/login');
    const widget = page.getByTestId('turnstile-widget');
    await expect(widget).toBeVisible();
    await expect(widget).toHaveAttribute('data-sitekey', siteKey!);
    await expect(widget).toHaveAttribute('data-turnstile-rendered', /^(test|live)$/);
    await expect(widget).toHaveAttribute('aria-label', 'Security check');
    await expect(page.getByText('Security check is not configured')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Send Magic Login Link/i })).toBeVisible();
  });

  test('two magic-link sends consume distinct Turnstile tokens', async ({ page }) => {
    await page.addInitScript(() => {
      const win = window as Window & {
        __STYLEFLO_TEST_TURNSTILE_SITE_KEY__?: string;
        turnstile?: {
          render: (
            container: HTMLElement,
            options: { callback: (token: string) => void; 'error-callback'?: () => void },
          ) => string;
          reset: (widgetId: string) => void;
        };
      };
      win.__STYLEFLO_TEST_TURNSTILE_SITE_KEY__ = '0xTEST_SITE_KEY_NOT_DUMMY';
      let seq = 0;
      let lastCallback: ((token: string) => void) | null = null;
      const issue = () => {
        seq += 1;
        const token = `token-${seq}`;
        queueMicrotask(() => lastCallback?.(token));
        return token;
      };
      win.turnstile = {
        render(_container, options) {
          lastCallback = options.callback;
          issue();
          return 'widget-1';
        },
        reset() {
          issue();
        },
      };
    });

    const tokens: string[] = [];
    await page.route('**/api/auth/magic-link', async (route) => {
      tokens.push(route.request().headers()['x-turnstile-token'] || '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/login');
    const widget = page.getByTestId('turnstile-widget');
    await expect(widget).toBeVisible();
    await page.locator('input[type="email"]').fill('retry@test.styleflo.ai');
    await page.getByRole('button', { name: /Send Magic Login Link/i }).click();
    await expect.poll(() => tokens.length).toBe(1);
    await page.getByRole('button', { name: /Send Magic Login Link/i }).click();
    await expect.poll(() => tokens.length).toBe(2);
    expect(tokens[0]).toBe('token-1');
    expect(tokens[1]).toBe('token-2');
    expect(tokens[0]).not.toBe(tokens[1]);
    await expect(widget).toBeVisible();
  });
});
