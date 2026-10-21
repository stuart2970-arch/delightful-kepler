import { test, expect, type Page } from '@playwright/test';
import { signChatSessionToken } from '../src/lib/chat-session';

interface TestWindow extends Window {
  __STYLEFLO_TEST_TURNSTILE_TOKEN__?: string;
  __STYLEFLO_MOCK_VAPI__?: boolean;
  __STYLEFLO_LAST_VAPI_CALL__?: {
    firstName?: string;
    clientName?: string;
    firstMessage?: string;
    systemPrompt?: string;
  };
}

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
    await page.goto('/login');

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

    await page.evaluate((botId) => {
      (window as unknown as TestWindow).__STYLEFLO_TEST_TURNSTILE_TOKEN__ = '1x0000000000000000000000000000000AA';
      const s = document.createElement('script');
      s.src = '/widget.js';
      s.setAttribute('data-bot-id', botId);
      document.body.appendChild(s);
    }, testChatbotId);

    const host = page.locator('#styleflo-chat-widget');
    await expect(host).toBeAttached({ timeout: 10000 });

    const menuChat = host.locator('#styleflo-menu-chat');
    await expect(menuChat).toBeAttached({ timeout: 10000 });
    await menuChat.evaluate((btn: HTMLButtonElement) => btn.click());

    const nameInput = host.locator('#styleflo-onboarding-name');
    const termsCheckbox = host.locator('#styleflo-disclaimer-accept');
    const startChatBtn = host.locator('#styleflo-onboarding-submit-btn');

    if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameInput.fill('Sarah Connor');
      if (await termsCheckbox.isVisible()) {
        await termsCheckbox.check();
      }
      await startChatBtn.click();
    }

    const chatInput = host.locator('#styleflo-input');
    await expect(chatInput).toBeVisible({ timeout: 10000 });

    const voiceBtn = host.locator('#styleflo-vapi-btn');
    await expect(voiceBtn).toBeVisible({ timeout: 10000 });

    await chatInput.fill('Hello from the real homepage widget test!');
    const chatForm = host.locator('#styleflo-chat-form');
    await chatForm.evaluate((form: HTMLFormElement) => {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await expect.poll(() => publicInitCalled, { timeout: 10000 }).toBe(true);
    expect(turnstileTokenSent).toBe('1x0000000000000000000000000000000AA');

    await expect.poll(() => streamCalled, { timeout: 15000 }).toBe(true);
    expect(sessionTokenSent).toBeTruthy();
    expect(sessionTokenSent.split('.').length).toBe(3);

    const userMessage = host.locator('#styleflo-messages', { hasText: 'Hello from the real homepage widget test!' });
    await expect(userMessage).toBeVisible({ timeout: 10000 });

    const unauthorizedWarning = host.locator('text=Unauthorized');
    await expect(unauthorizedWarning).not.toBeVisible();
  });
});

