import { test, expect, type APIRequestContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import dotenv from 'dotenv';
import {
  parseTruncatedAvailabilityTag,
  resolveByIdPrefix,
  splitAtToolTag,
  visibleLength,
} from '../src/lib/calendar/tool-tags';

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

const PRE_TAG = 'I would be happy to help you book a Haircut & Styling with Sarah Miller! 📅\n\nWhich day suits you best?\n\n';
// The live reply stopped partway through the staff id, before the closing bracket.
const CUT_OFF_REPLY = [PRE_TAG, '[CHECK_AVAIL', 'ABILITY: 30000000-0'];

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

test.describe('Unfinished calendar tool tags in chat and voice', () => {
  test.beforeAll(async () => {
    await supabaseAdmin
      .from('staff')
      .update({ google_calendar_id: 'primary', calendar_provider: 'google', working_days: null })
      .eq('id', sarahId);

    await supabaseAdmin.from('tenant_integrations').upsert([
      { tenant_id: seedTenantId, provider: 'google_calendar', refresh_token: 'mock_google_refresh_token' },
    ], { onConflict: 'tenant_id,provider' });
  });

  test('tool tag helpers hold back tags and read what a cut-off tag says', () => {
    expect(visibleLength('Which day suits you?')).toBe(20);
    expect(visibleLength('Which day? [CHECK_AV')).toBe(11);
    expect(visibleLength('Which day? [CHECK_AVAILABILITY: abc')).toBe(11);
    expect(visibleLength('Prices [see list]')).toBe(17);

    expect(splitAtToolTag('Hello [').hadTag).toBe(false);
    expect(splitAtToolTag('Hello [CHE')).toEqual({ before: 'Hello ', hadTag: true });

    expect(parseTruncatedAvailabilityTag('Hi [CHECK_AVAILABILITY: fbdadad2-a')).toEqual({ staffRef: 'fbdadad2-a', serviceRef: '' });
    expect(parseTruncatedAvailabilityTag('Hi [CHECK_AV')).toEqual({ staffRef: '', serviceRef: '' });
    expect(parseTruncatedAvailabilityTag('Hi there')).toBeNull();

    const staff = [{ id: 'fbdadad2-a111' }, { id: 'fbdadad2-b222' }, { id: '12345678-c333' }];
    expect(resolveByIdPrefix(staff, 'fbdadad2-a')?.id).toBe('fbdadad2-a111');
    expect(resolveByIdPrefix(staff, 'fbdadad2')).toBeNull();
    expect(resolveByIdPrefix(staff, 'fb')).toBeNull();
  });

  test('widget: staff name then booking request with a cut-off tag shows days, never the tag', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/login');

    await page.route('**/api/chat/stream', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.action) return route.continue();
      await route.continue({
        postData: JSON.stringify({ ...body, mockModelReply: CUT_OFF_REPLY }),
      });
    });

    await page.evaluate((botId) => {
      const win = window as unknown as TestWindow;
      win.__STYLEFLO_TEST_TURNSTILE_TOKEN__ = '1x0000000000000000000000000000000AA';
      win.__STYLEFLO_MOCK_VAPI__ = true;
      const s = document.createElement('script');
      s.src = '/widget.js';
      s.setAttribute('data-bot-id', botId);
      document.body.appendChild(s);
    }, seedBotId);

    const host = page.locator('#styleflo-chat-widget');
    await expect(host).toBeAttached({ timeout: 10000 });
    const menuChat = host.locator('#styleflo-menu-chat');
    await expect(menuChat).toBeAttached({ timeout: 10000 });
    await menuChat.evaluate((btn: HTMLButtonElement) => btn.click());

    const nameInput = host.locator('#styleflo-onboarding-name');
    if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameInput.fill('Stuart');
      const terms = host.locator('#styleflo-disclaimer-accept');
      if (await terms.isVisible()) await terms.check();
      await host.locator('#styleflo-onboarding-submit-btn').click();
    }

    const chatInput = host.locator('#styleflo-input');
    await expect(chatInput).toBeVisible({ timeout: 10000 });
    await chatInput.fill('Hi, can i book a Haircut & Styling with Sarah please');
    await host.locator('#styleflo-chat-form').evaluate((form: HTMLFormElement) => {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const messages = host.locator('#styleflo-messages');
    await expect(messages).toContainText('Which day suits you best?', { timeout: 15000 });
    await expect(host.locator('.styleflo-day-btn').first()).toBeVisible({ timeout: 15000 });

    const bubbleText = await messages.innerText();
    expect(bubbleText).not.toContain('[CHECK_AVAILABILITY');
    expect(bubbleText).not.toContain('[CHECK_AVAIL');
    expect(bubbleText).not.toContain('30000000-0');
  });

  test('stream: a cut-off tag never reaches the customer and real days are offered for that staff member', async ({ request }) => {
    const { sessionToken, sessionId } = await startChatSession(request);
    const res = await request.post('/api/chat/stream', {
      headers: { 'Content-Type': 'application/json', 'x-session-token': sessionToken },
      data: {
        chatbotId: seedBotId,
        sessionId,
        message: 'Hi, can i book a Haircut & Styling please',
        mockModelReply: [PRE_TAG, `[CHECK_AVAILABILITY: ${sarahId}, 4000`],
      },
    });
    expect(res.ok()).toBeTruthy();
    const text = await res.text();

    expect(text).toContain('Which day suits you best?');
    expect(text).not.toContain('[CHECK_AVAILABILITY');
    expect(text).not.toContain('[CHECK_AVAIL');
    const quickDays = text.match(/\[QUICK_DAYS:\s*(\{[\s\S]*\})\]/);
    expect(quickDays, 'real bookable days are offered').not.toBeNull();
    const payload = JSON.parse(quickDays![1]);
    expect(payload.staffId).toBe(sarahId);
    expect(payload.serviceId).toBe(seedServiceId);
    expect(payload.days.length).toBeGreaterThan(0);
  });

  test('stream: a complete tag split across chunks still runs the check and is never shown', async ({ request }) => {
    const { sessionToken, sessionId } = await startChatSession(request);
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
    const res = await request.post('/api/chat/stream', {
      headers: { 'Content-Type': 'application/json', 'x-session-token': sessionToken },
      data: {
        chatbotId: seedBotId,
        sessionId,
        message: 'Can I book a Haircut & Styling with Sarah?',
        mockModelReply: [PRE_TAG, '[CHECK_', `AVAILABILITY: ${sarahId}, ${seedServiceId}, `, `${start}, ${end}]`],
        mockPass2Reply: 'Sarah has free times this week. Which day suits you best?',
      },
    });
    expect(res.ok()).toBeTruthy();
    const text = await res.text();

    expect(text).not.toContain('[CHECK_');
    expect(text).toContain('Sarah has free times this week.');
    expect(text).toContain('[QUICK_DAYS:');
  });

  test('voice: a cut-off tag is never spoken and the caller hears the fallback', async ({ request }) => {
    const res = await request.post(`/api/voice/${seedBotId}/chat/completions`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        sessionId: `test_voice_cutoff_${Date.now()}`,
        messages: [{ role: 'user', content: 'Can I book with Sarah please?' }],
        mockModelReply: ['Let me check that for you. ', '[CHECK_AVAILABILITY: 30000000-0'],
      },
    });
    expect(res.status()).toBe(200);
    const spoken = (await res.text())
      .split('\n')
      .filter((line) => line.startsWith('data: {'))
      .map((line) => JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || '')
      .join('');

    expect(spoken).not.toContain('[CHECK_AVAILABILITY');
    expect(spoken).not.toContain('30000000-0');
    expect(spoken).toContain('Let me check that for you.');
    expect(spoken).toContain('the salon will confirm');
  });
});
