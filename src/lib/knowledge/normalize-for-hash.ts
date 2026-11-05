import { createHash } from 'node:crypto';
import { sanitizeForPostgres } from '@/lib/file-parser';

/**
 * Exact-duplicate key for STYL-189 (Stuart, 5 Nov 2026, comment 10178).
 *
 * Signed-off rule: lowercase and collapse whitespace. Also runs
 * sanitizeForPostgres (null bytes, control characters, NFC) so the hash
 * matches text that can actually be stored. Punctuation, HTML and markdown
 * are kept. Do not stem, strip stop-words, or decode entities here.
 */
export function normalizeForHash(raw: string): string {
  const sanitized = sanitizeForPostgres(typeof raw === 'string' ? raw : '');
  return sanitized
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lowercase hex SHA-256 of the normalised text. Empty input hashes to ''. */
export function hashNormalizedContent(raw: string): string {
  const normalized = normalizeForHash(raw);
  if (!normalized) return '';
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
