import { test, expect, type APIResponse } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * STYL-228: requesting a magic link must not mint a session, return a link
 * or token, or create a confirmed account. Sign-in happens only after the
 * recipient opens the emailed link.
 */

const TURNSTILE = '1x0000000000000000000000000000000AA';
const APP_ORIGIN = 'http://localhost:3001';
const MAILBOX = 'http://127.0.0.1:54324';

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for STYL-228 tests');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function authHeaders(origin: string, turnstile = true): Record<string, string> {
  const headers: Record<string, string> = {
    Origin: origin,
    'Content-Type': 'application/json',
  };
  if (turnstile) headers['x-turnstile-token'] = TURNSTILE;
  return headers;
}

function assertNoSessionCookie(res: APIResponse) {
  const raw = res.headers()['set-cookie'] || '';
  const parts = Array.isArray(raw) ? raw.join('\n') : String(raw);
  expect(parts.toLowerCase()).not.toContain('auth-token');
  expect(parts.toLowerCase()).not.toContain('refresh-token');
  expect(parts.toLowerCase()).not.toContain('access-token');
}

function assertNoCredentialBody(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/action_link|email_otp|hashed_token|access_token|refresh_token/i);
  expect(text).not.toMatch(/https?:\/\//i);
  const record = body as Record<string, unknown>;
  expect(record.authenticated).toBeUndefined();
  expect(record.redirectUrl).toBeUndefined();
  expect(record.exists).toBeUndefined();
  expect(record.token).toBeUndefined();
}

function assertNoWildcardCors(res: APIResponse) {
  const acao = res.headers()['access-control-allow-origin'] || '';
  expect(acao).not.toBe('*');
  expect(acao).not.toContain('evil.example');
}

async function emailExists(client: SupabaseClient, email: string): Promise<boolean> {
  const { data, error } = await client.rpc('check_email_exists', { p_email: email });
  if (error) throw new Error(`check_email_exists failed: ${error.message}`);
  return data === true;
}

