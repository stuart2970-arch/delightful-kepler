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

    const termsLabel = onboarding.locator('label[for="styleflo-disclaimer-accept"]');
    await expect(termsLabel).toHaveText('I agree to the Terms and acknowledge the Privacy Policy.');

    const termsLink = termsLabel.locator('a', { hasText: 'Terms' });
    await expect(termsLink).toHaveAttribute('href', 'https://styleflo.ai/terms-conditions/');
    await expect(termsLink).toHaveText('Terms');

    const privacyLink = termsLabel.locator('a', { hasText: 'Privacy Policy' });
    await expect(privacyLink).toHaveAttribute('href', 'https://styleflo.ai/privacy/');
    await expect(privacyLink).toHaveText('Privacy Policy');
  });

  test('STYL-184: pre-chat box wording with global disclaimer displays new header, sentence case notice label, AI assistant wording and Terms links', async ({ page, request }) => {
    // 1. Check that both links resolve (not 404)
    const termsRes = await request.get('https://styleflo.ai/terms-conditions/');
    expect(termsRes.status()).toBe(200);
    const privacyRes = await request.get('https://styleflo.ai/privacy/');
    expect(privacyRes.status()).toBe(200);

    // 2. Intercept chatbot config to return voice notice with legacy "our AI agent" wording
    await page.route(`**/api/chatbots/${homepageBotId}*`, async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      json.globalVoiceDisclaimer = 'Before we connect you, this call is between you and our AI agent, and we keep a record of the transcription for reference and contact purposes, this is outlined in our privacy-policy which can be found on our website.';
      await route.fulfill({
        response,
        json,
      });
    });

    await page.goto('/login');
    const host = await mountWidgetAndOpen(page, homepageBotId);

    const onboarding = host.locator('#styleflo-onboarding');
    await expect(onboarding).toBeVisible({ timeout: 10000 });

    // Item 1: Header "Chat & Voice Disclaimer" becomes "Meet our AI assistant"
    const header = onboarding.locator('h4');
    await expect(header).toHaveText('Meet our AI assistant');

    // Item 2: The "IMPORTANT NOTICE" label becomes "Please read before you start" (sentence case)
    const noticeHeader = onboarding.locator('div.font-bold:has-text("Please read before you start")');
    await expect(noticeHeader).toBeVisible();
    await expect(noticeHeader).toContainText('Please read before you start');
    const classAttr = await noticeHeader.getAttribute('class');
    expect(classAttr).not.toContain('uppercase');

    // Item 3: The voice notice text "our AI agent" becomes "our AI assistant"
    const noticeText = await onboarding.locator('.bg-blue-50\\/80, [class*="bg-blue-50"]').textContent();
    expect(noticeText).toContain('this call is between you and our AI assistant');
    expect(noticeText).not.toContain('our AI agent');
    expect(noticeText).not.toContain('AI agent');

    // Item 4: The checkbox text becomes "I agree to the Terms and acknowledge the Privacy Policy"
    const termsLabel = onboarding.locator('label[for="styleflo-disclaimer-accept"]');
    await expect(termsLabel).toHaveText('I agree to the Terms and acknowledge the Privacy Policy.');

    const termsLink = termsLabel.locator('a', { hasText: 'Terms' });
    await expect(termsLink).toHaveAttribute('href', 'https://styleflo.ai/terms-conditions/');
    await expect(termsLink).toHaveText('Terms');

    const privacyLink = termsLabel.locator('a', { hasText: 'Privacy Policy' });
    await expect(privacyLink).toHaveAttribute('href', 'https://styleflo.ai/privacy/');
    await expect(privacyLink).toHaveText('Privacy Policy');

    // Leave the "Start Chat" button unchanged
    const submitBtn = host.locator('#styleflo-onboarding-submit-btn');
    await expect(submitBtn).toHaveText('Start Chat 💬');
    await expect(submitBtn).toBeDisabled();
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

    await nameInput.fill('Sarah Jones');
    await termsCheckbox.check();
    await submitBtn.click();

    // Verify gate dismissed and messages visible
    const messages = host.locator('#styleflo-messages');
    await expect(messages).toBeVisible({ timeout: 10000 });

    // Verify welcome greeting personalized with first name Sarah
    const welcomeEl = host.locator('#styleflo-welcome-message-text');
    await expect(welcomeEl).toHaveText("Hi Sarah, you're through to FloChat! How can I help you today?");

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

    await nameInput.fill('Sarah Jones');
    await termsCheckbox.check();
    await submitBtn.click();

    // Verify voice call was triggered with first name greeting & instructions
    await expect.poll(async () => {
      return page.evaluate(() => (window as unknown as TestWindow).__STYLEFLO_LAST_VAPI_CALL__);
    }, { timeout: 10000 }).toBeTruthy();

    const lastVapiCall = (await page.evaluate(() => (window as unknown as TestWindow).__STYLEFLO_LAST_VAPI_CALL__)) as any;
    expect(lastVapiCall.firstName).toBe('Sarah');
    expect(lastVapiCall.clientName).toBe('Sarah');
    expect(lastVapiCall.firstMessage).toBe("Hi Sarah, you're through to FloChat! How can I help you today?");
    expect(lastVapiCall.systemPrompt).toContain('Flo');
    expect(lastVapiCall.systemPrompt).toContain('Sarah');
    expect(lastVapiCall.systemPrompt).not.toContain('first name is there');
  });

  test('mock bot with agent name "Emma" and empty welcome message: chat and voice both start "Hi John, I\'m Emma"', async ({ page }) => {
    const emptyWelcomeBotId = 'e0000000-0000-0000-0000-000000000002';
    await page.goto('/login');

    await page.evaluate((botId) => {
      const win = window as unknown as TestWindow;
      win.__STYLEFLO_TEST_TURNSTILE_TOKEN__ = '1x0000000000000000000000000000000AA';
      win.__STYLEFLO_MOCK_VAPI__ = true;
      const s = document.createElement('script');
      s.src = '/widget.js';
      s.setAttribute('data-bot-id', botId);
      document.body.appendChild(s);
    }, emptyWelcomeBotId);

    const host = page.locator('#styleflo-chat-widget');
    await expect(host).toBeAttached({ timeout: 10000 });

    const menuChat = host.locator('#styleflo-menu-chat');
    await expect(menuChat).toBeAttached({ timeout: 10000 });
    await menuChat.evaluate((btn: HTMLButtonElement) => btn.click());

    const nameInput = host.locator('#styleflo-onboarding-name');
    const termsCheckbox = host.locator('#styleflo-disclaimer-accept');
    const submitBtn = host.locator('#styleflo-onboarding-submit-btn');

    await nameInput.fill('John Doe');
    await termsCheckbox.check();
    await submitBtn.click();

    // Verify chat welcome bubble starts with "Hi John, I'm Emma"
    const welcomeEl = host.locator('#styleflo-welcome-message-text');
    await expect(welcomeEl).toBeVisible({ timeout: 10000 });
    const welcomeText = await welcomeEl.textContent();
    expect(welcomeText?.startsWith("Hi John, I'm Emma")).toBe(true);

    // Trigger voice call and verify voice firstMessage also starts with "Hi John, I'm Emma"
    const vapiBtn = host.locator('#styleflo-vapi-btn');
    await vapiBtn.evaluate((btn: HTMLButtonElement) => btn.click());

    await expect.poll(async () => {
      return page.evaluate(() => (window as unknown as TestWindow).__STYLEFLO_LAST_VAPI_CALL__);
    }, { timeout: 10000 }).toBeTruthy();

    const lastVapiCall = (await page.evaluate(() => (window as unknown as TestWindow).__STYLEFLO_LAST_VAPI_CALL__)) as any;
    expect(lastVapiCall.firstName).toBe('John');
    expect(lastVapiCall.firstMessage?.startsWith("Hi John, I'm Emma")).toBe(true);
    expect(lastVapiCall.systemPrompt).toContain('Emma');
    expect(lastVapiCall.systemPrompt).not.toContain('first name is there');
  });

  test('voice completions route: business bot system prompt contains agent name and not "phone"', async ({ request }) => {
    const res = await request.post('/api/voice/e0000000-0000-0000-0000-000000000002/chat/completions', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        stream: false,
        messages: [
          { role: 'user', content: 'What services do you offer?' },
        ],
        call: {
          id: 'call_test_prompt_check',
          metadata: {
            client_name: 'John Doe',
          },
        },
      },
    });

    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const identityLine = data.systemPrompt.split('\n')[0];
    expect(identityLine).toContain('Emma');
    expect(identityLine.toLowerCase()).not.toContain('phone');
    expect(data.systemPrompt.toLowerCase()).not.toContain('phone representative');
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
