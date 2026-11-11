import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POST } from '../src/app/api/webhooks/wpmudev/route';

const SECRET = 'wpmudev-test-secret';

function postWpmudev(body: string, authorization?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== undefined) headers.authorization = authorization;
  return POST(
    new Request('http://localhost:3001/api/webhooks/wpmudev', {
      method: 'POST',
      headers,
      body,
    }),
  );
}

async function withSecret<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.WPMUDEV_WEBHOOK_SECRET;
  try {
    if (value === undefined) delete process.env.WPMUDEV_WEBHOOK_SECRET;
    else process.env.WPMUDEV_WEBHOOK_SECRET = value;
    return await run();
  } finally {
    if (previous === undefined) delete process.env.WPMUDEV_WEBHOOK_SECRET;
    else process.env.WPMUDEV_WEBHOOK_SECRET = previous;
  }
}

test.describe('STYL-298: WPMU DEV webhook fails closed without a secret', () => {
  test('route compares the bearer secret in constant time', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/webhooks/wpmudev/route.ts'), 'utf8');
    expect(src).toContain('secretsEqual');
    expect(src).not.toMatch(/authHeader\s*!==/);
  });

  test('missing, blank, or whitespace WPMUDEV_WEBHOOK_SECRET returns 401 and processes nothing', async () => {
    const body = JSON.stringify({});

    for (const secret of [undefined, '', '   ', '\t\n  ']) {
      const errors: string[] = [];
      const logs: string[] = [];
      const originalError = console.error;
      const originalLog = console.log;
      console.error = (...args: unknown[]) => {
        errors.push(args.map((part) => String(part)).join(' '));
      };
      console.log = (...args: unknown[]) => {
        logs.push(args.map((part) => String(part)).join(' '));
      };
      try {
        const res = await withSecret(secret, () =>
          postWpmudev(body, secret ? `Bearer ${secret}` : undefined),
        );
        expect(res.status).toBe(401);
        const data = await res.json();
        expect(data.error).toBe('Unauthorized');
        expect(data.success).toBeUndefined();
        expect(data.tenant_id).toBeUndefined();
        expect(logs.some((line) => line.includes('Received payload'))).toBe(false);
        expect(errors.some((line) => /WPMUDEV_WEBHOOK_SECRET is missing or whitespace-only/i.test(line))).toBe(
          true,
        );
      } finally {
        console.error = originalError;
        console.log = originalLog;
      }
    }
  });

  test('a wrong bearer returns 401 and processes nothing', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map((part) => String(part)).join(' '));
    };
    try {
      const res = await withSecret(SECRET, () =>
        postWpmudev(JSON.stringify({ tenant_id: 'not-a-real-tenant' }), 'Bearer wrong-secret'),
      );
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
      expect(data.success).toBeUndefined();
      expect(logs.some((line) => line.includes('Received payload'))).toBe(false);
    } finally {
      console.log = originalLog;
    }
  });

  test('a bearer matching the trimmed secret is accepted', async () => {
    const res = await withSecret(`  ${SECRET}\n`, () =>
      postWpmudev('not-json', `Bearer ${SECRET}`),
    );
    expect(res.status).not.toBe(401);
    const data = await res.json();
    expect(data.error).not.toBe('Unauthorized');
  });
});
