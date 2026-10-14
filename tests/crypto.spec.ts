import { test, expect } from '@playwright/test';
import { encryptToken, decryptToken, encryptPin, decryptPin, maskPhoneNumber } from '../src/lib/crypto';

test.describe('Phase 1: Cryptographic Infrastructure & Privacy Protection', () => {
  test('should encrypt and decrypt access tokens successfully', () => {
    const rawToken = 'EAABwb01ZBz8wBA...mock_meta_system_user_token_long_string';
    const encrypted = encryptToken(rawToken, 1);

    expect(encrypted).not.toBe(rawToken);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(encrypted.split(':').length).toBe(4);

    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(rawToken);
  });

  test('should encrypt and decrypt 6-digit WhatsApp registration PINs', () => {
    const pin = '839201';
    const encryptedPin = encryptPin(pin);

    expect(encryptedPin).not.toBe(pin);
    expect(encryptedPin.startsWith('v1:')).toBe(true);

    const decrypted = decryptPin(encryptedPin);
    expect(decrypted).toBe(pin);
  });

  test('should fail decryption if ciphertext or auth tag is tampered with', () => {
    const raw = 'secret_business_token_123';
    const encrypted = encryptToken(raw);
    const parts = encrypted.split(':');

    // Tamper with ciphertext
    const tamperedCipher = parts[3].slice(0, -2) + (parts[3].endsWith('a') ? 'b' : 'a');
    const tamperedString = `${parts[0]}:${parts[1]}:${parts[2]}:${tamperedCipher}`;

    expect(() => decryptToken(tamperedString)).toThrow();
  });

  test('should handle empty or malformed encrypted strings safely', () => {
    expect(encryptToken('')).toBe('');
    expect(decryptToken('')).toBe('');
    expect(() => decryptToken('invalid_non_v_string')).toThrow('Invalid encrypted token format');
  });

  test('should mask phone numbers to last 4 digits for GDPR and privacy logging', () => {
    expect(maskPhoneNumber('+447446900875')).toBe('+********0875');
    expect(maskPhoneNumber('07970819149')).toBe('*******9149');
    expect(maskPhoneNumber('1234')).toBe('****');
    expect(maskPhoneNumber(null)).toBe('****');
    expect(maskPhoneNumber(undefined)).toBe('****');
  });
});
