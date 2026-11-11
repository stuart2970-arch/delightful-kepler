import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { verifyVapiWebhookSecret } from '../src/lib/env/vapi-webhook-auth';

const root = process.cwd();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const vapiWebhookHeaders = {
  'x-vapi-secret': process.env.VAPI_WEBHOOK_SECRET || 'test-vapi-webhook-secret',
};

const TENANT_ID = '10000000-0000-0000-0000-000000000002';
const CHATBOT_ID = 'e0000000-0000-0000-0000-000000000002';
const BUSINESS_NUMBER = '+441624960111';
const CALLER_NUMBER = '+447700900123';
const RECORDING_URL = 'https://storage.vapi.ai/secret-audio-must-not-be-stored.wav';

test.describe('Vapi end-of-call reports are stored once and metered', () => {
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  test.beforeAll(async () => {
    const { error } = await admin
      .from('tenants')
      .update({ twilio_shadow_number: BUSINESS_NUMBER, has_landline: true })
      .eq('id', TENANT_ID);
    expect(error).toBeNull();
  });

  test('accepts Authorization Bearer when it matches VAPI_WEBHOOK_SECRET', () => {
    const result = verifyVapiWebhookSecret(
      new Request('http://localhost:3001/api/webhooks/vapi', {
        method: 'POST',
        headers: { authorization: 'Bearer styl-eoc-secret' },
      }),
      { VAPI_WEBHOOK_SECRET: 'styl-eoc-secret', APP_ENV: 'staging', NODE_ENV: 'production' },
    );
    expect(result.ok).toBe(true);
  });

  test('realistic end-of-call-report stores the artifact transcript, meters minutes, and ignores the recording', async ({ request }) => {
    const callId = `eoc-phone-${Date.now()}`;
    const transcript = 'AI: Hello. User: I would like a trim tomorrow.';

    const res = await request.post('/api/webhooks/vapi', {
      headers: vapiWebhookHeaders,
      data: {
        message: {
          type: 'end-of-call-report',
          startedAt: '2026-11-01T12:00:00.000Z',
          endedAt: '2026-11-01T12:01:30.000Z',
          phoneNumber: { number: BUSINESS_NUMBER },
          customer: { number: CALLER_NUMBER, name: 'Pat Caller' },
          artifact: {
            transcript,
            recordingUrl: RECORDING_URL,
          },
          call: {
            id: callId,
            type: 'inboundPhoneCall',
            assistantId: 'assistant-without-metadata',
            customer: { number: CALLER_NUMBER },
          },
        },
      },
    });
    expect(res.status()).toBe(200);

    const { data: conv, error } = await admin
      .from('conversations')
      .select('*')
      .eq('user_session_id', callId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(conv).toBeTruthy();
    expect(conv.tenant_id).toBe(TENANT_ID);
    expect(conv.channel).toBe('phone');
    expect(conv.caller_number).toBe(CALLER_NUMBER);
    expect(conv.transcript).toContain('trim tomorrow');
    expect(conv.recording_url).toBeNull();
    expect(JSON.stringify(conv)).not.toContain('secret-audio-must-not-be-stored');

    const { data: logs, error: logError } = await admin
      .from('usage_logs')
      .select('amount, feature_id, description')
      .eq('description', `Vapi call ${callId}`);
    expect(logError).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs?.[0]?.feature_id).toBe('vapi_voice_minutes');
    expect(Number(logs?.[0]?.amount)).toBe(2);

    const replay = await request.post('/api/webhooks/vapi', {
      headers: vapiWebhookHeaders,
      data: {
        message: {
          type: 'end-of-call-report',
          startedAt: '2026-11-01T12:00:00.000Z',
          endedAt: '2026-11-01T12:01:30.000Z',
          phoneNumber: { number: BUSINESS_NUMBER },
          artifact: { transcript, recordingUrl: RECORDING_URL },
          call: { id: callId, type: 'inboundPhoneCall', customer: { number: CALLER_NUMBER } },
        },
      },
    });
    expect(replay.status()).toBe(200);

    const { data: logsAfter } = await admin
      .from('usage_logs')
      .select('id')
      .eq('description', `Vapi call ${callId}`);
    expect(logsAfter).toHaveLength(1);

    const { data: convsAfter } = await admin
      .from('conversations')
      .select('id')
      .eq('user_session_id', callId);
    expect(convsAfter).toHaveLength(1);
  });

  test('web call transcript is taken from the artifact when call.transcript is absent', async ({ request }) => {
    const callId = `eoc-web-${Date.now()}`;
    const res = await request.post('/api/webhooks/vapi/assistant', {
      headers: vapiWebhookHeaders,
      data: {
        message: {
          type: 'end-of-call-report',
          startedAt: '2026-11-01T15:00:00.000Z',
          endedAt: '2026-11-01T15:01:00.000Z',
          artifact: {
            transcript: 'User: Speaking from the website.',
            recordingUrl: RECORDING_URL,
          },
          call: {
            id: callId,
            type: 'webCall',
            metadata: {
              tenant_id: TENANT_ID,
              chatbot_id: CHATBOT_ID,
              session_id: callId,
            },
          },
        },
      },
    });
    expect(res.status()).toBe(200);

    const { data: conv } = await admin
      .from('conversations')
      .select('channel, transcript, recording_url')
      .eq('user_session_id', callId)
      .maybeSingle();
    expect(conv?.channel).toBe('web_voice');
    expect(conv?.transcript).toContain('Speaking from the website');
    expect(conv?.recording_url).toBeNull();
  });

  test('widget asks the server to open the call and the assistant response sends the secret as a header', () => {
    for (const rel of ['src/widget/index.ts', 'src/widget/embed.ts']) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src).toContain('/api/voice/web-call');
      expect(src).toContain('reconnect');
      expect(src).toContain('recordingEnabled: false');
      expect(src).not.toContain('VAPI_WEBHOOK_SECRET');
      expect(src).not.toContain('server.secret');
      expect(src).not.toContain('serverUrl');
    }
    const assistant = readFileSync(join(root, 'src/app/api/webhooks/vapi/assistant/route.ts'), 'utf8');
    const server = readFileSync(join(root, 'src/lib/voice/vapi-server.ts'), 'utf8');
    expect(assistant).toContain('vapiEndOfCallServer');
    expect(assistant).toContain('recordingEnabled: false');
    expect(assistant).not.toContain('recordingUrl');
    expect(server).toContain('X-Vapi-Secret');
    expect(server).toContain('recordingEnabled: false');
    expect(server).toContain("'recordingUrl'");
    expect(server).toContain('DROPPED_ASSISTANT_KEYS');
  });

  test('resolves the tenant from the assistant id when the report has no metadata or phone number', async ({ request }) => {
    const callId = `eoc-assistant-${Date.now()}`;
    const assistantId = `asst-${callId}`;
    const { data: bot } = await admin
      .from('chatbots')
      .select('configuration_json')
      .eq('id', CHATBOT_ID)
      .single();
    const previous = (bot?.configuration_json || {}) as Record<string, unknown>;
    const { error: updateError } = await admin
      .from('chatbots')
      .update({ configuration_json: { ...previous, vapi_assistant_id: assistantId } })
      .eq('id', CHATBOT_ID);
    expect(updateError).toBeNull();

    try {
      const res = await request.post('/api/webhooks/vapi', {
        headers: vapiWebhookHeaders,
        data: {
          message: {
            type: 'end-of-call-report',
            startedAt: '2026-11-01T16:00:00.000Z',
            endedAt: '2026-11-01T16:00:30.000Z',
            artifact: { transcript: 'User: Booked via assistant id.', recordingUrl: RECORDING_URL },
            call: { id: callId, type: 'inboundPhoneCall', assistantId },
          },
        },
      });
      expect(res.status()).toBe(200);
      const { data: conv } = await admin
        .from('conversations')
        .select('tenant_id, transcript, recording_url')
        .eq('user_session_id', callId)
        .maybeSingle();
      expect(conv?.tenant_id).toBe(TENANT_ID);
      expect(conv?.transcript).toContain('Booked via assistant id');
      expect(conv?.recording_url).toBeNull();
    } finally {
      await admin.from('chatbots').update({ configuration_json: previous }).eq('id', CHATBOT_ID);
    }
  });
});
