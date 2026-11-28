import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test.describe('STYL-282: TOKEN_ENC_KEY only', () => {
  test('crypto.ts does not fall back to other secrets', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/crypto.ts'), 'utf8');
    expect(src).not.toContain('META_APP_SECRET');
    expect(src).toContain('TOKEN_ENC_KEY is not configured');
  });

  test('encrypt fails closed when TOKEN_ENC_KEY is missing', async () => {
    const previous = process.env.TOKEN_ENC_KEY;
    delete process.env.TOKEN_ENC_KEY;
    try {
      const { encryptToken } = await import('../src/lib/crypto');
      expect(() => encryptToken('secret')).toThrow(/TOKEN_ENC_KEY/);
    } finally {
      if (previous === undefined) delete process.env.TOKEN_ENC_KEY;
      else process.env.TOKEN_ENC_KEY = previous;
    }
  });
});