import { test, expect } from '@playwright/test';

const INTERACTIVE_SITE_KEY = '3x00000000000000000000FF';
const ALWAYS_PASS_SITE_KEY = '1x00000000000000000000AA';

function turnstileMockBody(opts: { interactiveKey?: boolean; transientThenToken?: boolean }) {
  const delay = opts.transientThenToken ? 1200 : 0;
  return `<!doctype html><html><body><div id="cf-container" style="min-height:65px;background:#fff"></div><script>
    function target() {
      try {
        var p = new URLSearchParams(location.search).get('parent_origin');
        if (p) return p;
        return document.referrer ? new URL(document.referrer).origin : '*';
      } catch (e) { return '*'; }
    }
    var interactive = ${opts.interactiveKey ? 'true' : 'false'};
    var transient = ${opts.transientThenToken ? 'true' : 'false'};
    var resetCount = 0;
  if (!interactive && !transient) {
      setTimeout(function () {
        parent.postMessage({ type: 'STYLEFLO_TURNSTILE_TOKEN', token: 'gate-mock-token' }, target());
      }, 80);
    }
    window.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'STYLEFLO_RESET_TURNSTILE') {
        resetCount += 1;
        if (interactive && resetCount < 2) return;
        if (transient) {
          parent.postMessage({ type: 'STYLEFLO_TURNSTILE_ERROR', code: '600010' }, target());
          setTimeout(function () {
            parent.postMessage({ type: 'STYLEFLO_TURNSTILE_TOKEN', token: 'gate-mock-token' }, target());
          }, ${delay});
          return;
        }
        if (interactive) {
          parent.postMessage({ type: 'STYLEFLO_TURNSTILE_INTERACTIVE' }, target());
        }
        setTimeout(function () {
          parent.postMessage({ type: 'STYLEFLO_TURNSTILE_TOKEN', token: 'gate-mock-token' }, target());
        }, interactive ? 150 : 0);
      }
    });
  </script></body></html>`;
}

async function loadWidget(page: import('@playwright/test').Page, botId: string, siteKey: string) {
  await page.route('**/api/config/public', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ turnstileSiteKey: siteKey }),
    });
  });

  await page.route('**/api/chatbots/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        name: 'Overlay bot',
        primaryColor: '#260475',
        voiceEnabled: false,
        requireClientName: true,
        termsVersion: '1.0',
      }),
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
}

async function readOverlayState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const root = document.getElementById('styleflo-chat-widget')?.shadowRoot;
    const overlay = root?.querySelector('#styleflo-turnstile-overlay') as HTMLElement | null;
    const hint = root?.querySelector('#styleflo-turnstile-hint') as HTMLElement | null;
  return {
      opacity: overlay ? getComputedStyle(overlay).opacity : '',
      hintDisplay: hint?.style.display || '',
    };
  });
}

test.describe('Turnstile gate overlay timing (Cloudflare dummy keys)', () => {
  test('interactive dummy key: overlay stays hidden until INTERACTIVE', async ({ page }) => {
    test.setTimeout(60_000);
    const botId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

    await page.route('**/turnstile.html**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: turnstileMockBody({ interactiveKey: true }),
      });
    });

    await page.route('**/api/chat/public-init', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionToken: 'sess',
          sessionId: 'sid',
          expiresInSeconds: 3600,
        }),
      });
    });

    await loadWidget(page, botId, INTERACTIVE_SITE_KEY);

    const host = page.locator('#styleflo-chat-widget');
    await expect(host).toBeAttached({ timeout: 15000 });
    await host.locator('button').first().click();

    const onboarding = host.locator('#styleflo-onboarding');
    await expect(onboarding).toBeVisible({ timeout: 10000 });
    await host.locator('#styleflo-onboarding-name').fill('Test User');
    await host.locator('#styleflo-disclaimer-accept').check();

    const beforeSubmit = await readOverlayState(page);
    expect(beforeSubmit.opacity).toBe('0');

    const submit = host.locator('#styleflo-onboarding-submit-btn');
    await submit.click();
    await expect(submit).toContainText('Connecting securely', { timeout: 5000 });

    await expect
      .poll(async () => (await readOverlayState(page)).opacity, { timeout: 5000 })
      .toBe('0');

    await expect
      .poll(async () => (await readOverlayState(page)).opacity, { timeout: 15000 })
      .toBe('1');

    await expect(host.locator('#styleflo-chat-form')).toBeVisible({ timeout: 15000 });
  });

  test('always-pass dummy key: overlay never shows and gate opens chat', async ({ page }) => {
    test.setTimeout(60_000);
    const botId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

    await page.route('**/turnstile.html**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: turnstileMockBody({ interactiveKey: false }),
      });
    });

    await page.route('**/api/chat/public-init', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionToken: 'sess',
          sessionId: 'sid',
          expiresInSeconds: 3600,
        }),
      });
    });

    await loadWidget(page, botId, ALWAYS_PASS_SITE_KEY);

    const host = page.locator('#styleflo-chat-widget');
    await expect(host).toBeAttached({ timeout: 15000 });
    await host.locator('button').first().click();

    await host.locator('#styleflo-onboarding-name').fill('Pass User');
    await host.locator('#styleflo-disclaimer-accept').check();
    await host.locator('#styleflo-onboarding-submit-btn').click();

    await expect
      .poll(async () => (await readOverlayState(page)).opacity, { timeout: 15000 })
      .toBe('0');

    await expect(host.locator('#styleflo-chat-form')).toBeVisible({ timeout: 15000 });
    await expect(host.locator('#styleflo-onboarding')).toBeHidden();
  });

  test('transient Turnstile error then token still completes gate', async ({ page }) => {
    test.setTimeout(60_000);
    const botId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

    await page.route('**/turnstile.html**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: turnstileMockBody({ transientThenToken: true }),
      });
    });

    await page.route('**/api/chat/public-init', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionToken: 'sess',
          sessionId: 'sid',
          expiresInSeconds: 3600,
        }),
      });
    });

    await loadWidget(page, botId, ALWAYS_PASS_SITE_KEY);

    const host = page.locator('#styleflo-chat-widget');
    await expect(host).toBeAttached({ timeout: 15000 });
    await host.locator('button').first().click();

    await host.locator('#styleflo-onboarding-name').fill('Retry User');
    await host.locator('#styleflo-disclaimer-accept').check();
    await host.locator('#styleflo-onboarding-submit-btn').click();

    await expect(host.locator('#styleflo-gate-error')).toBeHidden({ timeout: 8000 });
    await expect(host.locator('#styleflo-chat-form')).toBeVisible({ timeout: 20000 });
  });
});