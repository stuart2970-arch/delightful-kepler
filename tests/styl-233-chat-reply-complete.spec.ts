import { test, expect, type APIRequestContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  BOOKING_UNCONFIRMED_SUFFIX,
  CHAT_GENERATION_SETTINGS,
  INCOMPLETE_REPLY_SUFFIX,
  finaliseVisibleReply,
  joinFinalised,
  pipeReply,
} from '../src/lib/chat/stream-reply';
import { ukSlotUtcIso, nextUkWeekdayDate } from './helpers/uk-future-weekday';

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const seedBotId = 'e0000000-0000-0000-0000-000000000001';
const seedTenantId = '10000000-0000-0000-0000-000000000001';
const seedServiceId = '40000000-0000-0000-0000-000000000001';
const sarahId = '30000000-0000-0000-0000-000000000003';

const EMAIL_THEN_CUTOFF = 'Thank you! Just to confirm, I have your email address as test999@styleflo.ai. I have booked your Assisted Setup with **David Mag';
const BULLET_CUTOFF = [
  'Here are the details for your booking:',
  '* Service: Assisted Setup (30 mins, Free)',
  '* Staff Member: David Magowan',
  '* Date: Monday, 9',
].join('\n');

interface TestWindow extends Window {
  __STYLEFLO_TEST_TURNSTILE_TOKEN__?: string;
  __STYLEFLO_MOCK_VAPI__?: boolean;
}

async function startChatSession(request: APIRequestContext) {
  const res = await request.post('/api/chat/public-init', {
    headers: {
      'Content-Type': 'application/json',
      'x-turnstile-token': '1x0000000000000000000000000000000AA',
    },
    data: { chatbotId: seedBotId, termsAccepted: true, termsVersion: '1.0' },
  });
  expect(res.ok()).toBeTruthy();
  return res.json() as Promise<{ sessionToken: string; sessionId: string }>;
}

async function appointmentCount(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', seedTenantId);
  expect(error).toBeNull();
  return count ?? 0;
}

