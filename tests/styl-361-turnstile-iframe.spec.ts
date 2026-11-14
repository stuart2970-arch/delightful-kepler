import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * STYL-361: the first chat message failed closed with
 * "Security verification failed" because the widget could not obtain a
 * Turnstile token. The challenge must run in an app-origin iframe inside the
 * shadow-DOM chat panel, so a customer website's domain is never the
 * Turnstile hostname.
 */

const root = process.cwd();
const LIVE_SITE_KEY = '0x4AAAAAAEcGPat6Ll-AhKbf';
const DUMMY_SITE_KEY = '1x0000000000000000000000000000000AA';

function read(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

test.describe('STYL-361: Turnstile stays on the app origin', () => {
  test('widget source inlines the site key and never renders Turnstile on the host page', () => {
    for (const rel of ['src/widget/index.ts', 'src/widget/embed.ts']) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/typeof process\s*!==\s*['"]undefined['"]/);
      expect(src, rel).not.toContain('data-turnstile-sitekey');
      expect(src, rel).not.toContain('turnstile.render');
      expect(src, rel).not.toContain('challenges.cloudflare.com/turnstile');
      expect(src, rel).toContain(LIVE_SITE_KEY);
      expect(src, rel).toContain('process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY');
      expect(src, rel).toContain('event.origin !== appOrigin');
      expect(src, rel).toContain('event.source !== iframe.contentWindow');
      expect(src, rel).toContain('STYLEFLO_TURNSTILE_INTERACTIVE');
      expect(src, rel).toContain('styleflo-turnstile-overlay');
      expect(src, rel).toContain('.styleflo-chat-window');
      expect(src, rel).toContain('30000');
      expect(src, rel).toContain("console.error('[StyleFlo Widget] Turnstile error:'");
      expect(src, rel).not.toContain('document.body.appendChild(iframe)');
    }
  });

  test('turnstile.html uses interaction-only and tells the parent only', () => {
    const html = read('public/turnstile.html');
    expect(html).toContain("appearance: 'interaction-only'");
    expect(html).toContain("'before-interactive-callback'");
    expect(html).toContain('STYLEFLO_TURNSTILE_INTERACTIVE');
    expect(html).toContain('document.referrer');
    expect(html).toContain("console.error('[StyleFlo Turnstile Bridge] error:'");
    expect(html).toContain('event.source !== window.parent');
    expect(html).not.toMatch(/postMessage\(\s*payload\s*,\s*['"]\*['"]\s*\)/);
  });

  test('built bundles inline the build-time site key with no process guard', () => {
    for (const rel of ['public/widget.js', 'public/embed.js']) {
      const bundle = read(rel);
      expect(bundle, rel).not.toMatch(/typeof process<"u"/);
      expect(bundle, rel).not.toContain('data-turnstile-sitekey');
      expect(bundle, rel).not.toContain('turnstile.render');
      expect(bundle, rel).not.toContain(LIVE_SITE_KEY);
      expect(bundle, rel).toContain(DUMMY_SITE_KEY);
      expect(bundle, rel).toContain('STYLEFLO_TURNSTILE_INTERACTIVE');
      expect(bundle, rel).toMatch(/30000|3e4/);
    }
  });

  test('a third-party host page only accepts a token from the app-origin iframe', async ({ page }) => {
    const botId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const tokens: string[] = [];

    await page.route('**/api/chatbots/**', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'Test salon',
          primaryColor: '#260475',
          voiceEnabled: false,
          requireClientName: false,
        }),
      });
    });

    await page.route('**/turnstile.html**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body><script>
          function target() {
            try { return document.referrer ? new URL(document.referrer).origin : '*'; }
            catch (e) { return '*'; }
          }
          parent.postMessage({ type: 'STYLEFLO_TURNSTILE_INTERACTIVE' }, target());
          window.__sendToken = function () {
            parent.postMessage({ type: 'STYLEFLO_TURNSTILE_TOKEN', token: 'bridge-token' }, target());
          };
        </script></body></html>`,
      });
    });

    page.on('request', (req) => {
      if (req.url().includes('/api/chat/public-init')) {
        tokens.push(req.headers()['x-turnstile-token'] || '');
      }
    });

    await page.goto('/login');
    await page.evaluate((id) => {
      localStorage.clear();
      sessionStorage.clear();
      const script = document.createElement('script');
      script.src = '/widget.js';
      script.setAttribute('data-bot-id', id);
      document.body.appendChild(script);
    }, botId);

    const host = page.locator('#styleflo-chat-widget');
    await expect(host).toBeAttached({ timeout: 15000 });
    await host.locator('button').first().click();

    const input = host.locator('#styleflo-input');
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.fill('Hello');
    await host.locator('#styleflo-chat-form').evaluate((form: HTMLFormElement) => {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await expect.poll(async () => {
      return page.evaluate(() => {
        const root = document.getElementById('styleflo-chat-widget')?.shadowRoot;
        const panel = root?.querySelector('.styleflo-chat-window');
        const frame = panel?.querySelector('#styleflo-turnstile-frame');
        const overlay = panel?.querySelector('#styleflo-turnstile-overlay') as HTMLElement | null;
        return {
          inPanel: Boolean(frame),
          onBody: Boolean(document.getElementById('styleflo-turnstile-frame')),
          src: (frame as HTMLIFrameElement | null)?.src || '',
          opacity: overlay ? getComputedStyle(overlay).opacity : '',
          pointer: overlay ? getComputedStyle(overlay).pointerEvents : '',
        };
      });
    }, { timeout: 15000 }).toMatchObject({
      inPanel: true,
      onBody: false,
      opacity: '1',
      pointer: 'auto',
    });

    const placement = await page.evaluate(() => {
      const frame = document.getElementById('styleflo-chat-widget')?.shadowRoot
        ?.querySelector('#styleflo-turnstile-frame') as HTMLIFrameElement | null;
      return frame?.src || '';
    });
    expect(placement).toContain('/turnstile.html');
    expect(placement).toContain(DUMMY_SITE_KEY);
    expect(new URL(placement).origin).toBe(new URL(page.url()).origin);

    await page.evaluate(() => {
      const iframe = document.getElementById('styleflo-chat-widget')?.shadowRoot
        ?.querySelector('#styleflo-turnstile-frame') as HTMLIFrameElement | null;
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'STYLEFLO_TURNSTILE_TOKEN', token: 'forged-token' },
        origin: 'https://evil.example',
        source: iframe?.contentWindow,
      }));
    });

    await page.waitForTimeout(400);
    expect(tokens).not.toContain('forged-token');

    const frame = page.frames().find((item) => item.url().includes('turnstile.html'));
    expect(frame).toBeTruthy();
    await frame!.evaluate(() => {
      (window as unknown as { __sendToken: () => void }).__sendToken();
    });

    await expect.poll(() => tokens.includes('bridge-token'), { timeout: 10000 }).toBe(true);
    expect(tokens).not.toContain('forged-token');
  });
});
