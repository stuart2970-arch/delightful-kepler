import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { createTestNormalUser, type TestUserSession } from './test-auth-helper';
import {
  accessTokenNeedsRefresh,
  dashboardFetch,
  earliestExpiry,
  getDashboardAuthHeaders,
  getFreshAccessToken,
  readJwtExp,
  type DashboardAuthClient,
} from '@/lib/auth/dashboard-auth-headers';
import { config, proxy } from '../src/proxy';

/**
 * STYL-354: a signed-in owner was rejected on two dashboard saves.
 * Knowledge text posted with no Authorization header. The welcome-message
 * PATCH sent whatever getSession() had cached, and /api/chatbots never
 * refreshed the cookie because the proxy matcher skipped that path.
 */

const require = createRequire(__filename);
const { createChunks } = require('@supabase/ssr/dist/main/utils/chunker.js') as {
  createChunks: (key: string, value: string) => { name: string; value: string }[];
};
const { stringToBase64URL } = require('@supabase/ssr/dist/main/utils/base64url.js') as {
  stringToBase64URL: (value: string) => string;
};

const ACME = '10000000-0000-0000-0000-000000000001';
const ACME_BOT = 'e0000000-0000-0000-0000-000000000001';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function jwtWithExp(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ exp, sub: 'owner' })).toString('base64url');
  return `${header}.${body}.sig`;
}

function futureExp(seconds = 3600): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

function authClient(options: {
  session: { access_token: string; expires_at?: number | null } | null;
  refreshed?: { access_token: string; expires_at?: number | null } | null;
  refreshError?: string | null;
}): { client: DashboardAuthClient; refreshCount: () => number } {
  let refreshes = 0;
  const client: DashboardAuthClient = {
    auth: {
      async getSession() {
        return { data: { session: options.session }, error: null };
      },
      async refreshSession() {
        refreshes += 1;
        if (options.refreshError) {
          return { data: { session: null }, error: { message: options.refreshError } };
        }
        return { data: { session: options.refreshed ?? null }, error: null };
      },
    },
  };
  return { client, refreshCount: () => refreshes };
}

function proxyPatternMatches(pathname: string): boolean {
  const pattern = config.matcher[0];
  return new RegExp(`^${pattern}$`).test(pathname);
}

