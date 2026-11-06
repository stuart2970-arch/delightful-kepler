import { test, expect } from '@playwright/test';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import Module from 'node:module';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { signChatSessionToken } from '../src/lib/chat-session';

// Playwright's loader does not rewrite @/ inside these route modules when the
// spec imports them directly. Map the alias onto src/ before the handlers load.
const moduleWithResolve = Module as unknown as {
  _resolveFilename: (request: string, parent: NodeModule | null | undefined, ...rest: unknown[]) => string;
};
const originalResolveFilename = moduleWithResolve._resolveFilename;
moduleWithResolve._resolveFilename = function resolveWithAlias(request, parent, ...rest) {
  if (typeof request === 'string' && request.startsWith('@/')) {
    const mapped = join(process.cwd(), 'src', request.slice(2));
    const candidates = [mapped, `${mapped}.ts`, `${mapped}.tsx`, `${mapped}.js`, join(mapped, 'index.ts')];
    const existing = candidates.find((candidate) => existsSync(candidate));
    if (existing) return originalResolveFilename.call(this, existing, parent, ...rest);
  }
  return originalResolveFilename.call(this, request, parent, ...rest);
};

/**
 * STYL-199: caller mock replies are honoured only when ALLOW_MOCK_REPLY is
 * explicitly true/1 and resolveAppEnv is not production. These tests drive
 * the real chat and voice handlers. Supabase is a local stub. Gemini is a
 * canned stream so nothing calls Google or writes a live booking.
 */

const root = process.cwd();
const TENANT = '10000000-0000-0000-0000-000000000099';
const BOT = 'e0000000-0000-0000-0000-000000000099';
const STAFF = '30000000-0000-0000-0000-000000000099';
const SERVICE = '40000000-0000-0000-0000-000000000099';
const GLOBAL_BOT = '00000000-0000-0000-0000-000000000000';
const MODEL_MARKER = 'STYL199_MODEL_MARKER_DO_NOT_SPEAK';
const PASS2_MARKER = 'STYL199_PASS2_MARKER_DO_NOT_SPEAK';
const CANNED = 'STYL199_CANNED_MODEL_TEXT';
const BOOK_EMAIL = 'styl199-guard-book@example.com';
const BOGUS_STAFF = 'styl199-no-staff';

const ENV_KEYS = [
  'APP_ENV',
  'NODE_ENV',
  'ALLOW_MOCK_REPLY',
  'PLAYWRIGHT_TEST',
  'GEMINI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_APP_URL',
] as const;

type SavedEnv = Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

let server: Server;
let baseUrl = '';
const hits: string[] = [];
const googleCalls: string[] = [];
let originalFetch: typeof fetch;

const botRow = {
  id: BOT,
  name: 'Guard Bot',
  tenant_id: TENANT,
  configuration_json: {},
};

const serviceRow = {
  id: SERVICE,
  name: 'Guard Cut',
  duration_minutes: 30,
  buffer_minutes: 0,
  price: 0,
  base_price: 0,
  description: 'Synthetic test service',
};

const staffRow = {
  id: STAFF,
  name: 'Guard Stylist',
  role: 'Stylist',
  tenant_id: TENANT,
  chatbot_id: BOT,
  calendar_provider: 'google',
  google_calendar_id: 'primary',
  working_days: null,
  email: 'guard-stylist@example.com',
};

const tenantRow = {
  id: TENANT,
  company_name: 'Guard Salon',
  rwg_business_name: 'Guard Salon',
  booking_mode: 'single_calendar',
  booking_url: '',
  timezone: 'Europe/London',
  currency: 'GBP',
  domain: '',
  max_advance_weeks: 12,
};

function eqParam(url: URL, key: string): string {
  const raw = url.searchParams.get(key);
  if (!raw) return '';
  return raw.startsWith('eq.') ? raw.slice(3) : raw;
}

