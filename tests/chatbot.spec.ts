import { test, expect } from '@playwright/test';

test.describe('Chatbot & Widget Functionality', () => {
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
    await page.waitForFunction(() => {
      const root = document.querySelector('#styleflo-chat-widget')?.shadowRoot;
      return !!root?.querySelector('input');
    }, { timeout: 10000 });

    // Verify chat UI elements inside shadow DOM
    const uiVerification = await page.evaluate(() => {
      const root = document.querySelector('#styleflo-chat-widget')?.shadowRoot;
      if (!root) return { hasRoot: false };

      const input = root.querySelector('input') as HTMLInputElement | null;
      const form = root.querySelector('form') as HTMLFormElement | null;
      const vapiBtn = root.querySelector('#styleflo-vapi-btn') as HTMLButtonElement | null;
      const agentHeader = root.querySelector('h3')?.textContent || '';

      return {
        hasRoot: true,
        agentHeader,
        hasInput: !!input,
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

  test('proxy blocks chat stream when missing auth headers and valid payload', async ({ request }) => {
    const response = await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        message: 'Hello bot',
      },
    });
    expect(response.status()).toBe(401);
  });

  test('proxy allows chat stream with x-session-token header', async ({ request }) => {
    const response = await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': 'session_test_123',
      },
      data: {
        message: 'Hello bot',
        chatbotId: testChatbotId,
        sessionId: 'session_test_123',
      },
    });
    // Proxy auth passes (status should not be 401)
    expect(response.status()).not.toBe(401);
  });

  test('proxy defense-in-depth fallback allows public chat stream with valid chatbotId and sessionId', async ({ request }) => {
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
    // Proxy auth passes (status should not be 401)
    expect(response.status()).not.toBe(401);
  });

  test('widget chat form submission sends x-session-token header to chat stream', async ({ page }) => {
    await page.goto('/login');

    let streamRequestHeaders: Record<string, string> = {};
    let streamRequestIntercepted = false;

    await page.route('**/api/chat/stream', async (route) => {
      streamRequestIntercepted = true;
      streamRequestHeaders = route.request().headers();
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: Hello from mock stream\n\n',
      });
    });

    // Inject widget script
    await page.evaluate((botId) => {
      return new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/widget.js';
        s.setAttribute('data-bot-id', botId);
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
    expect(streamRequestHeaders['x-session-token']).toBeTruthy();
  });
});
