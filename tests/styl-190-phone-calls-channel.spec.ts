import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestNormalUser, TestUserSession } from './test-auth-helper';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test.describe('STYL-190: Phone calls channel, caller number, stop storing recordings and remove recording wording', () => {
  let userSession: TestUserSession;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const testTenantId = '10000000-0000-0000-0000-000000000002';
  let testChatbotId = '';

  test.beforeAll(async () => {
    userSession = await createTestNormalUser(testTenantId);

    // Ensure tenant has phone channel unlocked
    await adminClient
      .from('tenants')
      .update({
        has_landline: true,
        twilio_shadow_number: '+441234567890',
      })
      .eq('id', testTenantId);

    // Ensure tenant has an active chatbot
    const { data: bot } = await adminClient
      .from('chatbots')
      .select('id')
      .eq('tenant_id', testTenantId)
      .limit(1)
      .maybeSingle();

    if (bot) {
      testChatbotId = bot.id;
    } else {
      const { data: newBot } = await adminClient
        .from('chatbots')
        .insert({
          tenant_id: testTenantId,
          name: 'STYL-190 Receptionist',
          primary_color: '#4f46e5',
          configuration_json: {
            welcome_message: 'Hello, welcome to our salon!',
            agent_name: 'Flo',
          },
        })
        .select('id')
        .single();
      testChatbotId = newBot!.id;
    }
  });

  test.afterAll(async () => {
    if (userSession) await userSession.cleanup();
  });

  test('1. Mocked Vapi end-of-call-report (inboundPhoneCall) sets channel=phone, caller_number, and recording_url=null', async ({ request }) => {
    const callId = `test-phone-call-${Date.now()}`;
    const callerNumber = `+447123${Math.floor(100000 + Math.random() * 900000)}`;

    const vapiPayload = {
      message: {
        type: 'end-of-call-report',
        call: {
          id: callId,
          type: 'inboundPhoneCall',
          customer: {
            number: callerNumber,
            name: 'Jane Caller',
          },
          phoneNumber: {
            number: '+441234567890',
          },
          duration: 120,
          transcript: 'User: Hello, I want to book an appointment.\nBot: Certainly!',
          recordingUrl: 'https://vapi.ai/recordings/dummy-audio-should-not-be-stored.mp3',
          metadata: {
            tenant_id: testTenantId,
            chatbot_id: testChatbotId,
            session_id: callId,
          },
        },
      },
    };

    const res = await request.post('/api/webhooks/vapi', {
      data: vapiPayload,
    });
    expect(res.status()).toBe(200);

    // Verify row in database
    const { data: conv, error } = await adminClient
      .from('conversations')
      .select('*')
      .eq('user_session_id', callId)
      .maybeSingle();

    expect(error).toBeNull();
    expect(conv).toBeTruthy();
    expect(conv.channel).toBe('phone');
    expect(conv.caller_number).toBe(callerNumber);
    expect(conv.recording_url).toBeNull();
  });

  test('2. Mocked Vapi end-of-call-report (webCall) sets channel=web_voice and recording_url=null', async ({ request }) => {
    const callId = `test-web-voice-${Date.now()}`;

    const vapiPayload = {
      message: {
        type: 'end-of-call-report',
        call: {
          id: callId,
          type: 'webCall',
          duration: 60,
          transcript: 'User: Speaking to web voice.\nBot: Hi there!',
          recordingUrl: 'https://vapi.ai/recordings/dummy-web-audio.mp3',
          metadata: {
            tenant_id: testTenantId,
            chatbot_id: testChatbotId,
            session_id: callId,
          },
        },
      },
    };

    const res = await request.post('/api/webhooks/vapi', {
      data: vapiPayload,
    });
    expect(res.status()).toBe(200);

    const { data: conv, error } = await adminClient
      .from('conversations')
      .select('*')
      .eq('user_session_id', callId)
      .maybeSingle();

    expect(error).toBeNull();
    expect(conv).toBeTruthy();
    expect(conv.channel).toBe('web_voice');
    expect(conv.recording_url).toBeNull();
  });

  test('3. Assistant webhook returns server.url pointing to /api/webhooks/vapi and artifactPlan.recordingEnabled=false', async ({ request }) => {
    const res = await request.post('/api/webhooks/vapi/assistant', {
      data: {
        message: {
          type: 'assistant-request',
          phoneNumber: { number: '+441234567890' },
          call: { id: `call-${Date.now()}` },
        },
      },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    const assistant = data.assistant || data.messageResponse?.assistant;
    expect(assistant).toBeTruthy();

    // Check server.url or serverUrl
    const serverUrl = assistant.server?.url || assistant.serverUrl;
    expect(serverUrl).toContain('/api/webhooks/vapi');

    // Check recordingEnabled is false
    expect(assistant.artifactPlan?.recordingEnabled).toBe(false);
  });

  test('4. Assistant webhook forwards or processes end-of-call-report', async ({ request }) => {
    const callId = `test-assistant-fwd-${Date.now()}`;
    const callerNumber = `+447999${Math.floor(100000 + Math.random() * 900000)}`;

    const res = await request.post('/api/webhooks/vapi/assistant', {
      data: {
        message: {
          type: 'end-of-call-report',
          call: {
            id: callId,
            type: 'inboundPhoneCall',
            customer: { number: callerNumber },
            phoneNumber: { number: '+441234567890' },
            duration: 45,
            transcript: 'User: Booking test via assistant hook.',
            recordingUrl: 'https://vapi.ai/recordings/fwd-rec.mp3',
            metadata: {
              tenant_id: testTenantId,
              chatbot_id: testChatbotId,
              session_id: callId,
            },
          },
        },
      },
    });
    expect(res.status()).toBe(200);

    const { data: conv } = await adminClient
      .from('conversations')
      .select('*')
      .eq('user_session_id', callId)
      .maybeSingle();

    expect(conv).toBeTruthy();
    expect(conv.channel).toBe('phone');
    expect(conv.caller_number).toBe(callerNumber);
    expect(conv.recording_url).toBeNull();
  });

  test('5. Voice completions endpoint logs channel=phone and caller_number for phone calls', async ({ request }) => {
    const sessionId = `phone-compl-${Date.now()}`;
    const callerNumber = `+447888${Math.floor(100000 + Math.random() * 900000)}`;

    const res = await request.post(`/api/voice/${testChatbotId}/chat/completions`, {
      data: {
        sessionId,
        call: {
          id: sessionId,
          type: 'inboundPhoneCall',
          customer: { number: callerNumber },
        },
        messages: [{ role: 'user', content: 'Hello there' }],
      },
    });
    expect(res.status()).toBe(200);
    // Fully consume the stream to let logging trigger
    await res.text();

    // Give asynchronous stream logging a second to complete
    await new Promise((r) => setTimeout(r, 2000));

    const { data: conv } = await adminClient
      .from('conversations')
      .select('*')
      .eq('user_session_id', sessionId)
      .maybeSingle();

    expect(conv).toBeTruthy();
    expect(conv.channel).toBe('phone');
    expect(conv.caller_number).toBe(callerNumber);
    expect(conv.recording_url).toBeNull();
  });

  test('6. Dashboard UI renders Phone Calls separately from Web Chat & Voice without recording wording or audio players', async ({ page }) => {
    // Seed two clear conversations for UI inspection with unique phone number
    const uniqueCaller = `+447700${Math.floor(100000 + Math.random() * 900000)}`;
    const phoneSessionId = `ui-phone-${Date.now()}`;
    const webSessionId = `ui-web-${Date.now()}`;

    await adminClient.from('conversations').insert([
      {
        tenant_id: testTenantId,
        chatbot_id: testChatbotId,
        user_session_id: phoneSessionId,
        channel: 'phone',
        caller_number: uniqueCaller,
        is_voice_call: true,
        transcript: 'Customer phone transcript content',
      },
      {
        tenant_id: testTenantId,
        chatbot_id: testChatbotId,
        user_session_id: webSessionId,
        channel: 'web_voice',
        is_voice_call: true,
        transcript: 'Web voice transcript content',
      },
    ]);

    // Login as user
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(userSession.user.email);
    await page.locator('input[type="password"]').fill('Password123!');
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // Navigate to Phone Calls tab
    const phoneNav = page.locator('button', { hasText: /Phone Calls/i });
    await expect(phoneNav).toBeVisible();
    await phoneNav.click();

    // Check Phone Calls view
    // Wording assertions
    await expect(page.getByRole('heading', { name: 'Call Transcript' })).toBeVisible();
    await expect(page.locator('text=Call Recording & Transcript')).toHaveCount(0);
    await expect(page.locator('text=audio recording')).toHaveCount(0);
    await expect(page.locator('text=Voice Recording')).toHaveCount(0);
    await expect(page.locator('audio')).toHaveCount(0);

    // Prompt assertion before selecting a call
    await expect(page.getByText('Select a call to read its transcript.')).toBeVisible();

    // Verify phone session is listed in Phone Calls
    await expect(page.getByText(uniqueCaller)).toBeVisible();
    // Verify web voice session is NOT listed in Phone Calls
    await expect(page.getByText(webSessionId)).toHaveCount(0);

    // Click phone session to inspect details
    await page.getByText(uniqueCaller).click();
    await expect(page.getByText('Customer phone transcript content')).toBeVisible();
    await expect(page.locator('audio')).toHaveCount(0);

    // Navigate to Web Chat & Voice tab
    const webNav = page.locator('button', { hasText: /Web Chat & Voice/i });
    await expect(webNav).toBeVisible();
    await webNav.click();

    // Check Web Chat & Voice view
    await expect(page.getByRole('heading', { name: 'Transcript Viewer' })).toBeVisible();
    await expect(page.locator('text=Transcript & Audio Viewer')).toHaveCount(0);
    await expect(page.locator('text=Web Voice Recording')).toHaveCount(0);
    await expect(page.locator('audio')).toHaveCount(0);

    // Verify phone session is NOT in web conversations list
    await expect(page.getByText(uniqueCaller)).toHaveCount(0);
  });

  test('7. Empty state copy in TelephonyView matches British English specification', async () => {
    // Check empty state copy directly in TelephonyView source code
    const fs = await import('node:fs');
    const path = await import('node:path');
    const telephonyCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dashboard-views/TelephonyView.tsx'), 'utf-8');

    expect(telephonyCode).toContain("Calls to your dedicated number will appear here with their transcripts. StyleFlo doesn't keep call audio; only the transcript is saved.");
    expect(telephonyCode).toContain('Select a call to read its transcript.');
    expect(telephonyCode).not.toContain('with full audio recordings and transcripts');
    expect(telephonyCode).not.toContain('listen to the audio recording');
  });
});
