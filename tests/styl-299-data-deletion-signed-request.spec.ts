import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { POST as dataDeletion } from '../src/app/api/data-deletion/route';
import { GET as metaHandshake } from '../src/app/api/webhooks/meta/route';

const SECRET = 'test_meta_app_secret_123';
const BUILT_IN_VERIFY_TOKEN = 'styleflo_meta_verify_2026';

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signPayload(payload: Record<string, unknown>, secret: string): string {
  const encoded = base64Url(JSON.stringify(payload));
  const signature = base64Url(crypto.createHmac('sha256', secret).update(encoded).digest());
  return `${signature}.${encoded}`;
}

function postDeletion(signedRequest?: string) {
  return dataDeletion(
    new NextRequest('http://localhost:3001/api/data-deletion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signedRequest === undefined ? {} : { signed_request: signedRequest }),
    }),
  );
}

async function withEnv<T>(
  name: string,
  value: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const previous = process.env[name];
  try {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    return await run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

test.describe('STYL-299: Meta data-deletion signed_request', () => {
  test('a valid signed_request returns a confirmation for the verified user_id', async () => {
    const signed = signPayload(
      { algorithm: 'HMAC-SHA256', user_id: '218471', issued_at: 1710000000 },
      SECRET,
    );
    const res = await withEnv('META_APP_SECRET', `  ${SECRET}\n`, () => postDeletion(signed));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.confirmation_code).toMatch(/^del_[0-9a-f]+$/);
    expect(data.confirmation_code).not.toContain('218471');
    expect(data.url).toContain('/api/data-deletion?code=');
    expect(data.url).toContain(data.confirmation_code);
    expect(data.url).not.toContain('218471');
  });

  test('a bad signature is rejected and returns no confirmation', async () => {
    const signed = signPayload({ algorithm: 'HMAC-SHA256', user_id: '218471' }, 'other-secret');
    const res = await withEnv('META_APP_SECRET', SECRET, () => postDeletion(signed));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.confirmation_code).toBeUndefined();
    expect(data.url).toBeUndefined();
  });

  test('a wrong algorithm is rejected even when the signature matches', async () => {
    const signed = signPayload({ algorithm: 'HMAC-SHA1', user_id: '218471' }, SECRET);
    const res = await withEnv('META_APP_SECRET', SECRET, () => postDeletion(signed));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.confirmation_code).toBeUndefined();
    expect(data.url).toBeUndefined();
  });

  test('algorithm comparison accepts HMAC-SHA256 regardless of case', async () => {
    const signed = signPayload({ algorithm: 'hmac-sha256', user_id: '218471' }, SECRET);
    const res = await withEnv('META_APP_SECRET', SECRET, () => postDeletion(signed));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.confirmation_code).toMatch(/^del_[0-9a-f]+$/);
    expect(data.confirmation_code).not.toContain('218471');
  });

  test('a malformed signed_request is rejected and returns no confirmation', async () => {
    const res = await withEnv('META_APP_SECRET', SECRET, () => postDeletion('not-a-signed-request'));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.confirmation_code).toBeUndefined();
    expect(data.url).toBeUndefined();
  });

  test('a blank META_APP_SECRET fails closed and returns no confirmation', async () => {
    const signed = signPayload({ algorithm: 'HMAC-SHA256', user_id: '218471' }, SECRET);
    for (const secret of [undefined, '', '   ', '\t\n']) {
      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args.map((part) => String(part)).join(' '));
      };
      try {
        const res = await withEnv('META_APP_SECRET', secret, () => postDeletion(signed));
        expect(res.status).toBe(401);
        const data = await res.json();
        expect(data.confirmation_code).toBeUndefined();
        expect(data.url).toBeUndefined();
        expect(JSON.stringify(data)).not.toMatch(/META_APP_SECRET/i);
        expect(errors.some((line) => /META_APP_SECRET/i.test(line))).toBe(true);
      } finally {
        console.error = originalError;
      }
    }
  });
});

test.describe('STYL-300: Meta verify handshake requires META_VERIFY_TOKEN', () => {
  test('the handshake compares the token in constant time and application code has no built-in fallback', () => {
    const root = process.cwd();
    const route = readFileSync(join(root, 'src/app/api/webhooks/meta/route.ts'), 'utf8');
    const meta = readFileSync(join(root, 'src/lib/meta.ts'), 'utf8');
    const settings = readFileSync(join(root, 'src/app/api/integrations/meta/settings/route.ts'), 'utf8');
    expect(route).toContain('secretsEqual');
    expect(route).not.toContain('verifyToken === expectedToken');
    expect(meta).not.toContain('DEFAULT_META_VERIFY_TOKEN');
    expect(meta).not.toContain('styleflo_meta_verify_2026');
    expect(settings).not.toContain('DEFAULT_META_VERIFY_TOKEN');
    expect(settings).not.toContain('styleflo_meta_verify_2026');
  });

  test('an unset or blank META_VERIFY_TOKEN does not accept the built-in token', async () => {
    const challenge = 'challenge_should_not_echo';
    for (const value of [undefined, '', '   ']) {
      const res = await withEnv('META_VERIFY_TOKEN', value, () =>
        metaHandshake(
          new NextRequest(
            `http://localhost:3001/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${BUILT_IN_VERIFY_TOKEN}&hub.challenge=${challenge}`,
          ),
        ),
      );
      expect(res.status).toBe(403);
      expect(await res.text()).not.toBe(challenge);
    }
  });

  test('a stored chatbot verify token works when META_VERIFY_TOKEN is unset', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const botId = 'e0000000-0000-0000-0000-000000000001';
    const { data: before } = await admin.from('chatbots').select('meta_verify_token').eq('id', botId).maybeSingle();
    const token = `salon-only-${Date.now()}`;
    const { error } = await admin.from('chatbots').update({ meta_verify_token: token }).eq('id', botId);
    if (error) throw new Error(error.message);
    try {
      const challenge = 'chatbot_token_challenge';
      const res = await withEnv('META_VERIFY_TOKEN', undefined, () =>
        metaHandshake(
          new NextRequest(
            `http://localhost:3001/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=${challenge}`,
          ),
        ),
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(challenge);
    } finally {
      await admin.from('chatbots').update({ meta_verify_token: before?.meta_verify_token ?? null }).eq('id', botId);
    }
  });

  test('a configured META_VERIFY_TOKEN still completes the handshake', async () => {
    const challenge = 'challenge_configured_token';
    const res = await withEnv('META_VERIFY_TOKEN', 'salon_verify_token', () =>
      metaHandshake(
        new NextRequest(
          `http://localhost:3001/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=salon_verify_token&hub.challenge=${challenge}`,
        ),
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(challenge);
  });
});
