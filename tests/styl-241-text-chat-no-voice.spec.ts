import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * STYL-241: a text chat must not start a Vapi web call, must not ask for the
 * microphone, and must describe itself as a chat. Voice starts only after an
 * explicit Voice Call or mic press in the flow the visitor is currently in.
 *
 * Vapi is mocked (`__STYLEFLO_MOCK_VAPI__`) and every api.vapi.ai request is
 * recorded and aborted. No live voice calls.
 */

const root = process.cwd();
const homepageBotId = '9825855e-d478-443f-b75c-6c0d77039ca6';

const TEXT_CHAT_NOTICE =
  "You're chatting with our AI assistant. We keep a transcript of this chat for reference and contact purposes, as explained in our Privacy Policy.";

const VOICE_DISCLAIMER_RAW =
  'Before we connect you, this call is between you and our AI agent, and we keep a record of the transcription for reference and contact purposes, this is outlined in our privacy-policy which can be found on our website.';

const VOICE_NOTICE_SNIPPET = 'this call is between you and our AI assistant';

interface TestWindow extends Window {
  __STYLEFLO_TEST_TURNSTILE_TOKEN__?: string;
  __STYLEFLO_MOCK_VAPI__?: boolean;
  __STYLEFLO_LAST_VAPI_CALL__?: unknown;
  __STYLEFLO_GET_USER_MEDIA_CALLS__?: number;
  __STYLEFLO_AUDIO_SRCS__?: string[];
}