test.describe('STYL-233 complete chat replies', () => {
  test.beforeAll(async () => {
    await supabaseAdmin
      .from('staff')
      .update({ google_calendar_id: 'primary', calendar_provider: 'google', working_days: null })
      .eq('id', sarahId);

    await supabaseAdmin.from('tenant_integrations').upsert([
      { tenant_id: seedTenantId, provider: 'google_calendar', refresh_token: 'mock_google_refresh_token' },
    ], { onConflict: 'tenant_id,provider' });

    await supabaseAdmin.from('appointments').delete().like('customer_email', 'styl233_%');
  });

  test('finaliseVisibleReply trims a cut-off sentence, a cut-off bullet, and leaves a finished reply', () => {
    const emailCut = finaliseVisibleReply(EMAIL_THEN_CUTOFF, { cutShort: true });
    const emailShown = joinFinalised(emailCut);
    expect(emailCut.text.endsWith('test999@styleflo.ai.')).toBe(true);
    expect(emailShown).not.toContain('**');
    expect(emailShown).not.toContain('David Mag');
    expect(emailShown.endsWith(INCOMPLETE_REPLY_SUFFIX)).toBe(true);

    const fragment = finaliseVisibleReply('I have booked your Assisted Setup with **David Mag', { cutShort: true });
    const fragmentShown = joinFinalised(fragment);
    expect(fragment.text).toBe('');
    expect(fragmentShown).toBe(INCOMPLETE_REPLY_SUFFIX);
    expect(fragmentShown).not.toContain('**');

    const bullets = finaliseVisibleReply(BULLET_CUTOFF, { cutShort: true });
    const bulletShown = joinFinalised(bullets);
    expect(bulletShown).toContain('* Staff Member: David Magowan');
    expect(bulletShown).not.toContain('Monday, 9');
    expect(bulletShown.endsWith(INCOMPLETE_REPLY_SUFFIX)).toBe(true);

    const complete = 'Your Haircut & Styling with Sarah Miller is confirmed for Thu 13 Nov at 11:00.';
    expect(finaliseVisibleReply(complete, { cutShort: false })).toEqual({ text: complete, suffix: '' });
    expect(joinFinalised(finaliseVisibleReply(complete))).toBe(complete);
  });

  test('pipeReply applies a length cut, times out a stuck stream, and rejoins split words', async () => {
    const lengthParts: string[] = [];
    const length = await pipeReply({
      textStream: ['I have booked your Assisted Setup with **David Mag'],
      finishReason: Promise.resolve('length'),
      enqueue: (chunk) => lengthParts.push(chunk),
    });
    const lengthText = lengthParts.join('');
    expect(length.finishReason).toBe('length');
    expect(length.timedOut).toBe(false);
    expect(length.cutShort).toBe(true);
    expect(lengthText).toContain(INCOMPLETE_REPLY_SUFFIX);
    expect(lengthText).not.toContain('**');
    expect(length.visibleText).toBe(lengthText);

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* stuck() {
      yield 'I have booked your Assisted Setup with **David';
      await gate;
      yield ' finished.';
    }
    const timeoutParts: string[] = [];
    const started = Date.now();
    try {
      const timed = await pipeReply({
        textStream: stuck(),
        timeoutMs: 200,
        enqueue: (chunk) => timeoutParts.push(chunk),
      });
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(timed.timedOut).toBe(true);
      expect(timeoutParts.join('')).toContain(INCOMPLETE_REPLY_SUFFIX);
      expect(timeoutParts.join('')).not.toContain('**');
    } finally {
      release();
    }

    const chunks = ['Please book me in with **David Mag', 'owan** on Monday.'];
    const joinedParts: string[] = [];
    const joined = await pipeReply({
      textStream: chunks,
      finishReason: Promise.resolve('stop'),
      enqueue: (chunk) => joinedParts.push(chunk),
    });
    expect(joined.rawText).toBe(chunks.join(''));
    expect(joined.visibleText).toBe(chunks.join(''));
    expect(joinedParts.join('')).toBe(chunks.join(''));
    expect(joined.timedOut).toBe(false);
  });

  test('generation settings give the visible reply room and every chat streamText call uses them', () => {
    expect(CHAT_GENERATION_SETTINGS.maxOutputTokens).toBeGreaterThanOrEqual(2048);
    expect(CHAT_GENERATION_SETTINGS.providerOptions.google.thinkingConfig.thinkingLevel).toBe('low');

    const src = readFileSync(path.resolve(__dirname, '../src/app/api/chat/stream/route.ts'), 'utf8');
    expect(src.match(/await \(?streamText/g)?.length).toBe(3);
    expect(src.match(/\.\.\.CHAT_GENERATION_SETTINGS/g)?.length).toBe(3);
    expect(src).not.toContain('maxOutputTokens: 1024');

    const index = readFileSync(path.resolve(__dirname, '../src/widget/index.ts'), 'utf8');
    const embed = readFileSync(path.resolve(__dirname, '../src/widget/embed.ts'), 'utf8');
    expect(index).toBe(embed);
    expect(index).toContain('decoder.decode()');
    expect(index).toContain('if (done) break;');
  });

  test('a mocked booking tag is confirmed with service, staff, date, time and email', async ({ request }) => {
    const bookDate = nextUkWeekdayDate(new Date(), 7);
    const start = ukSlotUtcIso(bookDate, '13:15');
    const end = ukSlotUtcIso(bookDate, '13:45');
    const email = `styl233_book_${Date.now()}@example.com`;
    const { sessionToken, sessionId } = await startChatSession(request);
    const res = await request.post('/api/chat/stream', {
      headers: { 'Content-Type': 'application/json', 'x-session-token': sessionToken },
      data: {
        chatbotId: seedBotId,
        sessionId,
        message: 'Please book the Friday slot.',
        mockModelReply: `Thank you. [BOOK_MEETING: ${sarahId}, ${seedServiceId}, StyleFlo Test, ${email}, 07700900111, ${start}, ${end}]`,
      },
    });
    expect(res.ok()).toBeTruthy();
    const text = (await res.text()).trim();
    expect(text).toContain('Haircut & Styling');
    expect(text).toContain('Sarah Miller');
    expect(text).toContain('13:15');
    expect(text).toContain(email);
    expect(text.endsWith('.')).toBe(true);
    expect(text).toMatch(/Your Haircut & Styling with Sarah Miller is confirmed for .+ at 13:15\./);
    expect(text).not.toContain('[BOOK_MEETING');
    expect(text).not.toContain('**');
    expect(text).not.toContain(INCOMPLETE_REPLY_SUFFIX);
    await supabaseAdmin.from('appointments').delete().eq('customer_email', email);
  });

  test('a booked claim with no tag is withdrawn and does not create an appointment', async ({ request }) => {
    const before = await appointmentCount();
    const { sessionToken, sessionId } = await startChatSession(request);
    const res = await request.post('/api/chat/stream', {
      headers: { 'Content-Type': 'application/json', 'x-session-token': sessionToken },
      data: {
        chatbotId: seedBotId,
        sessionId,
        message: 'Please confirm that booking.',
        mockModelReply: ['I have booked your Assisted Setup with **David Mag'],
      },
    });
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(text).toContain(BOOKING_UNCONFIRMED_SUFFIX);
    expect(text).not.toContain('**');
    expect(text).not.toContain('David Mag');
    expect(await appointmentCount()).toBe(before);
  });

  test('an announced check with no tag still returns real days', async ({ request }) => {
    const { sessionToken, sessionId } = await startChatSession(request);
    const started = Date.now();
    const res = await request.post('/api/chat/stream', {
      headers: { 'Content-Type': 'application/json', 'x-session-token': sessionToken },
      data: {
        chatbotId: seedBotId,
        sessionId,
        message: 'Can I book a Haircut & Styling on Saturday?',
        mockModelReply: ['Let me check our schedule for Saturday, 7th November'],
      },
    });
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(text).toContain('Here are the days with free times:');
    expect(text).toContain('[QUICK_DAYS');
    expect(text).not.toContain(INCOMPLETE_REPLY_SUFFIX);
  });

  test('a calendar that outlasts the timeout ends with the existing fallback', async ({ request }) => {
    test.setTimeout(40_000);
    const { data: staffBefore, error: staffError } = await supabaseAdmin
      .from('staff')
      .select('id, google_calendar_id, calendar_provider')
      .eq('tenant_id', seedTenantId);
    expect(staffError).toBeNull();
    const { error: slowError } = await supabaseAdmin
      .from('staff')
      .update({ google_calendar_id: 'slow-calendar', calendar_provider: 'google' })
      .eq('tenant_id', seedTenantId);
    expect(slowError).toBeNull();

    try {
      const { sessionToken, sessionId } = await startChatSession(request);
      const started = Date.now();
      const res = await request.post('/api/chat/stream', {
        headers: { 'Content-Type': 'application/json', 'x-session-token': sessionToken },
        data: {
          chatbotId: seedBotId,
          sessionId,
          message: 'Can I book a Haircut & Styling?',
          mockModelReply: ['Let me check our schedule for Saturday, 7th November'],
        },
      });
      expect(res.ok()).toBeTruthy();
      const text = await res.text();
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(20_000);
      expect(text).toContain("I can't reach the calendar just now");
      expect(text).not.toContain('Here are the days with free times:');
    } finally {
      for (const row of staffBefore || []) {
        await supabaseAdmin
          .from('staff')
          .update({
            google_calendar_id: row.google_calendar_id,
            calendar_provider: row.calendar_provider,
          })
          .eq('id', row.id);
      }
    }
  });

  test('widget bubble shows the full booking confirmation', async ({ page }) => {
    test.setTimeout(60_000);
    const bookDate = nextUkWeekdayDate(new Date(), 8);
    const start = ukSlotUtcIso(bookDate, '15:30');
    const end = ukSlotUtcIso(bookDate, '16:30');
    const email = `styl233_widget_${Date.now()}@example.com`;

    await page.goto('/login');
    await page.route('**/api/chat/stream', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.action) return route.continue();
      await route.continue({
        postData: JSON.stringify({
          ...body,
          mockModelReply: `Thank you. [BOOK_MEETING: ${sarahId}, ${seedServiceId}, Widget Tester, ${email}, 07700900111, ${start}, ${end}]`,
        }),
      });
    });

    await page.evaluate((botId) => {
      const win = window as unknown as TestWindow;
      win.__STYLEFLO_TEST_TURNSTILE_TOKEN__ = '1x0000000000000000000000000000000AA';
      win.__STYLEFLO_MOCK_VAPI__ = true;
      const script = document.createElement('script');
      script.src = '/widget.js';
      script.setAttribute('data-bot-id', botId);
      document.body.appendChild(script);
    }, seedBotId);

    const host = page.locator('#styleflo-chat-widget');
    await expect(host).toBeAttached({ timeout: 10000 });
    await host.locator('#styleflo-menu-chat').evaluate((btn: HTMLButtonElement) => btn.click());

    const nameInput = host.locator('#styleflo-onboarding-name');
    if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameInput.fill('Widget Tester');
      const terms = host.locator('#styleflo-disclaimer-accept');
      if (await terms.isVisible()) await terms.check();
      await host.locator('#styleflo-onboarding-submit-btn').click();
    }

    const chatInput = host.locator('#styleflo-input');
    await expect(chatInput).toBeVisible({ timeout: 10000 });
    await chatInput.fill('Please book that slot');
    await host.locator('#styleflo-chat-form').evaluate((form: HTMLFormElement) => {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const bubble = host.locator('.styleflo-msg-bubble-bot').last();
    await expect(bubble).toContainText('Sarah Miller', { timeout: 15000 });
    await expect(bubble).toContainText('15:30');
    const bubbleText = (await bubble.innerText()).trim();
    expect(bubbleText.endsWith('.')).toBe(true);
    expect(bubbleText).toContain('Haircut & Styling');
    expect(bubbleText).not.toContain('[BOOK_MEETING');
    expect(bubbleText).not.toContain('**');
    await supabaseAdmin.from('appointments').delete().eq('customer_email', email);
  });
});
