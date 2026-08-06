import { test, expect } from '@playwright/test';

test.describe('Chatbot & Widget Functionality', () => {
  const testChatbotId = '0d37a64b-a4e7-462d-834a-22c948bba528'; // Betfred / Ailen Stats chatbot

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
    expect(uiVerification.agentHeader).toBe('Betfred');
  });
});