async function readMailboxLink(recipient: string): Promise<string> {
  const localPart = recipient.split('@')[0];
  const deadline = Date.now() + 20000;

  while (Date.now() < deadline) {
    const mailpit = await fetch(`${MAILBOX}/api/v1/messages`).catch(() => null);
    if (mailpit?.ok) {
      const payload = (await mailpit.json()) as {
        messages?: Array<{ ID: string; To?: Array<{ Address?: string }> }>;
      };
      const match = (payload.messages || []).find((message) =>
        (message.To || []).some((to) => to.Address?.toLowerCase() === recipient.toLowerCase()),
      );
      if (match) {
        const detail = await fetch(`${MAILBOX}/api/v1/message/${match.ID}`);
        if (detail.ok) {
          const body = (await detail.json()) as { HTML?: string; Text?: string };
          const link = extractVerifyLink(`${body.Text || ''}\n${body.HTML || ''}`);
          if (link) return link;
        }
      }
    }

    const inbucket = await fetch(`${MAILBOX}/api/v1/mailbox/${encodeURIComponent(localPart)}`).catch(() => null);
    if (inbucket?.ok) {
      const messages = (await inbucket.json()) as Array<{ id?: string; ID?: string }>;
      const latest = messages?.[0];
      const id = latest?.id || latest?.ID;
      if (id) {
        const detail = await fetch(`${MAILBOX}/api/v1/mailbox/${encodeURIComponent(localPart)}/${id}`);
        if (detail.ok) {
          const body = (await detail.json()) as { body?: { text?: string; html?: string } };
          const link = extractVerifyLink(`${body.body?.text || ''}\n${body.body?.html || ''}`);
          if (link) return link;
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`No magic-link email arrived for ${recipient}`);
}

function extractVerifyLink(raw: string): string | null {
  const decoded = raw.replace(/&amp;/g, '&').replace(/=\r?\n/g, '');
  const match = decoded.match(/https?:\/\/[^\s"'<>]+verify[^\s"'<>]*/i);
  return match ? match[0] : null;
}

test.describe('STYL-228 magic link session lockdown', () => {
  test('POST with someone else\'s email returns no session cookie, link, or token', async ({ request }) => {
    const client = adminClient();
    const email = `styl228-victim-${Date.now()}@test.styleflo.ai`;
    const { data, error } = await client.auth.admin.createUser({
      email,
      password: 'Password123!',
      email_confirm: true,
    });
    expect(error).toBeNull();
    expect(data.user?.id).toBeTruthy();

    try {
      const res = await request.post('/api/auth/magic-link', {
        headers: authHeaders(APP_ORIGIN),
        data: { email },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      assertNoCredentialBody(body);
      assertNoSessionCookie(res);
      assertNoWildcardCors(res);
    } finally {
      if (data.user?.id) await client.auth.admin.deleteUser(data.user.id);
    }
  });

  test('a cross-origin magic-link request is rejected', async ({ request }) => {
    const res = await request.post('/api/auth/magic-link', {
      headers: authHeaders('https://evil.example'),
      data: { email: 'someone@example.com' },
    });
    expect(res.status()).toBe(403);
    assertNoSessionCookie(res);
    assertNoWildcardCors(res);
    const body = await res.json();
    assertNoCredentialBody(body);
  });

  test('OPTIONS preflight does not allow every origin', async ({ request }) => {
    const res = await request.fetch('/api/auth/magic-link', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-turnstile-token',
      },
    });
    assertNoWildcardCors(res);
  });

  test('an unknown email does not create a confirmed account', async ({ request }) => {
    const client = adminClient();
    const email = `styl228-unknown-${Date.now()}@test.styleflo.ai`;
    const res = await request.post('/api/auth/magic-link', {
      headers: authHeaders(APP_ORIGIN),
      data: { email, name: 'Should Not Exist' },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    assertNoSessionCookie(res);
    expect(await emailExists(client, email)).toBe(false);
  });

  test('a missing Turnstile token is rejected and does not set a session', async ({ request }) => {
    const res = await request.post('/api/auth/magic-link', {
      headers: authHeaders(APP_ORIGIN, false),
      data: { email: 'someone@example.com' },
    });
    expect(res.status()).toBe(403);
    assertNoSessionCookie(res);
    assertNoCredentialBody(await res.json());
  });

  test('check-email returns the same body whether or not the account exists', async ({ request }) => {
    const client = adminClient();
    const email = `styl228-known-${Date.now()}@test.styleflo.ai`;
    const unknown = `styl228-absent-${Date.now()}@test.styleflo.ai`;
    const { data, error } = await client.auth.admin.createUser({
      email,
      password: 'Password123!',
      email_confirm: true,
    });
    expect(error).toBeNull();

    try {
      const known = await request.post('/api/auth/check-email', {
        headers: authHeaders(APP_ORIGIN),
        data: { email },
      });
      const missing = await request.post('/api/auth/check-email', {
        headers: authHeaders(APP_ORIGIN),
        data: { email: unknown },
      });
      expect(known.status()).toBe(200);
      expect(missing.status()).toBe(200);
      const knownBody = await known.json();
      const missingBody = await missing.json();
      expect(knownBody).toEqual(missingBody);
      expect(knownBody).toEqual({ ok: true });
      expect(JSON.stringify(knownBody)).not.toContain(email);
      assertNoWildcardCors(known);
      assertNoWildcardCors(missing);
    } finally {
      if (data.user?.id) await client.auth.admin.deleteUser(data.user.id);
    }
  });

  test('check-email rejects a foreign origin', async ({ request }) => {
    const res = await request.post('/api/auth/check-email', {
      headers: authHeaders('https://evil.example'),
      data: { email: 'someone@example.com' },
    });
    expect(res.status()).toBe(403);
    assertNoWildcardCors(res);
    assertNoCredentialBody(await res.json());
  });

  test('the embed scripts do not call the magic-link route', async ({ request }) => {
    const widget = await (await request.get('/widget.js')).text();
    const embed = await (await request.get('/embed.js')).text();
    expect(widget).not.toContain('/api/auth/magic-link');
    expect(embed).not.toContain('/api/auth/magic-link');
    expect(widget).toContain('/login');
    expect(embed).toContain('/login');
  });

  test('opening the emailed link signs the existing user in', async ({ page, request }) => {
    const client = adminClient();
    const email = `styl228-inbox-${Date.now()}@test.styleflo.ai`;
    const { data, error } = await client.auth.admin.createUser({
      email,
      password: 'Password123!',
      email_confirm: true,
    });
    expect(error).toBeNull();
    expect(data.user?.id).toBeTruthy();

    try {
      const res = await request.post('/api/auth/magic-link', {
        headers: authHeaders(APP_ORIGIN),
        data: { email },
      });
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      assertNoSessionCookie(res);

      const link = await readMailboxLink(email);
      expect(link).not.toContain('email_otp');
      await page.goto(link);
      await page.waitForURL((url) => url.pathname.startsWith('/dashboard'), { timeout: 60000 });
      expect(new URL(page.url()).pathname).toBe('/dashboard');
    } finally {
      if (data.user?.id) await client.auth.admin.deleteUser(data.user.id);
    }
  });
});
