import { test, expect, type APIRequestContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  DEFAULT_GEMINI_MODEL,
  normalizeGeminiModelId,
  invalidateGeminiModelCache,
  getActiveGeminiModel,
} from '../../src/lib/gemini-config';
import {
  assistantChatReplyCreatedAtIso,
  inboundChatUserCreatedAtIso,
  persistInboundUserMessage,
} from '../../src/lib/chat/persist-inbound-user-message';

dotenv.config({ path: path.resolve(__dirname, '../../.env.test'), override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const seedBotId = 'e0000000-0000-0000-0000-000000000001';
const globalBotId = '00000000-0000-0000-0000-000000000000';

async function startChatSession(request: APIRequestContext) {
  const res = await request.post('/api/chat/public-init', {
    headers: {
      'Content-Type': 'application/json',
      'x-turnstile-token': '1x0000000000000000000000000000000AA',
    },
    data: { chatbotId: seedBotId, termsAccepted: true, termsVersion: '1.0' },
  });
  expect(res.ok()).toBeTruthy();
  return res.json() as Promise<{ sessionToken: string; sessionId: string; conversationId?: string }>;
}

test.describe('STYL-425 Gemini model fallback', () => {
  test('normalizeGeminiModelId maps retired flash-lite and legacy flash IDs', () => {
    expect(normalizeGeminiModelId('gemini-2.5-flash-lite')).toBe(DEFAULT_GEMINI_MODEL);
    expect(normalizeGeminiModelId('models/gemini-2.5-flash-lite')).toBe(DEFAULT_GEMINI_MODEL);
    expect(normalizeGeminiModelId('custom-vendor-flash-lite')).toBe(DEFAULT_GEMINI_MODEL);
    expect(normalizeGeminiModelId('gemini-2.5-flash')).toBe(DEFAULT_GEMINI_MODEL);
    expect(normalizeGeminiModelId('gemini-3.6-flash')).toBe('gemini-3.6-flash');
    expect(normalizeGeminiModelId('gemini-flash-latest')).toBe('gemini-flash-latest');
  });

  test('getActiveGeminiModel remaps stale superadmin default_gemini_model rows', async () => {
    const { data: before } = await supabaseAdmin
      .from('chatbots')
      .select('configuration_json')
      .eq('id', globalBotId)
      .maybeSingle();

    const priorConfig =
      before?.configuration_json && typeof before.configuration_json === 'object'
        ? { ...before.configuration_json }
        : {};

    await supabaseAdmin
      .from('chatbots')
      .update({
        configuration_json: {
          ...priorConfig,
          default_gemini_model: 'gemini-2.5-flash-lite',
        },
      })
      .eq('id', globalBotId);

    invalidateGeminiModelCache();
    const resolved = await getActiveGeminiModel();
    expect(resolved).toBe(DEFAULT_GEMINI_MODEL);

    await supabaseAdmin
      .from('chatbots')
      .update({ configuration_json: priorConfig })
      .eq('id', globalBotId);
    invalidateGeminiModelCache();
  });
});

test.describe('STYL-425 inbound user message persistence', () => {
  test('persistInboundUserMessage skips nil conversation id', async () => {
    const ok = await persistInboundUserMessage({
      supabaseAdmin,
      tenantId: '10000000-0000-0000-0000-000000000001',
      conversationId: '00000000-0000-0000-0000-000000000000',
      message: 'Hello',
    });
    expect(ok).toBe(false);
  });

  test('chat stream route persists inbound user message before streamText', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../../src/app/api/chat/stream/route.ts'),
      'utf8',
    );
    const persistAt = src.indexOf('persistInboundUserMessage');
    const streamAt = src.indexOf('await streamText');
    expect(persistAt).toBeGreaterThan(-1);
    expect(streamAt).toBeGreaterThan(persistAt);
    expect(src).toContain('if (!inboundUserMessagePersisted)');
    expect(src).toContain('inboundChatUserCreatedAtIso');
    expect(src).toContain('assistantChatReplyCreatedAtIso');
    expect(src).not.toContain('Date.now() - 1000');
  });

  test('message created_at helpers keep user after prior assistant and bot after user', () => {
    const priorAssistantMs = 1_700_000_000_000;
    const quickFollowUpUserMs = priorAssistantMs + 500;
    const userIso = inboundChatUserCreatedAtIso(quickFollowUpUserMs);
    expect(Date.parse(userIso)).toBeGreaterThan(priorAssistantMs);

    const userMs = quickFollowUpUserMs;
    const botIsoSameMs = assistantChatReplyCreatedAtIso(userMs, userMs);
    expect(Date.parse(botIsoSameMs)).toBe(userMs + 1);

    const laterStreamEndMs = userMs + 400;
    const botIso = assistantChatReplyCreatedAtIso(userMs, laterStreamEndMs);
    expect(Date.parse(botIso)).toBe(laterStreamEndMs);
    expect(Date.parse(botIso)).toBeGreaterThan(userMs);
  });

  test('empty mock stream still stores exactly one inbound user message', async ({ request }) => {
    const unique = `styl425_empty_${Date.now()}`;
    const { sessionToken, sessionId } = await startChatSession(request);

    const res = await request.post('/api/chat/stream', {
      headers: { 'Content-Type': 'application/json', 'x-session-token': sessionToken },
      data: {
        chatbotId: seedBotId,
        sessionId,
        message: unique,
        mockModelReply: [''],
      },
    });
    expect(res.ok()).toBeTruthy();

    const convRes = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('user_session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const conversationId = convRes.data?.id;
    expect(conversationId).toBeTruthy();

    const { data: rows, error } = await supabaseAdmin
      .from('messages')
      .select('id, sender_type, text_content')
      .eq('conversation_id', conversationId!)
      .eq('sender_type', 'user')
      .eq('text_content', unique);
    expect(error).toBeNull();
    expect(rows?.length).toBe(1);
  });
});