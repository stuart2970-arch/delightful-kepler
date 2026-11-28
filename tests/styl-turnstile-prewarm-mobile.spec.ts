import { test, expect, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const DUMMY_SITE_KEY = '1x0000000000000000000000000000000AA';

function read(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

test.describe('Turnstile prewarm, gate pending, single iframe', () => {
  test('turnstile bridge mounts parent_origin and reuses one iframe', () => {
    const bridge = read('src/widget/turnstile-bridge.ts');
    expect(bridge).toContain('parent_origin');
    expect(bridge).toContain('event.origin !== this.deps.appOrigin');
    expect(bridge).toContain('event.source !== iframe.contentWindow');
    expect(bridge).toContain('STYLEFLO_TURNSTILE_INTERACTIVE');
    expect(bridge).toContain('styleflo-turnstile-overlay');
    expect(bridge).toContain(String(30000));
    expect(bridge).toContain("console.error('[StyleFlo Widget] Turnstile error:'");
    expect(bridge).toContain('prewarm');
    expect(bridge).toContain('resetWidget');
    expect(bridge).toContain('markConsumed');

    const embed = read('src/widget/embed.ts');
    expect(embed).toContain('TurnstileBridge');
    expect(embed).toContain('Connecting securely');
    expect(embed).not.toContain('getTurnstileViaIframe');
  });

  test('turnstile.html prefers parent_origin query param', () => {
    const html = read('public/turnstile.html');
    expect(html).toContain('parent_origin');
    expect(html).toContain('parentOriginParam');
  });

  test('gate stays closed and shows connecting when session init fails', async ({ page }) => {
    test.setTimeout(60_000);
    const botId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    await page.route('**/api/chatbots/**', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'Gate bot',
          primaryColor: '#260475',
          voiceEnabled: false,
          requireClientName: true,
          termsVersion: '1.0',
        }),
      });
    });

    await page.route('**/turnstile.html**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body><script>
          function sendErr() {
            parent.postMessage({ type: 'STYLEFLO_TURNSTILE_ERROR', code: 'mock_fail' }, '*');
          }
          window.addEventListener('message', function (event) {
            if (event.data && event.data.type === 'STYLEFLO_RESET_TURNSTILE') sendErr();
          });
        </script></body></html>`,
      });
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

    const onboarding = host.locator('#styleflo-onboarding');
    await expect(onboarding).toBeVisible({ timeout: 10000 });
    await host.locator('#styleflo-onboarding-name').fill('Stuart Test');
    await host.locator('#styleflo-disclaimer-accept').check();

    const submit = host.locator('#styleflo-onboarding-submit-btn');
    await submit.click();

    await expect(submit).toContainText('Connecting securely', { timeout: 5000 });
    await expect(host.locator('#styleflo-gate-error')).toContainText('Security verification failed', {
      timeout: 20000,
    });
    await expect(host.locator('#styleflo-gate-error')).toContainText('mock_fail');
    await expect(onboarding).toBeVisible();
    await expect(host.locator('#styleflo-chat-form')).toBeHidden();
  });

  test('mobile viewport keeps one turnstile iframe across two token attempts', async ({ browser }) => {
    const context = await browser.newContext({
      ...devices['Pixel 7'],
    });
    const page = await context.newPage();
    const botId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    let frameLoads = 0;

    await page.route('**/api/chatbots/**', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'Mobile bot',
          primaryColor: '#260475',
          voiceEnabled: false,
          requireClientName: false,
        }),
      });
    });

    await page.route('**/turnstile.html**', async (route) => {
      frameLoads += 1;
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body><script>
          var n = 0;
          window.addEventListener('message', function (event) {
            if (event.data && event.data.type === 'STYLEFLO_RESET_TURNSTILE' && n < 2) {
              n += 1;
              parent.postMessage({ type: 'STYLEFLO_TURNSTILE_TOKEN', token: 'tok-' + n }, '*');
            }
          });
          parent.postMessage({ type: 'STYLEFLO_TURNSTILE_TOKEN', token: 'tok-1' }, '*');
        </script></body></html>`,
      });
    });

  await page.route('**/api/chat/public-init', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionToken: 'sess-tok',
          sessionId: 'sess-id',
          expiresInSeconds: 3600,
        }),
      });
    });

    let publicInitCount = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/chat/public-init')) publicInitCount += 1;
    });

    await page.route('**/api/chat/stream', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: 'ok',
      });
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

    await expect.poll(async () => {
      return page.evaluate(() => {
        const root = document.getElementById('styleflo-chat-widget')?.shadowRoot;
        return root?.querySelectorAll('#styleflo-turnstile-frame').length ?? 0;
      });
    }, { timeout: 10000 }).toBe(1);

    await input.fill('Hello one');
    await host.locator('#styleflo-chat-form').evaluate((form: HTMLFormElement) => {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await expect.poll(() => publicInitCount, { timeout: 15000 }).toBeGreaterThanOrEqual(1);

    await input.fill('Hello two');
    await host.locator('#styleflo-chat-form').evaluate((form: HTMLFormElement) => {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await expect.poll(() => publicInitCount, { timeout: 15000 }).toBeGreaterThanOrEqual(1);

    const src = await page.evaluate(() => {
      const frame = document.getElementById('styleflo-chat-widget')?.shadowRoot
        ?.querySelector('#styleflo-turnstile-frame') as HTMLIFrameElement | null;
      return frame?.src || '';
    });
    expect(src).toContain('parent_origin=');
    expect(frameLoads).toBe(1);

    await context.close();
  });
});