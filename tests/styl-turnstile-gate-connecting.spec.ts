import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const botId = 'e0000000-0000-0000-0000-000000000001';
const DUMMY_PASS = '1x0000000000000000000000000000000AA';
const DUMMY_BLOCK = '2x00000000000000000000000000000000AB';

test.describe('Turnstile gate: connecting state, retry, and no chat without session', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/chatbots/**', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'Turnstile gate salon',
          primaryColor: '#260475',
          voiceEnabled: false,
          requireClientName: true,
          globalVoiceDisclaimer: '',
        }),
      });
    });
  });

  test('gate submit shows connecting state and does not open chat when Turnstile fails', async ({ page }) => {
    let turnstileBridgeLoads = 0;

    await page.route('**/turnstile.html**', async (route) => {
      turnstileBridgeLoads += 1;
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body><script>
          function target() {
            try { return document.referrer ? new URL(document.referrer).origin : '*'; }
            catch (e) { return '*'; }
          }
          parent.postMessage({ type: 'STYLEFLO_TURNSTILE_ERROR', code: 'blocked_embed' }, target());
        </script></body></html>`,
      });
    });

    let publicInitCalls = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/chat/public-init')) publicInitCalls += 1;
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

    await host.locator('#styleflo-onboarding-name').fill('Alex Visitor');
    await host.locator('#styleflo-disclaimer-accept').check();
    await host.locator('#styleflo-onboarding-submit-btn').click();

    const connecting = host.locator('#styleflo-gate-connecting');
    await expect(connecting).toBeVisible({ timeout: 3000 });

    const retryBtn = host.locator('#styleflo-gate-security-retry');
    await expect(retryBtn).toBeVisible({ timeout: 15000 });
    await expect(retryBtn).toContainText("Couldn't verify");

    await expect(onboarding).toBeVisible();
    await expect(host.locator('#styleflo-chat-form')).toBeHidden();
    expect(publicInitCalls).toBe(0);
    expect(turnstileBridgeLoads).toBeGreaterThanOrEqual(1);
  });

  test('success after retry opens chat and calls public-init once', async ({ page }) => {
    let bridgeAttempts = 0;

    await page.route('**/turnstile.html**', async (route) => {
      bridgeAttempts += 1;
      const failThisLoad = bridgeAttempts <= 2;
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body><script>
          var fail = ${failThisLoad ? 'true' : 'false'};
          function target() {
            try { return document.referrer ? new URL(document.referrer).origin : '*'; }
            catch (e) { return '*'; }
          }
          if (fail) {
            parent.postMessage({ type: 'STYLEFLO_TURNSTILE_ERROR', code: 'first_fail' }, target());
          } else {
            parent.postMessage({ type: 'STYLEFLO_TURNSTILE_TOKEN', token: '${DUMMY_PASS}' }, target());
          }
        </script></body></html>`,
      });
    });

    let publicInitCalls = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/chat/public-init')) publicInitCalls += 1;
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

    await host.locator('#styleflo-onboarding-name').fill('Retry User');
    await host.locator('#styleflo-disclaimer-accept').check();
    await host.locator('#styleflo-onboarding-submit-btn').click();

    await expect(host.locator('#styleflo-gate-security-retry')).toBeVisible({ timeout: 15000 });
    await host.locator('#styleflo-gate-security-retry').click();

    await expect.poll(() => publicInitCalls, { timeout: 20000 }).toBe(1);
    await expect(host.locator('#styleflo-chat-form')).toBeVisible({ timeout: 10000 });
    await expect(host.locator('#styleflo-onboarding')).toBeHidden();
  });

  test('prefetch on open reuses bridge iframe across gate submit', async ({ page }) => {
    await page.route('**/turnstile.html**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body><script>
          function target() {
            try { return document.referrer ? new URL(document.referrer).origin : '*'; }
            catch (e) { return '*'; }
          }
          parent.postMessage({ type: 'STYLEFLO_TURNSTILE_TOKEN', token: '${DUMMY_PASS}' }, target());
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

    await expect.poll(async () => {
      return page.evaluate(() => {
        const root = document.getElementById('styleflo-chat-widget')?.shadowRoot;
        return root?.querySelectorAll('#styleflo-turnstile-frame').length || 0;
      });
    }, { timeout: 15000 }).toBe(1);

    await host.locator('#styleflo-onboarding-name').fill('Prefetch User');
    await host.locator('#styleflo-disclaimer-accept').check();
    await host.locator('#styleflo-onboarding-submit-btn').click();

    await expect(host.locator('#styleflo-chat-form')).toBeVisible({ timeout: 15000 });

    const frameCount = await page.evaluate(() => {
      const root = document.getElementById('styleflo-chat-widget')?.shadowRoot;
      return root?.querySelectorAll('#styleflo-turnstile-frame').length || 0;
    });
    expect(frameCount).toBe(1);
  });

  test('widget source documents gate connecting and retry behaviour', () => {
    const src = readFileSync(join(process.cwd(), 'src/widget/embed.ts'), 'utf8');
    expect(src).toContain('Connecting securely…');
    expect(src).toContain('styleflo-gate-security-retry');
    expect(src).toContain('prefetchTurnstileToken');
    expect(src).toContain('ensureChatSessionForRequest');
    expect(src).not.toMatch(/console\.warn\('\[StyleFlo Widget\] Token init on gate submit'/);
  });
});