test.describe('STYL-181: Per-Session Name & Terms Gate, Voice Call Interception, and Name Personalization', () => {
  const homepageBotId = '9825855e-d478-443f-b75c-6c0d77039ca6';

  async function mountWidgetAndOpen(page: Page, botId: string) {
    await page.evaluate((id: string) => {
      const win = window as unknown as TestWindow;
      win.__STYLEFLO_TEST_TURNSTILE_TOKEN__ = '1x0000000000000000000000000000000AA';
      win.__STYLEFLO_MOCK_VAPI__ = true;
      const s = document.createElement('script');
      s.src = '/widget.js';
      s.setAttribute('data-bot-id', id);
      document.body.appendChild(s);
    }, botId);

    const host = page.locator('#styleflo-chat-widget');
    await expect(host).toBeAttached({ timeout: 10000 });

    const menuChat = host.locator('#styleflo-menu-chat');
    await expect(menuChat).toBeAttached({ timeout: 10000 });
    await menuChat.evaluate((btn: HTMLButtonElement) => btn.click());
    return host;
  }

  test('homepage chatbot requires name and terms acceptance on fresh session', async ({ page }) => {
    await page.goto('/login');
    const host = await mountWidgetAndOpen(page, homepageBotId);

    const onboarding = host.locator('#styleflo-onboarding');
    await expect(onboarding).toBeVisible({ timeout: 10000 });

    const messages = host.locator('#styleflo-messages');
    await expect(messages).not.toBeVisible();

    const submitBtn = host.locator('#styleflo-onboarding-submit-btn');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled();
    expect(await submitBtn.getAttribute('aria-disabled')).toBe('true');
  });

  test('start chat button becomes enabled only when both name and terms checkbox are completed', async ({ page }) => {
    await page.goto('/login');
    const host = await mountWidgetAndOpen(page, homepageBotId);

    const nameInput = host.locator('#styleflo-onboarding-name');
    const termsCheckbox = host.locator('#styleflo-disclaimer-accept');
    const submitBtn = host.locator('#styleflo-onboarding-submit-btn');

    await expect(submitBtn).toBeDisabled();

    // 1. Enter name only -> remains disabled
    await nameInput.fill('Sarah Connor');
    await expect(submitBtn).toBeDisabled();

    // 2. Check terms -> becomes enabled
    await termsCheckbox.check();
    await expect(submitBtn).toBeEnabled();
    expect(await submitBtn.getAttribute('aria-disabled')).toBe('false');

    // 3. Clear name -> reverts to disabled
    await nameInput.fill('');
    await expect(submitBtn).toBeDisabled();

    // 4. Fill name back -> re-enabled
    await nameInput.fill('Sarah Connor');
    await expect(submitBtn).toBeEnabled();
  });

  test('text chat greeting personalizes with first name and sends clientName in chat stream', async ({ page }) => {
    await page.goto('/login');

    let streamClientName = '';
    page.on('request', (req) => {
      if (req.url().includes('/api/chat/stream')) {
        try {
          const postData = JSON.parse(req.postData() || '{}');
          streamClientName = postData.clientName || '';
        } catch {}
      }
    });

    const host = await mountWidgetAndOpen(page, homepageBotId);

    const nameInput = host.locator('#styleflo-onboarding-name');
    const termsCheckbox = host.locator('#styleflo-disclaimer-accept');
    const submitBtn = host.locator('#styleflo-onboarding-submit-btn');

    await nameInput.fill('Sarah Connor');
    await termsCheckbox.check();
    await submitBtn.click();

    // Verify gate dismissed and messages visible
    const messages = host.locator('#styleflo-messages');
    await expect(messages).toBeVisible({ timeout: 10000 });

    // Verify welcome greeting personalized with first name Sarah
    const welcomeEl = host.locator('#styleflo-welcome-message-text');
    await expect(welcomeEl).toContainText('Sarah');

    // Verify sessionStorage recorded acceptance
    const gateStorage = await page.evaluate((botId) => {
      return sessionStorage.getItem(`styleflo_gate_${botId}`);
    }, homepageBotId);
    expect(gateStorage).toBeTruthy();
    const parsedGate = JSON.parse(gateStorage || '{}');
    expect(parsedGate.accepted).toBe(true);
    expect(parsedGate.termsVersion).toBe('1.0');

    // Send chat message
    const chatInput = host.locator('#styleflo-input');
    await chatInput.fill('Can you help me?');
    const chatForm = host.locator('#styleflo-chat-form');
    await chatForm.evaluate((form: HTMLFormElement) => {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await expect.poll(() => streamClientName, { timeout: 10000 }).toBe('Sarah');
  });

  test('web voice call intercepts with name and terms gate before connecting, then greets by first name', async ({ page }) => {
    await page.goto('/login');

    await page.evaluate((botId) => {
      const win = window as unknown as TestWindow;
      win.__STYLEFLO_TEST_TURNSTILE_TOKEN__ = '1x0000000000000000000000000000000AA';
      win.__STYLEFLO_MOCK_VAPI__ = true;
      const s = document.createElement('script');
      s.src = '/widget.js';
      s.setAttribute('data-bot-id', botId);
      document.body.appendChild(s);
    }, homepageBotId);

    const host = page.locator('#styleflo-chat-widget');
    await expect(host).toBeAttached({ timeout: 10000 });

    const menuCall = host.locator('#styleflo-menu-call');
    await expect(menuCall).toBeAttached({ timeout: 10000 });
    await menuCall.evaluate((btn: HTMLButtonElement) => btn.click());

    // Verify gate is displayed instead of connecting
    const onboarding = host.locator('#styleflo-onboarding');
    await expect(onboarding).toBeVisible({ timeout: 10000 });

    // Complete the gate
    const nameInput = host.locator('#styleflo-onboarding-name');
    const termsCheckbox = host.locator('#styleflo-disclaimer-accept');
    const submitBtn = host.locator('#styleflo-onboarding-submit-btn');

    await nameInput.fill('John Connor');
    await termsCheckbox.check();
    await submitBtn.click();

    // Verify voice call was triggered with first name greeting & instructions
    await expect.poll(async () => {
      return page.evaluate(() => (window as unknown as TestWindow).__STYLEFLO_LAST_VAPI_CALL__);
    }, { timeout: 10000 }).toBeTruthy();

    const lastVapiCall = await page.evaluate(() => (window as unknown as TestWindow).__STYLEFLO_LAST_VAPI_CALL__);
    expect(lastVapiCall.firstName).toBe('John');
    expect(lastVapiCall.clientName).toBe('John');
    expect(lastVapiCall.firstMessage).toContain('John');
    expect(lastVapiCall.systemPrompt).toContain("The user's first name is John. Greet them by first name.");
  });

  test('stored name in localStorage does NOT bypass terms gate on new session', async ({ page }) => {
    await page.goto('/login');

    await page.evaluate(() => {
      localStorage.setItem('styleflo-client-name', 'Sarah Connor');
      sessionStorage.clear();
    });

    const host = await mountWidgetAndOpen(page, homepageBotId);

    // Gate MUST be displayed even though name is stored
    const onboarding = host.locator('#styleflo-onboarding');
    await expect(onboarding).toBeVisible({ timeout: 10000 });

    // Name should be pre-filled
    const nameInput = host.locator('#styleflo-onboarding-name');
    await expect(nameInput).toHaveValue('Sarah Connor');

    // Checkbox must NOT be checked
    const termsCheckbox = host.locator('#styleflo-disclaimer-accept');
    expect(await termsCheckbox.isChecked()).toBe(false);

    // Button MUST remain disabled until checkbox is checked
    const submitBtn = host.locator('#styleflo-onboarding-submit-btn');
    await expect(submitBtn).toBeDisabled();
  });

  test('server /api/chat/stream rejects unaccepted session token for gated bot with 403 Forbidden', async ({ request }) => {
    const sessionId = `session_gate_test_${Date.now()}`;

    // Token without termsAccepted
    const unacceptedToken = signChatSessionToken({
      chatbotId: homepageBotId,
      sessionId,
      expiresInSeconds: 3600,
      termsAccepted: false,
    });

    const unacceptedRes = await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': unacceptedToken,
      },
      data: {
        message: 'Hello bot',
        chatbotId: homepageBotId,
        sessionId,
      },
    });

    expect(unacceptedRes.status()).toBe(403);
    const errJson = await unacceptedRes.json();
    expect(errJson.error).toContain('Please accept the terms of service and privacy notice');

    // Token with termsAccepted: true
    const passSessionId = `session_gate_pass_${Date.now()}`;
    const acceptedToken = signChatSessionToken({
      chatbotId: homepageBotId,
      sessionId: passSessionId,
      expiresInSeconds: 3600,
      termsAccepted: true,
      termsVersion: '1.0',
    });

    const acceptedRes = await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': acceptedToken,
      },
      data: {
        message: 'Hello bot',
        chatbotId: homepageBotId,
        sessionId: passSessionId,
      },
    });

    expect(acceptedRes.status()).toBe(200);
  });
});
