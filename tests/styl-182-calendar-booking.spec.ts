import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import dotenv from 'dotenv';
import {
  calculateAvailableSlots,
  formatQuickDaysTag,
  formatQuickTimesTag,
  formatQuickServicesTag,
  getSlotsForDay,
} from '../src/lib/calendar/availability';
import {
  resolveCalendarProvider,
  createEvent,
  type StaffCalendarTarget,
} from '../src/lib/calendar/provider';
import {
  getAvailabilityData,
  bookMeeting,
} from '../src/app/api/chat/stream/calendar';

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface TestWindow extends Window {
  __STYLEFLO_TEST_TURNSTILE_TOKEN__?: string;
  __STYLEFLO_MOCK_VAPI__?: boolean;
}

test.describe('STYL-182: Calendar Availability & Quick-Links Booking Flow', () => {
  const seedBotId = 'e0000000-0000-0000-0000-000000000001';
  const seedTenantId = '10000000-0000-0000-0000-000000000001';
  const seedServiceId = '40000000-0000-0000-0000-000000000001';
  const homepageBotId = '9825855e-d478-443f-b75c-6c0d77039ca6';

  let testStaffId: string = '30000000-0000-0000-0000-000000000003';

  test.beforeAll(async () => {
    process.env.PLAYWRIGHT_TEST = 'true';

    testStaffId = '30000000-0000-0000-0000-000000000003';
    await supabaseAdmin
      .from('staff')
      .update({ google_calendar_id: 'primary', calendar_provider: 'google', working_days: null })
      .eq('id', testStaffId);

    // Ensure mock integrations exist for seedTenantId so tests run without real external OAuth
    await supabaseAdmin.from('tenant_integrations').upsert([
      {
        tenant_id: seedTenantId,
        provider: 'google_calendar',
        refresh_token: 'mock_google_refresh_token',
      },
      {
        tenant_id: seedTenantId,
        provider: 'microsoft_calendar',
        refresh_token: 'mock_ms_refresh_token',
      },
    ], { onConflict: 'tenant_id,provider' });
  });

  test.beforeEach(async () => {
    await supabaseAdmin
      .from('appointments')
      .delete()
      .eq('tenant_id', seedTenantId);
  });

  // --------------------------------------------------------------------------
  // a. Google Calendar Tenant: Quick-links flow
  // --------------------------------------------------------------------------
  test('Google Calendar tenant generates quick days and times, books into calendar and writes appointment row', async () => {
    const startStr = '2026-11-02T09:00:00';
    const endStr = '2026-11-02T17:00:00';
    const timezone = 'Europe/London';

    // 1. Check availability
    const avail = await getAvailabilityData(
      seedTenantId,
      testStaffId,
      seedServiceId,
      startStr,
      endStr,
      timezone
    );

    expect(avail.slots.length).toBeGreaterThan(0);
    expect(avail.quickDaysTag).toContain('[QUICK_DAYS:');
    expect(avail.quickTimesTag).toContain('[QUICK_TIMES:');

    // 2. Book meeting into calendar
    const slotToBook = avail.slots[0];
    const customerEmail = `styl182_google_${Date.now()}@example.com`;
    const customerName = 'Google Tenant Customer';
    const customerPhone = '07700900001';

    const bookingResult = await bookMeeting(
      seedTenantId,
      testStaffId,
      seedServiceId,
      customerName,
      customerEmail,
      customerPhone,
      slotToBook.start,
      slotToBook.end,
      timezone
    );

    expect(bookingResult).toContain('Successfully booked appointment');

    // 3. Verify appointment row in Supabase
    const { data: appt, error: apptError } = await supabaseAdmin
      .from('appointments')
      .select('*')
      .eq('tenant_id', seedTenantId)
      .eq('customer_email', customerEmail)
      .maybeSingle();

    expect(apptError).toBeNull();
    expect(appt).not.toBeNull();
    expect(appt?.customer_name).toBe(customerName);
    expect(appt?.google_event_id).toBeTruthy();
    expect(new Date(appt!.start_time).getTime()).toBe(new Date(slotToBook.start).getTime());
  });

  // --------------------------------------------------------------------------
  // b. Microsoft Calendar Tenant: Graph API provider dispatch & booking
  // --------------------------------------------------------------------------
  test('Microsoft Calendar tenant correctly resolves provider, calls Graph API path, and writes appointment', async () => {
    const msStaffId = '30000000-0000-0000-0000-000000000099';
    await supabaseAdmin.from('staff').upsert({
      id: msStaffId,
      tenant_id: seedTenantId,
      name: 'Microsoft Colleague',
      email: 'ms.colleague@example.com',
      calendar_provider: 'microsoft',
      microsoft_calendar_id: 'primary',
      google_calendar_id: null,
      working_days: null,
    }, { onConflict: 'id' });

    const msStaff: StaffCalendarTarget = {
      id: msStaffId,
      name: 'Microsoft Colleague',
      calendar_provider: 'microsoft',
      microsoft_calendar_id: 'primary',
    };

    // 1. Verify provider resolver picks microsoft
    const provider = await resolveCalendarProvider(seedTenantId, msStaff);
    expect(provider).toBe('microsoft');

    // 2. Provider event creation returns microsoft provider
    const eventRes = await createEvent(seedTenantId, msStaff, {
      tenantId: seedTenantId,
      summary: '[StyleFlo] Microsoft Outlook Test Event',
      startTime: '2026-11-03T10:00:00.000Z',
      endTime: '2026-11-03T10:30:00.000Z',
      attendeeEmail: 'customer@outlook.com',
      calendarId: 'primary',
    });

    expect(eventRes.provider).toBe('microsoft');
    expect(eventRes.id).toBeTruthy();

    // 3. Verify bookMeeting handles staff with Microsoft calendar target
    const customerEmail = `styl182_ms_${Date.now()}@example.com`;
    const bookingResult = await bookMeeting(
      seedTenantId,
      msStaffId,
      seedServiceId,
      'MS Customer',
      customerEmail,
      '07700900002',
      '2026-11-03T11:00:00.000Z',
      '2026-11-03T11:30:00.000Z',
      'Europe/London'
    );

    expect(bookingResult).toContain('Successfully booked appointment');

    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('*')
      .eq('tenant_id', seedTenantId)
      .eq('customer_email', customerEmail)
      .maybeSingle();

    expect(appt).not.toBeNull();
    expect(appt?.customer_name).toBe('MS Customer');
  });

  // --------------------------------------------------------------------------
  // c. Busy slot verification: busy intervals are excluded from offered slots
  // --------------------------------------------------------------------------
  test('busy intervals are excluded from available slots and quick times tag', () => {
    const service = {
      id: seedServiceId,
      name: 'Haircut & Styling',
      durationMinutes: 30,
      bufferMinutes: 0,
    };

    // Mark 09:30 - 10:30 as busy on Monday 2026-11-02
    const busyIntervals = [{
      start: new Date('2026-11-02T09:30:00.000Z'),
      end: new Date('2026-11-02T10:30:00.000Z'),
    }];

    const busyMap = new Map();
    busyMap.set(testStaffId, busyIntervals);

    const allSlots = calculateAvailableSlots({
      staffList: [{
        id: testStaffId,
        name: 'Sarah Miller',
        schedule: {
          weeks: [{
            weekCommencingDate: '2026-11-02',
            monday: { unavailable: false, am: { start: '09:00', end: '12:00' }, pm: { start: '13:00', end: '17:00' } },
          }],
        },
      }],
      busyMap,
      service,
      startDateUtc: new Date('2026-11-02T00:00:00.000Z'),
      endDateUtc: new Date('2026-11-02T23:59:59.000Z'),
      timeZone: 'Europe/London',
      nowUtc: new Date('2026-11-01T00:00:00.000Z'),
    });

    const mondaySlots = getSlotsForDay(allSlots, '2026-11-02');
    const offeredTimes = mondaySlots.map((s) => s.time);

    // 09:00 should be offered
    expect(offeredTimes).toContain('09:00');
    // 09:30 and 10:00 should NOT be offered because of busy interval
    expect(offeredTimes).not.toContain('09:30');
    expect(offeredTimes).not.toContain('10:00');
    // 10:30 should be offered
    expect(offeredTimes).toContain('10:30');

    // Quick times tag should not contain 09:30
    const tag = formatQuickTimesTag('2026-11-02', service.id, mondaySlots);
    expect(tag).not.toContain('"time":"09:30"');
    expect(tag).toContain('"time":"09:00"');
  });

  // --------------------------------------------------------------------------
  // d. Race condition test: slot taken before user confirmation
  // --------------------------------------------------------------------------
  test('race condition: returns error and re-offers day remaining times if slot is taken', async ({ request }) => {
    const sessionTokenRes = await request.post('/api/chat/public-init', {
      headers: {
        'Content-Type': 'application/json',
        'x-turnstile-token': '1x0000000000000000000000000000000AA',
      },
      data: { chatbotId: seedBotId },
    });
    expect(sessionTokenRes.ok()).toBeTruthy();
    const { sessionToken, sessionId } = await sessionTokenRes.json();

    // First, book a slot to occupy it
    const clashSlotTime = '2026-11-04T14:00:00.000Z';
    const clashCustomerEmail = `styl182_clash_${Date.now()}@example.com`;

    await supabaseAdmin.from('appointments').insert({
      tenant_id: seedTenantId,
      staff_id: testStaffId,
      service_id: seedServiceId,
      customer_name: 'Existing Customer',
      customer_email: clashCustomerEmail,
      customer_phone: '07700900003',
      start_time: clashSlotTime,
      end_time: '2026-11-04T14:30:00.000Z',
      google_event_id: 'clash_evt_1',
    });

    // Now a new customer attempts to book that exact slot via select_slot action
    const secondCustEmail = `styl182_second_${Date.now()}@example.com`;
    const res = await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': sessionToken,
      },
      data: {
        chatbotId: seedBotId,
        sessionId,
        action: 'select_slot',
        start: clashSlotTime,
        staffId: testStaffId,
        serviceId: seedServiceId,
        clientName: 'Second Customer',
        clientEmail: secondCustEmail,
        clientPhone: '07700900004',
        message: '14:00',
      },
    });

    expect(res.ok()).toBeTruthy();
    const replyText = await res.text();

    // Verify polite apology and remaining times offered
    expect(replyText).toMatch(/sorry.*slot was just taken/i);
    expect(replyText).toContain('[QUICK_TIMES:');

    // Verify second customer did not get an appointment row
    const { data: secondAppt } = await supabaseAdmin
      .from('appointments')
      .select('id')
      .eq('tenant_id', seedTenantId)
      .eq('customer_email', secondCustEmail)
      .maybeSingle();

    expect(secondAppt).toBeNull();
  });

  // --------------------------------------------------------------------------
  // e. Double-tap / Idempotency test: clicking time twice produces only 1 record
  // --------------------------------------------------------------------------
  test('idempotency: booking same slot twice returns success and creates exactly 1 appointment', async () => {
    const slotTime = '2026-11-05T15:00:00.000Z';
    const customerEmail = `styl182_idempotent_${Date.now()}@example.com`;

    // First booking attempt
    const res1 = await bookMeeting(
      seedTenantId,
      testStaffId,
      seedServiceId,
      'Double Tap Customer',
      customerEmail,
      '07700900005',
      slotTime,
      '2026-11-05T15:30:00.000Z',
      'Europe/London'
    );
    expect(res1).toContain('Successfully booked appointment');

    // Second booking attempt (simulating double-click)
    const res2 = await bookMeeting(
      seedTenantId,
      testStaffId,
      seedServiceId,
      'Double Tap Customer',
      customerEmail,
      '07700900005',
      slotTime,
      '2026-11-05T15:30:00.000Z',
      'Europe/London'
    );
    expect(res2).toContain('Successfully booked appointment');

    // Verify only 1 appointment row exists for this slot & customer
    const { data: appts } = await supabaseAdmin
      .from('appointments')
      .select('id')
      .eq('tenant_id', seedTenantId)
      .eq('customer_email', customerEmail)
      .eq('start_time', slotTime);

    expect(appts).not.toBeNull();
    expect(appts?.length).toBe(1);
  });

  // --------------------------------------------------------------------------
  // f. Fallback test: no calendar or 0 services configured
  // --------------------------------------------------------------------------
  test('tenant with 0 services falls back to contact details without crashing or rendering quick links', async ({ request }) => {
    const sessionTokenRes = await request.post('/api/chat/public-init', {
      headers: {
        'Content-Type': 'application/json',
        'x-turnstile-token': '1x0000000000000000000000000000000AA',
      },
      data: {
        chatbotId: homepageBotId,
        termsAccepted: true,
        termsVersion: '1.0',
      },
    });
    expect(sessionTokenRes.ok()).toBeTruthy();
    const { sessionToken, sessionId } = await sessionTokenRes.json();

    const fallbackReply = "We don't have online booking configured right now. Please leave your name, email, and phone number, and our team will get in touch directly!";

    const res = await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': sessionToken,
      },
      data: {
        chatbotId: homepageBotId,
        sessionId,
        clientName: 'Sarah Connor',
        message: 'Can I book an appointment for tomorrow?',
        mockModelReply: fallbackReply,
      },
    });

    expect(res.ok()).toBeTruthy();
    const replyText = await res.text();

    expect(replyText).toContain(fallbackReply);
    expect(replyText).not.toContain('[QUICK_SERVICES:');
    expect(replyText).not.toContain('[QUICK_DAYS:');
    expect(replyText).not.toContain('[QUICK_TIMES:');
    expect(replyText).not.toContain('[TIME_SLOTS:');
  });

  // --------------------------------------------------------------------------
  // g. User-facing clean presentation & DB hygiene: markers NEVER visible
  // --------------------------------------------------------------------------
  test('markers [QUICK_SERVICES], [QUICK_DAYS], [QUICK_TIMES] are stripped from visible widget text and stored DB messages', async ({ page, request }) => {
    test.setTimeout(60000);
    await page.goto('/login');

    // 1. Mount widget
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
    const termsCheckbox = host.locator('#styleflo-disclaimer-accept');
    const startChatBtn = host.locator('#styleflo-onboarding-submit-btn');

    if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameInput.fill('Clean Presentation Tester');
      if (await termsCheckbox.isVisible()) {
        await termsCheckbox.check();
      }
      await startChatBtn.click();
    }

    const chatInput = host.locator('#styleflo-input');
    await expect(chatInput).toBeVisible({ timeout: 10000 });

    // 2. Mock model reply streaming with quick link tags
    const conversationalText = 'Here are our available services and days:';
    const quickServicesTag = formatQuickServicesTag([{
      id: seedServiceId,
      name: 'Haircut & Styling',
      duration_minutes: 30,
      price: 45,
    }]);
    const quickDaysTag = formatQuickDaysTag(seedServiceId, testStaffId, [
      { date: '2026-11-09', displayDate: 'Mon 9 Nov', slotsCount: 2 },
      { date: '2026-11-10', displayDate: 'Tue 10 Nov', slotsCount: 2 },
    ]);
    const quickTimesTag = formatQuickTimesTag('2026-11-09', seedServiceId, [
      {
        start: '2026-11-09T10:00:00+00:00',
        end: '2026-11-09T10:30:00+00:00',
        startUtc: new Date('2026-11-09T10:00:00.000Z'),
        endUtc: new Date('2026-11-09T10:30:00.000Z'),
        date: '2026-11-09',
        time: '10:00',
        displayDate: 'Mon 9 Nov',
        staffId: testStaffId,
        staffName: 'Sarah Miller',
        serviceId: seedServiceId,
      },
      {
        start: '2026-11-09T11:00:00+00:00',
        end: '2026-11-09T11:30:00+00:00',
        startUtc: new Date('2026-11-09T11:00:00.000Z'),
        endUtc: new Date('2026-11-09T11:30:00.000Z'),
        date: '2026-11-09',
        time: '11:00',
        displayDate: 'Mon 9 Nov',
        staffId: testStaffId,
        staffName: 'Sarah Miller',
        serviceId: seedServiceId,
      },
    ]);

    const fullBotPayload = `${conversationalText}\n\n${quickServicesTag}\n${quickDaysTag}\n${quickTimesTag}`;

    // Intercept chat stream route to return mock with tags
    await page.route('**/api/chat/stream', async (route) => {
      const responseBody = fullBotPayload;
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: responseBody,
      });
    });

    await chatInput.fill('I would like to book an appointment');
    const chatForm = host.locator('#styleflo-chat-form');
    await chatForm.evaluate((form: HTMLFormElement) => {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    // 3. Verify quick link buttons are rendered in the DOM
    const serviceBtn = host.locator('.styleflo-quick-service-btn').first();
    await expect(serviceBtn).toBeVisible({ timeout: 10000 });

    const dayBtn = host.locator('.styleflo-day-btn').first();
    await expect(dayBtn).toBeVisible({ timeout: 10000 });

    const timeBtn = host.locator('.styleflo-time-btn').first();
    await expect(timeBtn).toBeVisible({ timeout: 10000 });

    // 4. Verify tags are NEVER present in visible text bubble
    const messagesEl = host.locator('#styleflo-messages');
    const bubbleText = await messagesEl.innerText();

    expect(bubbleText).not.toContain('[QUICK_SERVICES:');
    expect(bubbleText).not.toContain('[QUICK_DAYS:');
    expect(bubbleText).not.toContain('[QUICK_TIMES:');
    expect(bubbleText).not.toContain('[TIME_SLOTS:');
    expect(bubbleText).toContain('Here are our available services and days:');

    // 5. Test button tap disables group to prevent double tap
    await timeBtn.click();
    await expect(timeBtn).toBeDisabled();

    // 6. Test direct API call storing message in DB has tags stripped
    const testSessionId = `test_strip_db_${Date.now()}`;
    const initRes = await request.post('/api/chat/public-init', {
      headers: {
        'Content-Type': 'application/json',
        'x-turnstile-token': '1x0000000000000000000000000000000AA',
      },
      data: { chatbotId: seedBotId, sessionId: testSessionId },
    });
    const { sessionToken, sessionId: initSessionId } = await initRes.json();

    await request.post('/api/chat/stream', {
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': sessionToken,
      },
      data: {
        chatbotId: seedBotId,
        sessionId: initSessionId || testSessionId,
        action: 'select_service',
        serviceId: seedServiceId,
        message: 'Haircut & Styling',
      },
    });

    // Verify stored DB message has no tags
    await expect.poll(async () => {
      const { data: conv } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('user_session_id', initSessionId)
        .maybeSingle();

      if (!conv?.id) return null;

      const { data: dbMessages } = await supabaseAdmin
        .from('messages')
        .select('sender_type, text_content')
        .eq('conversation_id', conv.id);

      const botMsg = dbMessages?.find((m) => m.sender_type === 'bot');
      return botMsg?.text_content || null;
    }, { timeout: 10000 }).not.toBeNull();

    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('user_session_id', initSessionId)
      .maybeSingle();

    const { data: dbMessages } = await supabaseAdmin
      .from('messages')
      .select('text_content')
      .eq('conversation_id', conv!.id);

    for (const msg of dbMessages || []) {
      expect(msg.text_content).not.toContain('[QUICK_SERVICES:');
      expect(msg.text_content).not.toContain('[QUICK_DAYS:');
      expect(msg.text_content).not.toContain('[QUICK_TIMES:');
      expect(msg.text_content).not.toContain('[TIME_SLOTS:');
    }
  });
});