test.describe('STYL-354 fresh dashboard bearer', () => {
  test('a token that is still valid is sent and not refreshed', async () => {
    const token = jwtWithExp(futureExp());
    const { client, refreshCount } = authClient({
      session: { access_token: token, expires_at: futureExp() },
    });
    const headers = await getDashboardAuthHeaders({ 'Content-Type': 'application/json' }, client);
    expect(headers.Authorization).toBe(`Bearer ${token}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(refreshCount()).toBe(0);
  });

  test('an expired session is refreshed before the bearer is attached', async () => {
    const stale = jwtWithExp(futureExp(-7200));
    const fresh = jwtWithExp(futureExp());
    const { client, refreshCount } = authClient({
      session: { access_token: stale, expires_at: futureExp(-7200) },
      refreshed: { access_token: fresh, expires_at: futureExp() },
    });
    expect(await getFreshAccessToken(client, Math.floor(Date.now() / 1000))).toBe(fresh);
    expect(refreshCount()).toBe(1);
    const headers = await getDashboardAuthHeaders({}, client);
    expect(headers.Authorization).toBe(`Bearer ${fresh}`);
    expect(headers.Authorization).not.toContain(stale);
  });

  test('a session expiry that disagrees with the JWT exp is refreshed', async () => {
    const stale = jwtWithExp(futureExp(-30));
    const fresh = jwtWithExp(futureExp());
    const { client, refreshCount } = authClient({
      session: { access_token: stale, expires_at: futureExp(3600) },
      refreshed: { access_token: fresh, expires_at: futureExp() },
    });
    expect(earliestExpiry({ access_token: stale, expires_at: futureExp(3600) })).toBe(readJwtExp(stale));
    expect(accessTokenNeedsRefresh(readJwtExp(stale), Math.floor(Date.now() / 1000))).toBe(true);
    expect(await getFreshAccessToken(client)).toBe(fresh);
    expect(refreshCount()).toBe(1);
  });

  test('a failed refresh does not attach an already expired token', async () => {
    const stale = jwtWithExp(futureExp(-7200));
    const { client } = authClient({
      session: { access_token: stale, expires_at: futureExp(-7200) },
      refreshError: 'refresh token already used',
    });
    const headers = await getDashboardAuthHeaders({ 'Content-Type': 'application/json' }, client);
    expect(headers.Authorization).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('onAuthStateChange is called on the client so this stays bound', async () => {
    const token = jwtWithExp(futureExp());
    let restored = false;
    const client: DashboardAuthClient = {
      auth: {
        async getSession() {
          return {
            data: {
              session: restored ? { access_token: token, expires_at: futureExp() } : null,
            },
            error: null,
          };
        },
        async refreshSession() {
          return { data: { session: null }, error: { message: 'no refresh' } };
        },
        onAuthStateChange(callback) {
          if (this !== client.auth) {
            throw new TypeError('onAuthStateChange was called without its client');
          }
          restored = true;
          callback('INITIAL_SESSION', { access_token: token, expires_at: futureExp() });
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
    };
    const headers = await getDashboardAuthHeaders({}, client);
    expect(headers.Authorization).toBe(`Bearer ${token}`);
  });

  test('a synchronous INITIAL_SESSION does not throw before the timer exists', async () => {
    const token = jwtWithExp(futureExp());
    let restored = false;
    const client: DashboardAuthClient = {
      auth: {
        async getSession() {
          return {
            data: {
              session: restored ? { access_token: token, expires_at: futureExp() } : null,
            },
            error: null,
          };
        },
        async refreshSession() {
          return { data: { session: null }, error: { message: 'no refresh' } };
        },
        onAuthStateChange(callback) {
          restored = true;
          callback('INITIAL_SESSION', { access_token: token, expires_at: futureExp() });
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
    };
    const headers = await getDashboardAuthHeaders({}, client);
    expect(headers.Authorization).toBe(`Bearer ${token}`);
  });

  test('dashboardFetch waits until the browser session is restored before sending the bearer', async () => {
    const token = jwtWithExp(futureExp());
    let restored = false;
    const client: DashboardAuthClient = {
      auth: {
        async getSession() {
          return {
            data: {
              session: restored ? { access_token: token, expires_at: futureExp() } : null,
            },
            error: null,
          };
        },
        async refreshSession() {
          return { data: { session: null }, error: { message: 'no refresh' } };
        },
        onAuthStateChange(callback) {
          setTimeout(() => {
            restored = true;
            callback('INITIAL_SESSION', { access_token: token, expires_at: futureExp() });
          }, 30);
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
    };
    const headers = await getDashboardAuthHeaders({}, client);
    expect(headers.Authorization).toBe(`Bearer ${token}`);
  });

  test('dashboardFetch sends that bearer on the knowledge text request', async () => {
    const fresh = jwtWithExp(futureExp());
    const { client } = authClient({
      session: { access_token: jwtWithExp(futureExp(-7200)), expires_at: futureExp(-7200) },
      refreshed: { access_token: fresh, expires_at: futureExp() },
    });
    const original = globalThis.fetch;
    let seen: Record<string, string> | null = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;
    try {
      const response = await dashboardFetch('/api/ingest/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }, client);
      expect(response.status).toBe(200);
    } finally {
      globalThis.fetch = original;
    }
    expect(seen?.Authorization).toBe(`Bearer ${fresh}`);
    expect(seen?.['Content-Type']).toBe('application/json');
  });
});

test.describe('STYL-354 dashboard callers and chatbot cookie refresh', () => {
  test('an inbox poll aborts the previous request before the next one starts', () => {
    const root = path.resolve(__dirname, '..');
    const inbox = fs.readFileSync(path.join(root, 'src/components/dashboard-views/InboxView.tsx'), 'utf8');
    const fetchStart = inbox.indexOf('async function fetchMessages');
    const fetchBody = inbox.slice(fetchStart);
    expect(fetchStart).toBeGreaterThan(0);
    expect(fetchBody.indexOf('active.abort()')).toBeGreaterThan(-1);
    expect(fetchBody.indexOf('active.abort()')).toBeLessThan(fetchBody.indexOf('dashboardFetch'));
    expect(fetchBody).toContain('signal.aborted');
  });

  test('knowledge, agent, and ingest crawl callers use the shared helper', () => {
    const root = path.resolve(__dirname, '..');
    const knowledge = fs.readFileSync(path.join(root, 'src/components/dashboard-views/KnowledgeBaseView.tsx'), 'utf8');
    const agent = fs.readFileSync(path.join(root, 'src/components/dashboard-views/ChatbotManagerView.tsx'), 'utf8');
    const integrations = fs.readFileSync(path.join(root, 'src/components/dashboard-views/IntegrationsView.tsx'), 'utf8');
    const proxySource = fs.readFileSync(path.join(root, 'src/proxy.ts'), 'utf8');

    expect(knowledge).toContain("dashboardFetch");
    expect(knowledge).not.toMatch(/[^h]fetch\(\s*['"`]\/api\/ingest\//);
    expect(knowledge).not.toContain('new EventSource');
    expect(agent).not.toContain('supabase.auth.getSession');
    expect(agent).toContain('getDashboardAuthHeaders');
    expect(integrations).toContain("dashboardFetch('/api/ingest/crawl'");
    expect(proxySource).not.toContain('api/chatbots|');
    expect(proxySource).toContain("pathname.startsWith('/api/chatbots')");
  });

  test('the proxy matcher refreshes chatbot mutations and still skips public assets', () => {
    expect(proxyPatternMatches(`/api/chatbots/${ACME_BOT}`)).toBe(true);
    expect(proxyPatternMatches('/api/chatbots')).toBe(true);
    expect(proxyPatternMatches('/api/ingest/text')).toBe(true);
    expect(proxyPatternMatches('/api/track')).toBe(false);
    expect(proxyPatternMatches('/widget.js')).toBe(false);
    expect(proxyPatternMatches('/_next/static/chunk.js')).toBe(false);
  });

  test('a public chatbot read does not call Auth', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      return original(input, init);
    }) as typeof fetch;
    try {
      const response = await proxy(new NextRequest(`http://localhost:3001/api/chatbots/${ACME_BOT}`, {
        headers: { cookie: 'sb-127-auth-token=base64-stale' },
      }));
      expect(response.status).toBeLessThan(400);
      expect(response.headers.get('location')).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
    expect(calls.filter((url) => url.includes('/auth/v1/'))).toEqual([]);
  });
});

