import { test, expect } from '@playwright/test';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test.describe('STYL-282: TOKEN_ENC_KEY only', () => {
  test('crypto.ts encrypts only with TOKEN_ENC_KEY and supports legacy decrypt', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/crypto.ts'), 'utf8');
    expect(src).toContain('TOKEN_ENC_KEY is not configured');
    expect(src).toContain('legacy key material');
    expect(src).not.toMatch(/process\.env\.TOKEN_ENC_KEY \|\| process\.env\.META_APP_SECRET/);
  });

  test('legacy META_APP_SECRET ciphertext still decrypts when TOKEN_ENC_KEY differs', async () => {
    const previous = {
      TOKEN_ENC_KEY: process.env.TOKEN_ENC_KEY,
      META_APP_SECRET: process.env.META_APP_SECRET,
    };
    const legacySecret = 'legacy_meta_only_styl282';
    process.env.TOKEN_ENC_KEY = 'primary_token_enc_key_styl282!!';
    process.env.META_APP_SECRET = legacySecret;
    const cryptoMod = await import('../src/lib/crypto');
    const oldEncrypt = (plain: string) => {
      const key = createHash('sha256').update(legacySecret).digest();
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      let enc = cipher.update(plain, 'utf8', 'hex');
      enc += cipher.final('hex');
      return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc}`;
    };
    const blob = oldEncrypt('whatsapp-token-legacy');
    expect(cryptoMod.decryptToken(blob)).toBe('whatsapp-token-legacy');
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
      else process.env[key] = value;
    }
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