test.describe('STYL-241: text chat does not start voice', () => {
  test('widget entry files stay identical', () => {
    const index = readFileSync(join(root, 'src/widget/index.ts'), 'utf8');
    const embed = readFileSync(join(root, 'src/widget/embed.ts'), 'utf8');
    expect(index).toBe(embed);
    expect(index).toContain(TEXT_CHAT_NOTICE);
  });

  test('text chat never calls Vapi', async ({ page }) => {
    const vapiHits = await blockVapi(page);
    await mockChatReply(page);
    await stubVoiceDisclaimer(page);
    const host = await mountWidget(page);

    await click(host, '#styleflo-menu-chat');
    await passGate(host);
    await sendChat(host, 'Hello from text chat');

    await expect(host.locator('#styleflo-messages')).toContainText('Text chat reply from the assistant.', {
      timeout: 15000,
    });
    await expectNoVoiceSideEffects(page, host, vapiHits);
  });

  test('changed mind: Voice Call, close, then Text Chat does not start a call', async ({ page }) => {
    const vapiHits = await blockVapi(page);
    await stubVoiceDisclaimer(page);
    const host = await mountWidget(page);

    await click(host, '#styleflo-menu-call');
    await expect(host.locator('#styleflo-onboarding')).toBeVisible({ timeout: 10000 });

    await click(host, '#styleflo-close-btn');
    await click(host, '#styleflo-menu-chat');

    const notice = await gateNotice(host);
    expect(notice).toContain(TEXT_CHAT_NOTICE);
    expect(notice).not.toContain('this call');
    expect(notice).not.toContain('Before we connect you');

    await passGate(host);
    await expect(host.locator('#styleflo-messages')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);
    await expectNoVoiceSideEffects(page, host, vapiHits);
  });

  test('mic before the gate, then Text Chat, does not start a call', async ({ page }) => {
    const vapiHits = await blockVapi(page);
    await stubVoiceDisclaimer(page);
    const host = await mountWidget(page);

    await click(host, '#styleflo-vapi-btn');
    await expect(host.locator('#styleflo-onboarding')).toBeVisible({ timeout: 10000 });
    await click(host, '#styleflo-menu-chat');

    const notice = await gateNotice(host);
    expect(notice).toContain(TEXT_CHAT_NOTICE);
    expect(notice).not.toContain('this call');

    await passGate(host);
    await expect(host.locator('#styleflo-messages')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);
    await expectNoVoiceSideEffects(page, host, vapiHits);
  });

  test('explicit Voice Call shows the voice notice, starts a mock call, and clears Connecting', async ({ page }) => {
    const vapiHits = await blockVapi(page);
    await stubVoiceDisclaimer(page);
    const host = await mountWidget(page);

    await click(host, '#styleflo-menu-call');
    const notice = await gateNotice(host);
    expect(notice).toContain(VOICE_NOTICE_SNIPPET);
    expect(notice).toContain('Before we connect you');
    expect(notice).not.toContain(TEXT_CHAT_NOTICE);

    await page.clock.install();
    await passGate(host);

    await expect(host.getByText('Connecting agent...')).toBeVisible({ timeout: 10000 });
    await expect.poll(async () => {
      return page.evaluate(() => (window as unknown as TestWindow).__STYLEFLO_LAST_VAPI_CALL__);
    }, { timeout: 10000 }).toBeTruthy();

    await page.clock.fastForward(20000);
    await expect(host.getByText('Connecting agent...')).not.toBeVisible({ timeout: 5000 });

    expect(vapiHits).toEqual([]);
    const micCalls = await page.evaluate(() => (window as unknown as TestWindow).__STYLEFLO_GET_USER_MEDIA_CALLS__ || 0);
    expect(micCalls).toBe(0);
  });

  test('text gate copy is the chat notice and the voice gate keeps the call notice', async ({ page }) => {
    await blockVapi(page);
    await stubVoiceDisclaimer(page);
    const host = await mountWidget(page);

    await click(host, '#styleflo-menu-chat');
    const textNotice = await gateNotice(host);
    expect(textNotice).toContain(TEXT_CHAT_NOTICE);
    expect(textNotice).not.toContain('this call');
    expect(textNotice).not.toContain('Before we connect you');
    await expect(host.locator('#styleflo-onboarding h4')).toHaveText('Meet our AI assistant');
    await expect(host.locator('#styleflo-onboarding')).toContainText('Please read before you start');
    await expect(host.locator('label[for="styleflo-disclaimer-accept"]')).toHaveText(
      'I agree to the Terms and acknowledge the Privacy Policy.',
    );

    await click(host, '#styleflo-close-btn');
    await click(host, '#styleflo-menu-call');
    const voiceNotice = await gateNotice(host);
    expect(voiceNotice).toContain(VOICE_NOTICE_SNIPPET);
    expect(voiceNotice).not.toContain('our AI agent');
    expect(voiceNotice).not.toContain(TEXT_CHAT_NOTICE);
  });

  test('voice after a text gate shows the voice notice once, then connects', async ({ page }) => {
    const vapiHits = await blockVapi(page);
    await stubVoiceDisclaimer(page);
    const host = await mountWidget(page);

    await click(host, '#styleflo-menu-chat');
    await passGate(host);
    await expect(host.locator('#styleflo-messages')).toBeVisible({ timeout: 10000 });

    await click(host, '#styleflo-vapi-btn');
    await expect.poll(async () => {
      return page.evaluate(() => (window as unknown as TestWindow).__STYLEFLO_LAST_VAPI_CALL__);
    }, { timeout: 10000 }).toBeTruthy();

    await expect(host.locator('#styleflo-messages')).toContainText(VOICE_NOTICE_SNIPPET);
    expect(await countSnippet(host, VOICE_NOTICE_SNIPPET)).toBe(1);

    await click(host, '#styleflo-vapi-btn');
    await page.waitForTimeout(500);
    expect(await countSnippet(host, VOICE_NOTICE_SNIPPET)).toBe(1);
    expect(vapiHits).toEqual([]);
  });
});

async function blockVapi(page: Page): Promise<string[]> {
  const hits: string[] = [];
  await page.route('**/api.vapi.ai/**', async (route) => {
    hits.push(`${route.request().method()} ${route.request().url()}`);
    await route.abort();
  });
  return hits;
}

async function stubVoiceDisclaimer(page: Page) {
  await page.route(`**/api/chatbots/${homepageBotId}*`, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.globalVoiceDisclaimer = VOICE_DISCLAIMER_RAW;
    json.voiceEnabled = true;
    await route.fulfill({ response, json });
  });
}

async function mockChatReply(page: Page) {
  await page.route('**/api/chat/stream', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.action) {
      await route.continue();
      return;
    }
    await route.continue({
      postData: JSON.stringify({ ...body, mockModelReply: 'Text chat reply from the assistant.' }),
    });
  });
}

