import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateVoiceGate,
  isPlaceholderVapiValue,
  isVoiceFlagEnabled,
  publicVoiceFields,
} from '../src/lib/env/vapi-config';
import { POST as assistantPost } from '../src/app/api/webhooks/vapi/assistant/route';
import { GET as chatbotGet } from '../src/app/api/chatbots/[id]/route';

const root = process.cwd();
const PROD_ASSISTANT = '1bb95940-1cb9-4c54-9b16-ba5bc11daae2';
const PROD_PUBLIC_KEY = '3648bdcb-ccac-4acc-aee6-a4f9384743de';

test.describe('STYL-226: voice switch and unsafe Vapi refuse', () => {
  test('VOICE_ENABLED is off by default and placeholders / production IDs refuse voice', () => {
    expect(isVoiceFlagEnabled({})).toBe(false);
    expect(evaluateVoiceGate({}).allowed).toBe(false);
    expect(evaluateVoiceGate({ VOICE_ENABLED: 'false' }).allowed).toBe(false);
    expect(isPlaceholderVapiValue('mock-vapi-key')).toBe(true);
    expect(isPlaceholderVapiValue('00000000-0000-0000-0000-0000000000va')).toBe(true);

    expect(
      evaluateVoiceGate({
        VOICE_ENABLED: 'true',
        VAPI_API_KEY: 'safe-test-vapi-private-key',
        NEXT_PUBLIC_VAPI_PUBLIC_KEY: PROD_PUBLIC_KEY,
        VAPI_MASTER_ASSISTANT_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }).allowed,
    ).toBe(false);

    expect(
      evaluateVoiceGate({
        VOICE_ENABLED: 'true',
        VAPI_API_KEY: 'safe-test-vapi-private-key',
        NEXT_PUBLIC_VAPI_PUBLIC_KEY: 'safe-test-vapi-public-key',
        VAPI_MASTER_ASSISTANT_ID: PROD_ASSISTANT,
      }).allowed,
    ).toBe(false);

    expect(
      evaluateVoiceGate({
        VOICE_ENABLED: 'true',
        VAPI_API_KEY: 'safe-test-vapi-private-key',
        NEXT_PUBLIC_VAPI_PUBLIC_KEY: 'safe-test-vapi-public-key',
        VAPI_MASTER_ASSISTANT_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }).allowed,
    ).toBe(true);
  });

  test('public chatbot config blanks Vapi keys while voice is gated', async () => {
    const previous = {
      VOICE_ENABLED: process.env.VOICE_ENABLED,
      NEXT_PUBLIC_VAPI_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY,
      VAPI_PUBLIC_KEY: process.env.VAPI_PUBLIC_KEY,
      VAPI_MASTER_ASSISTANT_ID: process.env.VAPI_MASTER_ASSISTANT_ID,
    };
    try {
      delete process.env.VOICE_ENABLED;
      process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY = 'safe-test-vapi-public-key';
      process.env.VAPI_MASTER_ASSISTANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const res = await chatbotGet(
        new Request('http://localhost:3001/api/chatbots/e0000000-0000-0000-0000-000000000001'),
        { params: Promise.resolve({ id: 'e0000000-0000-0000-0000-000000000001' }) },
      );
      const body = await res.json();
      expect(body.voiceRuntimeAllowed).toBe(false);
      expect(body.vapiPublicKey).toBe('');
      expect(body.vapiAssistantId).toBe('');
      expect(publicVoiceFields({ VOICE_ENABLED: '' }).voiceRuntimeAllowed).toBe(false);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('provision and assistant webhook refuse while voice is off', async ({ request }) => {
    const previous = process.env.VOICE_ENABLED;
    try {
      delete process.env.VOICE_ENABLED;
      const provision = await request.post('/api/telephony/provision', {
        data: { tenant_id: '10000000-0000-0000-0000-000000000002' },
      });
      expect([401, 403]).toContain(provision.status());

      const assistant = await assistantPost(
        new Request('http://localhost:3001/api/webhooks/vapi/assistant', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-vapi-secret': process.env.VAPI_WEBHOOK_SECRET || 'test-vapi-webhook-secret',
          },
          body: JSON.stringify({
            message: {
              type: 'assistant-request',
              call: { id: 'gate-call' },
            },
          }),
        }),
      );
      expect(assistant.status).toBe(200);
      const data = await assistant.json();
      expect((data.assistant || data.messageResponse?.assistant)?.firstMessage).toMatch(
        /voice is currently unavailable/i,
      );
    } finally {
      if (previous === undefined) delete process.env.VOICE_ENABLED;
      else process.env.VOICE_ENABLED = previous;
    }
  });

  test('widget source refuses a live start while voice is gated and has no production voice host fallback', () => {
    const widget = readFileSync(join(root, 'src/widget/index.ts'), 'utf8');
    const embed = readFileSync(join(root, 'src/widget/embed.ts'), 'utf8');
    for (const src of [widget, embed]) {
      expect(src).toContain('Voice is currently unavailable.');
      expect(src).toContain('voiceRuntimeAllowed');
      expect(src).not.toContain("isLocalHost ? 'https://app.styleflo.ai'");
    }
  });
});
