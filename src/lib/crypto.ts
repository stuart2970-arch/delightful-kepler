import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const DEFAULT_KEY_VERSION = 1;

/**
 * Derives a consistent 32-byte (256-bit) buffer key from the provided secret or environment variable.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.TOKEN_ENC_KEY || process.env.META_APP_SECRET || 'styleflo_default_dev_enc_key_32b_!';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plain-text token or secret using AES-256-GCM.
 * Output format: `v{version}:{iv_hex}:{authTag_hex}:{ciphertext_hex}`
 */
export function encryptToken(plainText: string, keyVersion: number = DEFAULT_KEY_VERSION): string {
  if (!plainText) return '';

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  const ivHex = iv.toString('hex');

  return `v${keyVersion}:${ivHex}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted token string.
 * Expects format: `v{version}:{iv_hex}:{authTag_hex}:{ciphertext_hex}`
 */
export function decryptToken(encryptedString: string): string {
  if (!encryptedString) return '';

  const parts = encryptedString.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted token format');
  }

  const [versionTag, ivHex, authTagHex, cipherHex] = parts;
  if (!versionTag.startsWith('v')) {
    throw new Error('Unsupported encryption version');
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Convenience helper to encrypt a 6-digit WhatsApp registration PIN.
 */
export function encryptPin(pin: string): string {
  return encryptToken(pin);
}

/**
 * Convenience helper to decrypt a 6-digit WhatsApp registration PIN.
 */
export function decryptPin(encryptedPin: string): string {
  return decryptToken(encryptedPin);
}

/**
 * Redacts a phone number to only show the last 4 digits for privacy-safe logs.
 * Example: `+447446900875` -> `+44******0875`
 */
export function maskPhoneNumber(phone?: string | null): string {
  if (!phone) return '****';
  const clean = phone.trim();
  if (clean.length <= 4) return '****';
  const visible = clean.slice(-4);
  const prefix = clean.startsWith('+') ? '+' : '';
  return `${prefix}${'*'.repeat(Math.max(0, clean.length - 4 - prefix.length))}${visible}`;
}
