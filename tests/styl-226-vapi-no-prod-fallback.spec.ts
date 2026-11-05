import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GET } from '../src/app/api/chatbots/[id]/route';

const root = process.cwd();
const PROD_ASSISTANT = '1bb95940-1cb9-4c54-9b16-ba5bc11daae2';
const PROD_PUBLIC_KEY = '3648bdcb-ccac-4acc-aee6-a4f9384743de';

test.describe('STYL-226: Vapi has no production fallback', () => {
  test('chatbot and inbound routes do not contain production Vapi literals', () => {
    for (const rel of [
      'src/app/api/chatbots/[id]/route.ts',
      'src/app/api/telephony/inbound/route.ts',
      'src/widget/index.ts',
      'src/widget/embed.ts',
    ]) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).not.toContain(PROD_ASSISTANT);
      expect(src, rel).not.toContain(PROD_PUBLIC_KEY);
    }
  });

  test('GET /api/chatbots/e0000000-0000-0000-0000-000000000001 returns empty Vapi fields when env is cleared on staging', async () => {
    const previous = {
      APP_ENV: process.env.APP_ENV,
      NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
      NEXT_PUBLIC_VAPI_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY,
      VAPI_PUBLIC_KEY: process.env.VAPI_PUBLIC_KEY,
      VAPI_MASTER_ASSISTANT_ID: process.env.VAPI_MASTER_ASSISTANT_ID,
    };

    try {
      process.env.APP_ENV = 'staging';
      process.env.NEXT_PUBLIC_ENV = 'staging';
      delete process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
      delete process.env.VAPI_PUBLIC_KEY;
      delete process.env.VAPI_MASTER_ASSISTANT_ID;

      const req = new Request(
        'http://localhost:3001/api/chatbots/e0000000-0000-0000-0000-000000000001',
      );
      const res = await GET(req, {
        params: Promise.resolve({ id: 'e0000000-0000-0000-0000-000000000001' }),
      });
      const body = await res.json();
      expect(body.vapiPublicKey || '').toBe('');
      expect(body.vapiAssistantId || '').toBe('');
      expect(body.voiceEnabled === false || body.vapiPublicKey === '').toBeTruthy();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
