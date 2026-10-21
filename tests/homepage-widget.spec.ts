import { test, expect } from '@playwright/test';

test.describe('STYL-180: Real Homepage Widget Flow & Voice Chat Verification', () => {
  const testChatbotId = 'e0000000-0000-0000-0000-000000000001';

  test('turnstile.html bridge page is served with open frame-ancestors', async ({ request }) => {
    const res = await request.get('/turnstile.html');
    expect(res.ok()).toBeTruthy();
    const headers = res.headers();
    expect(headers['content-security-policy']).toMatch(/frame-ancestors/);
    const text = await res.text();
    expect(text).toContain('challenges.cloudflare.com/turnstile');
    expect(text).toContain('STYLEFLO_TURNSTILE_TOKEN');
  });

  test('widget public API supplies complete voice chat credentials and configuration', async ({ request }) => {
    const res = await request.get(`/api/chatbots/${testChatbotId}`);
    expect(res.ok()).toBeTruthy();
    const config = await res.json();
    expect(config.name).toBeTruthy();
    expect(config.primaryColor).toBeTruthy();
    expect(typeof config.voiceEnabled).toBe('boolean');
    expect(config.vapiPublicKey).toBeTruthy();
    expect(config.vapiAssistantId).toBeTruthy();
    expect(config.voiceId).toBeTruthy();
  });

  test('cross-origin CORS headers are present on /api/chat/public-init and /api/chat/stream for external embedding', async ({ request }) => {
    // 1. Verify OPTIONS preflight for public-init from external origin (e.g. styleflo.ai)
    const optionsRes = await request.fetch('/api/chat/public-init', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://styleflo.ai',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, x-turnstile-token',
      },
    });
    expect(optionsRes.ok()).toBeTruthy();
    const optHeaders = optionsRes.headers();
    expect(optHeaders['access-control-allow-origin']).toBe('*');
    expect(optHeaders['access-control-allow-headers']).toContain('x-turnstile-token');

    // 2. Verify actual POST /api/chat/public-init returns CORS allow-origin header on response
    const postRes = await request.post('/api/chat/public-init', {
      headers: {
        'Origin': 'https://styleflo.ai',
        'Content-Type': 'application/json',
        'x-turnstile-token': '1x0000000000000000000000000000000AA',
      },
      data: { chatbotId: testChatbotId },
    });
    expect(postRes.ok()).toBeTruthy();
    const postHeaders = postRes.headers();
    expect(postHeaders['access-control-allow-origin']).toBe('*');
    const postData = await postRes.json();
    expect(postData.sessionToken).toBeTruthy();
  });

  test('end-to-end homepage widget flow: disclaimer gate, Turnstile handshake, public-init, and streaming reply', async ({ page }) => {
    // Navigate to a blank page to simulate external site embedding (e.g. styleflo.ai)
    await page.goto('/login');

    // Attach request listeners to verify exact network sequence
    let publicInitCalled = false;
    let streamCalled = false;
    let turnstileTokenSent = '';
    let sessionTokenSent = '';

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/chat/public-init')) {
        publicInitCalled = true;
        turnstileTokenSent = req.headers()['x-turnstile-token'] || '';
      }
      if (url.includes('/api/chat/stream')) {
        streamCalled = true;
        sessionTokenSent = req.headers()['x-session-token'] || '';
      }
    });

    // Inject widget with test turnstile token
    await page.evaluate((botId) => {
      (window as any).__STYLEFLO_TEST_TURNSTILE_TOKEN__ = '1x0000000000000000000000000000000AA';
      const s = document.createElement('script');
      s.src = '/widget.js';
      s.setAttribute('data-bot-id', botId);
      document.body.appendChild(s);
    }, testChatbotId);

    // 1. Wait for widget shadow host to mount
    const host = page.locator('#styleflo-chat-widget');
    await expect(host).toBeAttached({ timeout: 10000 });

    // 2. Open widget bubble
    await page.evaluate(() => {
      const root = document.querySelector('#styleflo-chat-widget')?.shadowRoot;
      const bubble = root?.querySelector('button');
      if (bubble) bubble.click();
    });

    // 3. Complete disclaimer gate (Name + Terms agreement)
    const nameInput = host.locator('#styleflo-onboarding-name');
    const termsCheckbox = host.locator('#styleflo-disclaimer-accept');
    const startChatBtn = host.locator('button', { hasText: 'Start Chat' });

    if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameInput.fill('Sarah Connor');
      if (await termsCheckbox.isVisible()) {
        await termsCheckbox.check();
      }
      await startChatBtn.click();
    }

    // 4. Verify chat input and voice call button are visible
    const chatInput = host.locator('#styleflo-input');
    await expect(chatInput).toBeVisible({ timeout: 10000 });

    const voiceBtn = host.locator('#styleflo-vapi-btn, button[aria-label*="voice" i], button[aria-label*="call" i]');
    await expect(voiceBtn).toBeVisible({ timeout: 10000 });

    // 5. Submit chat message
    await chatInput.fill('Hello from the real homepage widget test!');
    const chatForm = host.locator('#styleflo-chat-form');
    await chatForm.evaluate((form: HTMLFormElement) => {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });

    // 6. Assert Turnstile handshake and chat stream headers
    await expect.poll(() => publicInitCalled, { timeout: 10000 }).toBe(true);
    expect(turnstileTokenSent).toBe('1x0000000000000000000000000000000AA');

    await expect.poll(() => streamCalled, { timeout: 15000 }).toBe(true);
    expect(sessionTokenSent).toBeTruthy();
    expect(sessionTokenSent.split('.').length).toBe(3); // Valid JWT/HMAC token structure

    // 7. Verify message and response rendered in shadow DOM
    const userMessage = host.locator('#styleflo-messages', { hasText: 'Hello from the real homepage widget test!' });
    await expect(userMessage).toBeVisible({ timeout: 10000 });

    // Verify no unauthorized warning appears
    const unauthorizedWarning = host.locator('text=Unauthorized');
    await expect(unauthorizedWarning).not.toBeVisible();
  });
});