function wantsObject(req: IncomingMessage): boolean {
  return (req.headers.accept || '').includes('application/vnd.pgrst.object');
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function handleSupabase(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', baseUrl);
  hits.push(`${req.method} ${url.pathname}${url.search}`);
  const table = url.pathname.replace(/^\/rest\/v1\//, '').replace(/^\//, '');
  const object = wantsObject(req);
  const id = eqParam(url, 'id');

  if (req.method === 'POST' && table.startsWith('rpc/')) {
    sendJson(res, 200, []);
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (table === 'chatbots') {
      if (object) {
        sendJson(res, 200, id === GLOBAL_BOT ? { id: GLOBAL_BOT, configuration_json: {} } : botRow);
        return;
      }
      sendJson(res, 200, [id === GLOBAL_BOT ? { id: GLOBAL_BOT, configuration_json: {} } : botRow]);
      return;
    }
    if (table === 'tenants') {
      sendJson(res, 200, object ? tenantRow : [tenantRow]);
      return;
    }
    if (table === 'services') {
      if (id && id !== SERVICE) {
        sendJson(res, object ? 406 : 200, object ? { code: 'PGRST116', message: '0 rows' } : []);
        return;
      }
      sendJson(res, 200, object ? serviceRow : [serviceRow]);
      return;
    }
    if (table === 'staff') {
      if (id && id !== STAFF) {
        sendJson(res, object ? 406 : 200, object ? { code: 'PGRST116', message: '0 rows' } : []);
        return;
      }
      sendJson(res, 200, object ? staffRow : [staffRow]);
      return;
    }
    sendJson(res, 200, object ? null : []);
    if (req.method === 'HEAD') res.end();
    return;
  }

  if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
    if (table === 'conversations') {
      const row = { id: 'conv-styl199', channel: 'web', caller_number: null };
      sendJson(res, 201, object ? row : [row]);
      return;
    }
    sendJson(res, 201, object ? { ok: true } : []);
    return;
  }

  sendJson(res, 200, []);
}

function geminiSse(text: string): string {
  const payload = {
    candidates: [
      {
        content: { role: 'model', parts: [{ text }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function installFetchStub() {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/i.test(url)) {
      googleCalls.push(url);
      if (/embedContent|:embed/i.test(url)) {
        return new Response(JSON.stringify({ embedding: { values: [0.01, 0.02, 0.03] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(geminiSse(CANNED), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

function snapshotEnv(): SavedEnv {
  const saved: SavedEnv = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved: SavedEnv) {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function applyBaseEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = baseUrl;
  process.env.SUPABASE_URL = baseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  process.env.SUPABASE_ANON_KEY = 'test-anon';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon';
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3001';
  process.env.GEMINI_API_KEY = 'mock-test-key';
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'mock-test-key';
  process.env.PLAYWRIGHT_TEST = 'true';
  process.env.APP_ENV = 'test';
  process.env.NODE_ENV = 'test';
  delete process.env.ALLOW_MOCK_REPLY;
}

function bookingReply(): string {
  return `${MODEL_MARKER} [BOOK_MEETING: ${BOGUS_STAFF}, styl199-no-service, Pat Example, ${BOOK_EMAIL}, 07000000000, 2026-12-01T10:00:00.000Z, 2026-12-01T10:30:00.000Z]`;
}

function availabilityReply(): string {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  return `${MODEL_MARKER} [CHECK_AVAILABILITY: ${STAFF}, ${SERVICE}, ${start}, ${end}]`;
}

function sawBookingSideEffect(): boolean {
  return hits.some((hit) => hit.includes(BOGUS_STAFF) || hit.includes(BOOK_EMAIL) || hit.includes(encodeURIComponent(BOOK_EMAIL)));
}

test.describe('STYL-199 mock reply guard', () => {
  test.beforeAll(async () => {
    server = createServer((req, res) => {
      try {
        handleSupabase(req, res);
      } catch (err) {
        sendJson(res, 500, { message: err instanceof Error ? err.message : String(err) });
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fake supabase failed to bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
    installFetchStub();
  });

  test.afterAll(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  test.beforeEach(() => {
    hits.length = 0;
    googleCalls.length = 0;
    applyBaseEnv();
  });

  test('isMockReplyAllowed is closed unless the flag is true or 1 and the app is not production', async () => {
    const { isMockReplyAllowed, resolveMockModelReply } = await import('../src/lib/env/allow-mock-reply');

    expect(isMockReplyAllowed({ APP_ENV: 'staging' })).toBe(false);
    expect(isMockReplyAllowed({ ALLOW_MOCK_REPLY: '', APP_ENV: 'staging' })).toBe(false);
    expect(isMockReplyAllowed({ ALLOW_MOCK_REPLY: 'false', APP_ENV: 'staging' })).toBe(false);
    expect(isMockReplyAllowed({ ALLOW_MOCK_REPLY: '0', APP_ENV: 'test' })).toBe(false);
    expect(isMockReplyAllowed({ ALLOW_MOCK_REPLY: 'yes', APP_ENV: 'development' })).toBe(false);
    expect(isMockReplyAllowed({ ALLOW_MOCK_REPLY: 'true', APP_ENV: 'production' })).toBe(false);
    expect(isMockReplyAllowed({ ALLOW_MOCK_REPLY: '1', APP_ENV: 'production' })).toBe(false);
    expect(isMockReplyAllowed({ ALLOW_MOCK_REPLY: 'true', NODE_ENV: 'production' })).toBe(false);
    expect(isMockReplyAllowed({ ALLOW_MOCK_REPLY: ' TRUE ', APP_ENV: 'staging' })).toBe(true);
    expect(isMockReplyAllowed({ ALLOW_MOCK_REPLY: '1', APP_ENV: 'staging' })).toBe(true);
    expect(isMockReplyAllowed({ ALLOW_MOCK_REPLY: 'true', APP_ENV: 'development' })).toBe(true);
    expect(isMockReplyAllowed({ ALLOW_MOCK_REPLY: 'true', APP_ENV: 'test' })).toBe(true);
    expect(isMockReplyAllowed({ ALLOW_MOCK_REPLY: 'true', APP_ENV: 'staging', NODE_ENV: 'production' })).toBe(true);

    expect(resolveMockModelReply(MODEL_MARKER, { APP_ENV: 'production', ALLOW_MOCK_REPLY: 'true' })).toBeUndefined();
    expect(resolveMockModelReply([MODEL_MARKER], { ALLOW_MOCK_REPLY: 'false', APP_ENV: 'test' })).toBeUndefined();
    expect(resolveMockModelReply(MODEL_MARKER, { ALLOW_MOCK_REPLY: 'true', APP_ENV: 'staging' })).toBe(MODEL_MARKER);
    expect(resolveMockModelReply([MODEL_MARKER, ' tail'], { ALLOW_MOCK_REPLY: '1', APP_ENV: 'development' })).toEqual([
      MODEL_MARKER,
      ' tail',
    ]);
    expect(resolveMockModelReply(42, { ALLOW_MOCK_REPLY: 'true', APP_ENV: 'test' })).toBeUndefined();
    expect(resolveMockModelReply(['ok', 1], { ALLOW_MOCK_REPLY: 'true', APP_ENV: 'test' })).toBeUndefined();
    expect(resolveMockModelReply('', { ALLOW_MOCK_REPLY: 'true', APP_ENV: 'test' })).toBeUndefined();
  });

  test('ALLOW_MOCK_REPLY is documented for tests and absent from App Hosting yaml', () => {
    const example = readFileSync(join(root, '.env.example'), 'utf8');
    expect(example).toContain('ALLOW_MOCK_REPLY=');
    expect(example.toLowerCase()).toContain('never set');
    expect(example.toLowerCase()).toMatch(/production/);

    const playwright = readFileSync(join(root, 'playwright.config.ts'), 'utf8');
    expect(playwright).toContain("ALLOW_MOCK_REPLY: 'true'");

    const writer = readFileSync(join(root, 'scripts/write-local-env.mjs'), 'utf8');
    const branchAt = writer.indexOf('if (playwright)');
    expect(branchAt).toBeGreaterThan(0);
    expect(writer.slice(0, branchAt)).not.toContain('ALLOW_MOCK_REPLY=true');
    expect(writer.slice(branchAt)).toContain('ALLOW_MOCK_REPLY=true');

    for (const rel of ['apphosting.yaml', 'apphosting.staging.yaml']) {
      expect(readFileSync(join(root, rel), 'utf8'), rel).not.toContain('ALLOW_MOCK_REPLY');
    }

    const legacy = readFileSync(join(root, 'src/app/api/voice/chat/completions/route.ts'), 'utf8');
    expect(legacy).not.toContain('mockModelReply');
    expect(legacy).not.toContain('mockPass2Reply');
    expect(legacy).not.toContain('x-mock-model-reply');
    expect(legacy).not.toContain('x-mock-pass2-reply');

    for (const rel of [
      'src/app/api/chat/stream/route.ts',
      'src/app/api/voice/[chatbotId]/chat/completions/route.ts',
    ]) {
      expect(readFileSync(join(root, rel), 'utf8'), rel).toContain('resolveMockModelReply');
    }
  });

  test('production-like chat ignores body, header, and pass2 mocks and does not book', async () => {
    const saved = snapshotEnv();
    try {
      applyBaseEnv();
      process.env.APP_ENV = 'production';
      delete process.env.ALLOW_MOCK_REPLY;

      const closed = await postChat({
        mockModelReply: availabilityReply(),
        mockPass2Reply: PASS2_MARKER,
      });
      expect(closed.status).toBe(200);
      expect(closed.text).not.toContain(MODEL_MARKER);
      expect(closed.text).not.toContain(PASS2_MARKER);
      expect(closed.text.toLowerCase()).not.toMatch(/allow_mock_reply|mock reply is not/);
      expect(sawBookingSideEffect()).toBe(false);
      expect(googleCalls.length).toBeGreaterThan(0);
      expect(closed.text).toContain(CANNED);

      hits.length = 0;
      googleCalls.length = 0;
      const headerOnly = await postChat({}, { 'x-mock-model-reply': bookingReply(), 'x-mock-pass2-reply': PASS2_MARKER });
      expect(headerOnly.status).toBe(200);
      expect(headerOnly.text).not.toContain(MODEL_MARKER);
      expect(headerOnly.text).not.toContain(PASS2_MARKER);
      expect(headerOnly.text).toContain(CANNED);
      expect(sawBookingSideEffect()).toBe(false);

      hits.length = 0;
      googleCalls.length = 0;
      delete process.env.APP_ENV;
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_MOCK_REPLY = 'true';
      const misconfigured = await postChat({ mockModelReply: bookingReply(), mockPass2Reply: PASS2_MARKER });
      expect(misconfigured.status).toBe(200);
      expect(misconfigured.text).not.toContain(MODEL_MARKER);
      expect(misconfigured.text).not.toContain(PASS2_MARKER);
      expect(sawBookingSideEffect()).toBe(false);
      expect(misconfigured.text).toContain(CANNED);
    } finally {
      restoreEnv(saved);
    }
  });

  test('flag on still lets chat mocks drive the synthetic stream', async () => {
    const saved = snapshotEnv();
    try {
      applyBaseEnv();
      process.env.APP_ENV = 'test';
      process.env.ALLOW_MOCK_REPLY = 'true';

      const plain = await postChat({ mockModelReply: [MODEL_MARKER, ' kept'] });
      expect(plain.status).toBe(200);
      expect(plain.text).toContain(MODEL_MARKER);
      expect(plain.text).toContain('kept');
      expect(googleCalls.length).toBe(0);

      googleCalls.length = 0;
      hits.length = 0;
      const pass2 = await postChat({
        mockModelReply: availabilityReply(),
        mockPass2Reply: PASS2_MARKER,
      });
      expect(pass2.status).toBe(200);
      expect(pass2.text).toContain(MODEL_MARKER);
      expect(pass2.text).toContain(PASS2_MARKER);
      expect(pass2.text).not.toContain('[CHECK_AVAILABILITY');
      expect(googleCalls.length).toBe(0);
    } finally {
      restoreEnv(saved);
    }
  });

  test('production-like voice ignores body, headers, and call mirrors', async () => {
    const saved = snapshotEnv();
    try {
      applyBaseEnv();
      process.env.APP_ENV = 'production';
      delete process.env.ALLOW_MOCK_REPLY;

      const body = await postVoice({
        mockModelReply: bookingReply(),
        mockPass2Reply: PASS2_MARKER,
      });
      expect(body.status).toBe(200);
      expect(body.text).not.toContain(MODEL_MARKER);
      expect(body.text).not.toContain(PASS2_MARKER);
      expect(body.text.toLowerCase()).not.toMatch(/allow_mock_reply|mock reply is not/);
      expect(sawBookingSideEffect()).toBe(false);
      expect(body.text).toContain('Hello! How can I help you today?');

      hits.length = 0;
      const headers = await postVoice({}, {
        'x-mock-model-reply': bookingReply(),
        'x-mock-pass2-reply': PASS2_MARKER,
      });
      expect(headers.status).toBe(200);
      expect(headers.text).not.toContain(MODEL_MARKER);
      expect(headers.text).not.toContain(PASS2_MARKER);
      expect(sawBookingSideEffect()).toBe(false);

      hits.length = 0;
      const callMirror = await postVoice({
        call: {
          id: `call_${Date.now()}`,
          mockModelReply: bookingReply(),
          mockPass2Reply: PASS2_MARKER,
        },
      });
      expect(callMirror.status).toBe(200);
      expect(callMirror.text).not.toContain(MODEL_MARKER);
      expect(callMirror.text).not.toContain(PASS2_MARKER);
      expect(sawBookingSideEffect()).toBe(false);

      hits.length = 0;
      googleCalls.length = 0;
      delete process.env.PLAYWRIGHT_TEST;
      process.env.GEMINI_API_KEY = 'not-a-mock-key-styl199';
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'not-a-mock-key-styl199';
      process.env.ALLOW_MOCK_REPLY = 'false';
      const modelPath = await postVoice({
        mockModelReply: bookingReply(),
        mockPass2Reply: PASS2_MARKER,
      });
      expect(modelPath.status).toBe(200);
      expect(modelPath.text).not.toContain(MODEL_MARKER);
      expect(modelPath.text).not.toContain(PASS2_MARKER);
      expect(modelPath.text).toContain(CANNED);
      expect(googleCalls.length).toBeGreaterThan(0);
      expect(sawBookingSideEffect()).toBe(false);
    } finally {
      restoreEnv(saved);
    }
  });

  test('flag on still lets voice mocks drive the synthetic stream', async () => {
    const saved = snapshotEnv();
    try {
      applyBaseEnv();
      process.env.APP_ENV = 'staging';
      process.env.ALLOW_MOCK_REPLY = '1';

      const spoken = await postVoice({
        mockModelReply: bookingReply(),
        mockPass2Reply: PASS2_MARKER,
      });
      expect(spoken.status).toBe(200);
      expect(spoken.text).toContain(MODEL_MARKER);
      expect(spoken.text).toContain(PASS2_MARKER);
      expect(spoken.text).not.toContain('[BOOK_MEETING');
      expect(googleCalls.length).toBe(0);

      googleCalls.length = 0;
      const fromCall = await postVoice({
        call: { id: `call_honour_${Date.now()}`, mockModelReply: MODEL_MARKER },
      });
      expect(fromCall.text).toContain(MODEL_MARKER);
      expect(googleCalls.length).toBe(0);
    } finally {
      restoreEnv(saved);
    }
  });
});

async function postChat(
  extra: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  const { POST } = await import('../src/app/api/chat/stream/route');
  const sessionId = `styl199_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const token = signChatSessionToken({ chatbotId: BOT, sessionId, termsAccepted: true, termsVersion: '1.0' });
  const req = new NextRequest('http://localhost:3001/api/chat/stream', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-session-token': token,
      ...headers,
    },
    body: JSON.stringify({
      message: 'I would like to book a haircut next week',
      chatbotId: BOT,
      sessionId,
      ...extra,
    }),
  });
  const res = await POST(req);
  return { status: res.status, text: await res.text() };
}

async function postVoice(
  extra: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  const { POST } = await import('../src/app/api/voice/[chatbotId]/chat/completions/route');
  const req = new NextRequest(`http://localhost:3001/api/voice/${BOT}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      stream: true,
      messages: [{ role: 'user', content: 'I would like to book a haircut next week' }],
      ...extra,
    }),
  });
  const res = await POST(req, { params: Promise.resolve({ chatbotId: BOT }) });
  return { status: res.status, text: await res.text() };
}