test.describe('STYL-354 signed-in owner saves', () => {
  let owner: TestUserSession;

  test.beforeAll(async () => {
    owner = await createTestNormalUser(ACME);
  });

  test.afterAll(async () => {
    if (owner) await owner.cleanup();
  });

  test('POST /api/ingest/text accepts a fresh bearer and still rejects a missing or bad one', async ({ request }) => {
    const body = {
      text: 'A signed-in salon owner can add a knowledge note from the dashboard.',
      sourceName: `STYL-354 ${Date.now()}`,
      chatbotId: ACME_BOT,
      dryRun: true,
    };

    const missing = await request.post('/api/ingest/text', { data: body });
    expect(missing.status()).toBe(401);
    expect((await missing.json()).error).toBe('Authentication required');

    const expired = await request.post('/api/ingest/text', {
      data: body,
      headers: { Authorization: `Bearer ${jwtWithExp(futureExp(-7200))}` },
    });
    expect(expired.status()).toBe(401);
    expect((await expired.json()).error).toBe('Authentication required');

    const saved = await request.post('/api/ingest/text', {
      data: body,
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(saved.status()).toBe(200);
    const payload = await saved.json();
    expect(payload.dryRun).toBe(true);
    expect(payload.wouldInsertCount).toBeGreaterThan(0);
  });

  test('PATCH /api/chatbots saves welcome_message for a fresh bearer and rejects a bad one', async ({ request }) => {
    const { data: before, error } = await admin
      .from('chatbots')
      .select('name, primary_color, configuration_json, voice_enabled')
      .eq('id', ACME_BOT)
      .single();
    expect(error).toBeNull();
    const welcome = `Welcome from the desk ${Date.now()}`;
    const nextConfig = { ...(before?.configuration_json || {}), welcome_message: welcome };
    const patchBody = {
      name: before?.name,
      primary_color: before?.primary_color,
      voice_enabled: before?.voice_enabled,
      configuration_json: nextConfig,
    };

    try {
      const missing = await request.patch(`/api/chatbots/${ACME_BOT}`, { data: patchBody });
      expect(missing.status()).toBe(401);
      expect((await missing.json()).error).toBe('Unauthorized');

      const expired = await request.patch(`/api/chatbots/${ACME_BOT}`, {
        data: patchBody,
        headers: { Authorization: `Bearer ${jwtWithExp(futureExp(-7200))}` },
      });
      expect(expired.status()).toBe(401);
      expect((await expired.json()).error).toBe('Unauthorized');

      const saved = await request.patch(`/api/chatbots/${ACME_BOT}`, {
        data: patchBody,
        headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' },
      });
      expect(saved.status()).toBe(200);
      const { data: row, error: readError } = await admin
        .from('chatbots')
        .select('configuration_json')
        .eq('id', ACME_BOT)
        .single();
      expect(readError).toBeNull();
      expect(row?.configuration_json?.welcome_message).toBe(welcome);
    } finally {
      await admin.from('chatbots').update({
        name: before?.name,
        primary_color: before?.primary_color,
        voice_enabled: before?.voice_enabled,
        configuration_json: before?.configuration_json,
      }).eq('id', ACME_BOT);
    }
  });

  test('PATCH /api/chatbots refreshes an expired cookie session without a bearer', async ({ request }) => {
    const anon = createClient(supabaseUrl, anonKey);
    const { data: login, error: loginError } = await anon.auth.signInWithPassword({
      email: owner.user.email,
      password: 'Password123!',
    });
    expect(loginError).toBeNull();
    const session = login.session;
    expect(session?.refresh_token).toBeTruthy();

    const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
    const stored = {
      access_token: session!.access_token,
      refresh_token: session!.refresh_token,
      expires_in: -120,
      expires_at: Math.floor(Date.now() / 1000) - 120,
      token_type: session!.token_type,
      user: session!.user,
    };
    const encoded = `base64-${stringToBase64URL(JSON.stringify(stored))}`;
    const chunks = createChunks(storageKey, encoded);
    const cookie = chunks.map((chunk) => `${chunk.name}=${chunk.value}`).join('; ');

    const { data: before } = await admin
      .from('chatbots')
      .select('name, primary_color, configuration_json, voice_enabled')
      .eq('id', ACME_BOT)
      .single();
    const welcome = `Cookie refresh ${Date.now()}`;
    try {
      const saved = await request.patch(`/api/chatbots/${ACME_BOT}`, {
        headers: { cookie, 'Content-Type': 'application/json' },
        data: {
          name: before?.name,
          primary_color: before?.primary_color,
          voice_enabled: before?.voice_enabled,
          configuration_json: { ...(before?.configuration_json || {}), welcome_message: welcome },
        },
      });
      expect(saved.status()).toBe(200);
      const setCookie = saved.headersArray()
        .filter((header) => header.name.toLowerCase() === 'set-cookie')
        .map((header) => header.value)
        .join('\n');
      expect(setCookie).toContain(storageKey);
      const { data: row } = await admin
        .from('chatbots')
        .select('configuration_json')
        .eq('id', ACME_BOT)
        .single();
      expect(row?.configuration_json?.welcome_message).toBe(welcome);
    } finally {
      await admin.from('chatbots').update({
        name: before?.name,
        primary_color: before?.primary_color,
        voice_enabled: before?.voice_enabled,
        configuration_json: before?.configuration_json,
      }).eq('id', ACME_BOT);
    }
  });
});

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill('Password123!');
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
}

test.describe('STYL-354 dashboard buttons send a fresh bearer', () => {
  let owner: TestUserSession;

  test.beforeAll(async () => {
    owner = await createTestNormalUser(ACME);
  });

  test.afterAll(async () => {
    if (owner) await owner.cleanup();
  });

  test('Add Text to Knowledge sends Authorization and not an expired token', async ({ page }) => {
    test.setTimeout(60_000);
    let authorization = '';
    await page.route('**/api/ingest/text', async (route) => {
      authorization = route.request().headers().authorization || '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, chunksCount: 1, message: 'Ingested 1 knowledge item from text.' }),
      });
    });

    await signIn(page, owner.user.email);
    await page.goto('/dashboard?tab=crawler');
    await expect(page.getByRole('heading', { name: 'Add Knowledge to Chatbot' })).toBeVisible({ timeout: 15000 });
    const select = page.locator('form select').first();
    await expect.poll(async () => select.locator('option').count()).toBeGreaterThan(1);
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.getByPlaceholder('e.g. Employee Handbook').fill('STYL-354 handbook');
    await page.getByPlaceholder('Paste your text content here...').fill(
      'Owners can save a knowledge note after the access token has been refreshed.',
    );
    await page.getByRole('button', { name: 'Add Text to Knowledge' }).click();
    await expect.poll(() => authorization).toMatch(/^Bearer\s+\S+/);
    const token = authorization.replace(/^Bearer\s+/, '');
    const exp = readJwtExp(token);
    expect(exp).not.toBeNull();
    expect(exp!).toBeGreaterThan(Math.floor(Date.now() / 1000) + 30);
  });

  test('Save Changes on the welcome message sends Authorization', async ({ page }) => {
    test.setTimeout(60_000);
    let authorization = '';
    let bodyWelcome = '';
    await page.route('**/api/chatbots/**', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      authorization = route.request().headers().authorization || '';
      const payload = route.request().postDataJSON() as { configuration_json?: { welcome_message?: string } };
      bodyWelcome = payload?.configuration_json?.welcome_message || '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, chatbot: { id: ACME_BOT } }),
      });
    });

    await signIn(page, owner.user.email);
    await page.goto('/dashboard?tab=chatbots');
    await page.getByRole('button', { name: 'Edit Agent' }).first().click();
    await page.getByRole('button', { name: /Persona/ }).click();
    const welcome = page.getByPlaceholder('Leave empty for default introduction');
    await welcome.fill('Hello from the refreshed session.');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect.poll(() => authorization).toMatch(/^Bearer\s+\S+/);
    expect(bodyWelcome).toBe('Hello from the refreshed session.');
    const exp = readJwtExp(authorization.replace(/^Bearer\s+/, ''));
    expect(exp).not.toBeNull();
    expect(exp!).toBeGreaterThan(Math.floor(Date.now() / 1000) + 30);
  });
});
