import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const LIVE_TURNSTILE_SITE_KEY = '0x4AAAAAAEcGPat6Ll-AhKbf';

test.describe('STYL-226: local widget bundle uses the dummy Turnstile site key', () => {
  test('built widget bundles do not embed the production site key', () => {
    for (const rel of [
      'scripts/build-widget.js',
      'public/widget.js',
      'public/embed.js',
    ]) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).not.toContain(LIVE_TURNSTILE_SITE_KEY);
    }
    for (const rel of ['src/widget/index.ts', 'src/widget/embed.ts']) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).not.toMatch(/typeof process\s*!==\s*['"]undefined['"]/);
      expect(src, rel).toContain('process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY');
      expect(src, rel).toContain('/api/config/public');
      expect(src, rel).not.toContain(LIVE_TURNSTILE_SITE_KEY);
    }
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('npm run build');
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('build:widget');
  });

  test('local widget load sends the dummy always-pass site key to turnstile.html', async ({ page, request }) => {
    const config = await request.get('/api/config/public');
    expect(config.ok()).toBeTruthy();
    const { turnstileSiteKey } = (await config.json()) as { turnstileSiteKey: string };
    expect(turnstileSiteKey).toBe('1x0000000000000000000000000000000AA');

    const widget = await (await request.get('/widget.js')).text();
    expect(widget).toContain('turnstile.html');
    expect(widget).toContain('/api/config/public');
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
