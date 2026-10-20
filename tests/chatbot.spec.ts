import { test, expect } from '@playwright/test';
import { signChatSessionToken } from '../src/lib/chat-session';

test.describe('Chatbot & Widget Functionality (STYL-176 Hardened Auth)', () => {
  const testChatbotId = 'e0000000-0000-0000-0000-000000000001'; // Local seed chatbot

  test('chatbot public API returns valid configuration and voiceEnabled flag', async ({ request }) => {
    const response = await request.get(`/api/chatbots/${testChatbotId}`);
    expect(response.ok()).toBeTruthy();

    const config = await response.json();
    expect(config.name).toBeTruthy();
    expect(config.primaryColor).toBeTruthy();
    expect(config.agentName).toBeTruthy();
    expect(typeof config.voiceEnabled).toBe('boolean');
    expect(config.voiceProvider).toBeTruthy();
    expect(config.voiceId).toBeTruthy();
  });

  test('widget script loads, expands chat UI, and renders message input + microphone button', async ({ page }) => {
    await page.goto('/login');

    // Dynamically inject the widget script with data-bot-id on same origin
    await page.evaluate((botId) => {
      return new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/widget.js';
        s.setAttribute('data-bot-id', botId);
        s.setAttribute('data-turnstile-token', '1x0000000000000000000000000000000AA');
        s.onload = () => resolve();
        s.onerror = (e) => reject(e);
        document.body.appendChild(s);
      });
    }, testChatbotId);

    // Wait for the shadow host container element
    const host = page.locator('#styleflo-chat-widget');
    await expect(host).toBeAttached({ timeout: 10000 });

    // Open the chat window by clicking the floating chat bubble in shadow root
    await page.evaluate(() => {
      const root = document.querySelector('#styleflo-chat-widget')?.shadowRoot;
      const bubble = root?.querySelector('button');
      if (bubble) bubble.click();
    });

    // Wait until widget input is rendered inside shadow DOM
    const input = page.locator('#styleflo-chat-widget').locator('#styleflo-input');
    await expect(input).toBeVisible({ timeout: 10000 });

    // Verify chat UI elements inside shadow DOM
    const uiVerification = await page.evaluate(() => {
      const root = document.querySelector('#styleflo-chat-widget')?.shadowRoot;
      if (!root) return { hasRoot: false };

      const inputEl = root.querySelector('#styleflo-input') as HTMLInputElement | null;
      const form = root.querySelector('form') as HTMLFormElement | null;
      const vapiBtn = root.querySelector('#styleflo-vapi-btn') as HTMLButtonElement | null;
      const agentHeader = root.querySelector('h3')?.textContent || '';

      return {
        hasRoot: true,
        agentHeader,
        hasInput: !!inputEl,
        hasForm: !!form,
        hasVapiBtn: !!vapiBtn,
      };
    });

    expect(uiVerification.hasRoot).toBeTruthy();
    expect(uiVerification.hasInput).toBeTruthy();
    expect(uiVerification.hasForm).toBeTruthy();
    expect(uiVerification.hasVapiBtn).toBeTruthy();
    expect(uiVerification.agentHeader).toBe('Acme Support Bot');
  });

  test('proxy and stream reject unauthenticated chat stream requests with 401', async ({ request }) => {
    const response = await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        message: 'Hello bot',
        chatbotId: testChatbotId,
      },
    });
    expect(response.status()).toBe(401);
  });

  test('proxy and stream reject made-up x-session-token with 401', async ({ request }) => {
    const response = await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': 'session_unverified_random_uuid',
      },
      data: {
        message: 'Hello bot',
        chatbotId: testChatbotId,
        sessionId: 'session_unverified_random_uuid',
      },
    });
    expect(response.status()).toBe(401);
  });

  test('proxy and stream reject body-only payload with 401 (e1424e0 fallback removed)', async ({ request }) => {
    const response = await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        message: 'Hello bot',
        chatbotId: testChatbotId,
        sessionId: 'session_public_fallback_123',
      },
    });
    expect(response.status()).toBe(401);
  });

  test('public-init rejects request missing x-turnstile-token with 401', async ({ request }) => {
    const response = await request.post('/api/chat/public-init', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        chatbotId: testChatbotId,
      },
    });
    expect(response.status()).toBe(401);
  });

  test('public-init rejects failed Turnstile token with 403', async ({ request }) => {
    // 2x0000000000000000000000000000000AA is Cloudflare's official test token that always fails
    const response = await request.post('/api/chat/public-init', {
      headers: {
        'Content-Type': 'application/json',
        'x-turnstile-token': '2x0000000000000000000000000000000AA',
      },
      data: {
        chatbotId: testChatbotId,
      },
    });
    expect(response.status()).toBe(403);
  });

  test('public-init issues signed token when given valid Turnstile test token', async ({ request }) => {
    // 1x0000000000000000000000000000000AA is Cloudflare's official test token that always passes
    const response = await request.post('/api/chat/public-init', {
      headers: {
        'Content-Type': 'application/json',
        'x-turnstile-token': '1x0000000000000000000000000000000AA',
      },
      data: {
        chatbotId: testChatbotId,
      },
    });
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.sessionToken).toBeTruthy();
    expect(data.sessionId).toBeTruthy();
    expect(data.expiresInSeconds).toBe(3600);
  });

  test('chat stream accepts request with valid cryptographically signed session token', async ({ request }) => {
    const sessionId = `session_${Date.now()}_test`;
    const token = signChatSessionToken({
      chatbotId: testChatbotId,
      sessionId,
      expiresInSeconds: 3600,
    });

    const response = await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': token,
      },
      data: {
        message: 'Hello bot',
        chatbotId: testChatbotId,
        sessionId,
      },
    });
    expect(response.status()).toBe(200);
  });

  test('chat stream rejects expired session token with 401', async ({ request }) => {
    const sessionId = `session_${Date.now()}_expired`;
    const expiredToken = signChatSessionToken({
      chatbotId: testChatbotId,
      sessionId,
      expiresInSeconds: -10, // Expired 10 seconds ago
    });

    const response = await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': expiredToken,
      },
      data: {
        message: 'Hello bot',
        chatbotId: testChatbotId,
        sessionId,
      },
    });
    expect(response.status()).toBe(401);
  });

  test('chat stream rejects session token signed for a different chatbotId with 401', async ({ request }) => {
    const sessionId = `session_${Date.now()}_diffbot`;
    const wrongBotToken = signChatSessionToken({
      chatbotId: 'b0000000-0000-0000-0000-000000000002', // Different chatbot
      sessionId,
      expiresInSeconds: 3600,
    });

    const response = await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': wrongBotToken,
      },
      data: {
        message: 'Hello bot',
        chatbotId: testChatbotId,
        sessionId,
      },
    });
    expect(response.status()).toBe(401);
  });

  test('chat stream rejects oversized message (>2,000 characters) with 400', async ({ request }) => {
    const sessionId = `session_${Date.now()}_oversized`;
    const token = signChatSessionToken({
      chatbotId: testChatbotId,
      sessionId,
      expiresInSeconds: 3600,
    });

    const oversizedMessage = 'A'.repeat(2005);
    const response = await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': token,
      },
      data: {
        message: oversizedMessage,
        chatbotId: testChatbotId,
        sessionId,
      },
    });
    expect(response.status()).toBe(400);
  });

  test('chat stream returns 429 when session rate limit (10 messages/minute) is exceeded', async ({ request }) => {
    const sessionId = `session_ratelimit_${Date.now()}`;
    const token = signChatSessionToken({
      chatbotId: testChatbotId,
      sessionId,
      expiresInSeconds: 3600,
    });

    let rateLimited = false;
    for (let i = 0; i < 12; i++) {
      const response = await request.post('/api/chat/stream', {
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': token,
        },
        data: {
          message: `Rate limit probe ${i}`,
          chatbotId: testChatbotId,
          sessionId,
        },
      });

      if (response.status() === 429) {
        rateLimited = true;
        break;
      }
    }
    expect(rateLimited).toBe(true);
  });

  test('widget chat form submission executes Turnstile handshake and sends signed x-session-token header to chat stream', async ({ page }) => {
    await page.goto('/login');

    let streamRequestHeaders: Record<string, string> = {};
    let streamRequestIntercepted = false;

    await page.route('**/api/chat/stream', async (route) => {
      streamRequestIntercepted = true;
      streamRequestHeaders = route.request().headers();
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: Hello from hardened mock stream\n\n',
      });
    });

    // Provide test turnstile token on window to simulate Turnstile verification
    await page.evaluate(() => {
      (window as any).__STYLEFLO_TEST_TURNSTILE_TOKEN__ = '1x0000000000000000000000000000000AA';
    });

    // Inject widget script
    await page.evaluate((botId) => {
      return new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/widget.js';
        s.setAttribute('data-bot-id', botId);
        s.setAttribute('data-turnstile-token', '1x0000000000000000000000000000000AA');
        s.onload = () => resolve();
        s.onerror = (e) => reject(e);
        document.body.appendChild(s);
      });
    }, testChatbotId);

    // Open chat window
    await page.evaluate(() => {
      const root = document.querySelector('#styleflo-chat-widget')?.shadowRoot;
      const bubble = root?.querySelector('button');
      if (bubble) bubble.click();
    });

    // Wait for input inside shadow DOM
    const input = page.locator('#styleflo-chat-widget').locator('#styleflo-input');
    await expect(input).toBeVisible({ timeout: 10000 });

    // Submit a chat message via Playwright keyboard interaction
    await input.fill('Can I book an appointment?');
    await input.press('Enter');

    await expect.poll(() => streamRequestIntercepted).toBe(true);
    const token = streamRequestHeaders['x-session-token'];
    expect(token).toBeTruthy();
    // Verify it has JWT structure: header.payload.signature
    expect(token.split('.').length).toBe(3);
  });
});
