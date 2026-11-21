import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateVoiceGate,
  publicVoiceFields,
  shouldBlockKnownProductionVapiIds,
} from '../src/lib/env/vapi-config';
import { VOICE_ERROR_CODES } from '../src/lib/voice/voice-error-codes';
import { isKnownVoiceErrorCode, webCallFailureMessage } from '../src/lib/voice/voice-user-messages';
import { signChatSessionToken } from '../src/lib/chat-session';
import { POST as webCallPost } from '../src/app/api/voice/web-call/route';

const root = process.cwd();
const PROD_ASSISTANT = '1bb95940-1cb9-4c54-9b16-ba5bc11daae2';
const PROD_PUBLIC_KEY = '3648bdcb-ccac-4acc-aee6-a4f9384743de';
const CHATBOT_ID = 'e0000000-0000-0000-0000-000000000002';

test.describe('STYL-388: voice diagnostics codes', () => {
  test('evaluateVoiceGate returns stable codes for each failure mode', () => {
    const off = evaluateVoiceGate({});
    expect(off.allowed).toBe(false);
    if (!off.allowed) expect(off.code).toBe(VOICE_ERROR_CODES.VOICE_GATE_OFF);

    const placeholder = evaluateVoiceGate({
      VOICE_ENABLED: 'true',
      VAPI_API_KEY: 'mock-vapi-key',
      NEXT_PUBLIC_VAPI_PUBLIC_KEY: 'safe-test-vapi-public-key',
      VAPI_MASTER_ASSISTANT_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    expect(placeholder.allowed).toBe(false);
    if (!placeholder.allowed) expect(placeholder.code).toBe(VOICE_ERROR_CODES.VAPI_PLACEHOLDER);

    const blockedInStaging = evaluateVoiceGate({
      APP_ENV: 'staging',
      VOICE_ENABLED: 'true',
      VAPI_API_KEY: 'safe-test-vapi-private-key',
      NEXT_PUBLIC_VAPI_PUBLIC_KEY: PROD_PUBLIC_KEY,
      VAPI_MASTER_ASSISTANT_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    expect(blockedInStaging.allowed).toBe(false);
    if (!blockedInStaging.allowed) {
      expect(blockedInStaging.code).toBe(VOICE_ERROR_CODES.VAPI_PRODUCTION_ID_BLOCKED);
    }
  });

  test('known production Vapi IDs are allowed only in production', () => {
    expect(shouldBlockKnownProductionVapiIds({ APP_ENV: 'staging' })).toBe(true);
    expect(shouldBlockKnownProductionVapiIds({ APP_ENV: 'production' })).toBe(false);
    expect(shouldBlockKnownProductionVapiIds({ NODE_ENV: 'production' })).toBe(false);

    const allowedInProd = evaluateVoiceGate({
      NODE_ENV: 'production',
      VOICE_ENABLED: 'true',
      VAPI_API_KEY: 'safe-test-vapi-private-key',
      NEXT_PUBLIC_VAPI_PUBLIC_KEY: PROD_PUBLIC_KEY,
      VAPI_MASTER_ASSISTANT_ID: PROD_ASSISTANT,
    });
    expect(allowedInProd.allowed).toBe(true);
  });

  test('webCallFailureMessage keeps rate-limit and auth errors when code is absent or unknown', () => {
    expect(isKnownVoiceErrorCode('voice_gate_off')).toBe(true);
    expect(isKnownVoiceErrorCode('')).toBe(false);
    expect(isKnownVoiceErrorCode(undefined)).toBe(false);
    expect(isKnownVoiceErrorCode('too_many_requests')).toBe(false);

    expect(webCallFailureMessage(undefined, 'Too many voice call requests. Please try again shortly.')).toBe(
      'Too many voice call requests. Please try again shortly.',
    );
    expect(
      webCallFailureMessage(null, 'Unauthorized. Valid chat session or Turnstile verification is required.'),
    ).toBe('Unauthorized. Valid chat session or Turnstile verification is required.');
    expect(webCallFailureMessage(VOICE_ERROR_CODES.NO_PRIVATE_KEY, 'ignored')).toContain(
      'Voice is currently unavailable',
    );
  });

  test('publicVoiceFields exposes voiceUnavailableCode when gated', () => {
    const fields = publicVoiceFields({});
    expect(fields.voiceRuntimeAllowed).toBe(false);
    expect(fields.voiceUnavailableCode).toBe(VOICE_ERROR_CODES.VOICE_GATE_OFF);
  });

  test('web-call route returns distinct codes for configuration failures', async () => {
    const saved = {
      VOICE_ENABLED: process.env.VOICE_ENABLED,
      VAPI_WEBHOOK_SECRET: process.env.VAPI_WEBHOOK_SECRET,
      VAPI_PRIVATE_KEY: process.env.VAPI_PRIVATE_KEY,
      VAPI_API_KEY: process.env.VAPI_API_KEY,
      VAPI_PRIVATE_API_KEY: process.env.VAPI_PRIVATE_API_KEY,
      NEXT_PUBLIC_VAPI_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY,
      VAPI_MASTER_ASSISTANT_ID: process.env.VAPI_MASTER_ASSISTANT_ID,
    };
    const sessionId = `styl388-gate-${Date.now()}`;
    const sessionToken = signChatSessionToken({ chatbotId: CHATBOT_ID, sessionId, expiresInSeconds: 3600 });
    try {
      process.env.VOICE_ENABLED = 'true';
      process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY = 'safe-test-vapi-public-key';
      process.env.VAPI_MASTER_ASSISTANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      process.env.VAPI_WEBHOOK_SECRET = '';
      process.env.VAPI_PRIVATE_KEY = '';
      process.env.VAPI_API_KEY = '';
      process.env.VAPI_PRIVATE_API_KEY = '';

      const noSecret = await webCallPost(
        new Request('http://localhost:3001/api/voice/web-call', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-token': sessionToken,
            Origin: 'http://localhost:3001',
          },
          body: JSON.stringify({ chatbotId: CHATBOT_ID, sessionId, assistant: {} }),
        }),
      );
      const noSecretBody = await noSecret.json();
      expect(noSecret.status).toBe(503);
      expect(noSecretBody.code).toBe(VOICE_ERROR_CODES.NO_WEBHOOK_SECRET);

      process.env.VAPI_WEBHOOK_SECRET = 'test-vapi-webhook-secret';

      const noKey = await webCallPost(
        new Request('http://localhost:3001/api/voice/web-call', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-token': sessionToken,
            Origin: 'http://localhost:3001',
          },
          body: JSON.stringify({ chatbotId: CHATBOT_ID, sessionId, assistant: {} }),
        }),
      );
      const noKeyBody = await noKey.json();
      expect(noKey.status).toBe(503);
      expect(noKeyBody.code).toBe(VOICE_ERROR_CODES.NO_PRIVATE_KEY);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('server and widget source expose voice error codes without secrets', () => {
    const webCall = readFileSync(join(root, 'src/app/api/voice/web-call/route.ts'), 'utf8');
    expect(webCall).toContain('NO_WEBHOOK_SECRET');
    expect(webCall).toContain('NO_PRIVATE_KEY');
    expect(webCall).toContain('VAPI_401');

    for (const rel of ['src/widget/index.ts', 'src/widget/embed.ts']) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src).toContain('voiceUnavailableCode');
      expect(src).toContain('voiceUnavailableMessage');
      expect(src).toContain('webCallFailureMessage');
    }

    const baseHosting = readFileSync(join(root, 'apphosting.yaml'), 'utf8');
    expect(baseHosting).toContain('variable: VOICE_ENABLED');
  });
});