async function mountWidget(page: Page): Promise<Locator> {
  await page.addInitScript(() => {
    const win = window as unknown as TestWindow;
    win.__STYLEFLO_GET_USER_MEDIA_CALLS__ = 0;
    win.__STYLEFLO_AUDIO_SRCS__ = [];
    const OrigAudio = window.Audio;
    const Wrapped = function (this: HTMLAudioElement, src?: string) {
      win.__STYLEFLO_AUDIO_SRCS__!.push(src || '');
      return new OrigAudio(src);
    };
    Wrapped.prototype = OrigAudio.prototype;
    window.Audio = Wrapped as unknown as typeof Audio;

    const devices = navigator.mediaDevices;
    if (devices && typeof devices.getUserMedia === 'function') {
      const orig = devices.getUserMedia.bind(devices);
      devices.getUserMedia = async (...args: Parameters<MediaDevices['getUserMedia']>) => {
        win.__STYLEFLO_GET_USER_MEDIA_CALLS__ = (win.__STYLEFLO_GET_USER_MEDIA_CALLS__ || 0) + 1;
        return orig(...args);
      };
    }
  });

  await page.goto('/login');
  await page.evaluate((botId) => {
    localStorage.clear();
    sessionStorage.clear();
    const win = window as unknown as TestWindow;
    win.__STYLEFLO_TEST_TURNSTILE_TOKEN__ = '1x0000000000000000000000000000000AA';
    win.__STYLEFLO_MOCK_VAPI__ = true;
    delete win.__STYLEFLO_LAST_VAPI_CALL__;
    const s = document.createElement('script');
    s.src = '/widget.js';
    s.setAttribute('data-bot-id', botId);
    document.body.appendChild(s);
  }, homepageBotId);

  const host = page.locator('#styleflo-chat-widget');
  await expect(host).toBeAttached({ timeout: 10000 });
  await expect(host.locator('#styleflo-menu-call')).toBeAttached({ timeout: 10000 });
  await expect(host.locator('#styleflo-vapi-btn')).toBeAttached({ timeout: 10000 });
  return host;
}

async function click(host: Locator, selector: string) {
  await host.locator(selector).evaluate((el: HTMLElement) => el.click());
}

async function passGate(host: Locator, name = 'Sarah Jones') {
  const onboarding = host.locator('#styleflo-onboarding');
  await expect(onboarding).toBeVisible({ timeout: 10000 });
  await host.locator('#styleflo-onboarding-name').fill(name);
  await host.locator('#styleflo-disclaimer-accept').check();
  const submit = host.locator('#styleflo-onboarding-submit-btn');
  await expect(submit).toBeEnabled();
  await submit.click();
}

async function sendChat(host: Locator, message: string) {
  const chatInput = host.locator('#styleflo-input');
  await expect(chatInput).toBeVisible({ timeout: 10000 });
  await chatInput.fill(message);
  await host.locator('#styleflo-chat-form').evaluate((form: HTMLFormElement) => {
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function gateNotice(host: Locator): Promise<string> {
  const onboarding = host.locator('#styleflo-onboarding');
  await expect(onboarding).toBeVisible({ timeout: 10000 });
  const notice = onboarding.locator('.bg-blue-50\\/80, [class*="bg-blue-50"]');
  await expect(notice).toBeVisible();
  return (await notice.textContent()) || '';
}

async function countSnippet(host: Locator, snippet: string): Promise<number> {
  const text = (await host.locator('#styleflo-messages').innerText()) || '';
  return text.split(snippet).length - 1;
}

async function expectNoVoiceSideEffects(page: Page, host: Locator, vapiHits: string[]) {
  expect(vapiHits).toEqual([]);
  const lastCall = await page.evaluate(() => (window as unknown as TestWindow).__STYLEFLO_LAST_VAPI_CALL__);
  expect(lastCall).toBeUndefined();
  await expect(host.getByText('Connecting agent...')).not.toBeVisible();
  const micCalls = await page.evaluate(() => (window as unknown as TestWindow).__STYLEFLO_GET_USER_MEDIA_CALLS__ || 0);
  expect(micCalls).toBe(0);
  const audioSrcs = await page.evaluate(() => (window as unknown as TestWindow).__STYLEFLO_AUDIO_SRCS__ || []);
  expect(audioSrcs.join(' ')).not.toContain('phone_ringing');
}
