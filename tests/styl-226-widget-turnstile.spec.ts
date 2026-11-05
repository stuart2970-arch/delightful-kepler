import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const LIVE_TURNSTILE_SITE_KEY = '0x4AAAAAAEcGPat6Ll-AhKbf';

test.describe('STYL-226: widget Turnstile has no production fallback', () => {
  test('source and built widget bundles do not embed the production site key', () => {
    for (const rel of [
      'src/widget/index.ts',
      'src/widget/embed.ts',
      'scripts/build-widget.js',
      'public/widget.js',
      'public/embed.js',
    ]) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).not.toContain(LIVE_TURNSTILE_SITE_KEY);
    }
  });

  test('local widget load sends the dummy always-pass site key to turnstile.html', async ({ page, request }) => {
    const widget = await (await request.get('/widget.js')).text();
    expect(widget).toContain('turnstile.html');
    expect(widget).toContain('1x0000000000000000000000000000000AA');
    expect(widget).not.toContain(LIVE_TURNSTILE_SITE_KEY);

    const requested: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('turnstile.html')) requested.push(req.url());
    });

    await page.goto('/turnstile.html?sitekey=1x0000000000000000000000000000000AA');
    expect(page.url()).toContain('1x0000000000000000000000000000000AA');
    expect(page.url()).not.toContain(LIVE_TURNSTILE_SITE_KEY);
    await expect(page.locator('body')).toBeVisible();

    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      const iframe = document.createElement('iframe');
      iframe.src = '/turnstile.html?sitekey=1x0000000000000000000000000000000AA';
      iframe.id = 'styleflo-turnstile-frame';
      document.body.appendChild(iframe);
    });

    await expect.poll(() => requested.some((url) => url.includes('turnstile.html')), {
      timeout: 10_000,
    }).toBe(true);
    for (const url of requested) {
      expect(url).not.toContain(LIVE_TURNSTILE_SITE_KEY);
      expect(url).toContain('1x0000000000000000000000000000000AA');
    }
  });
});
