import { timingSafeEqual } from 'node:crypto';

/** Constant-time shared-secret compare. Empty values fail closed. */
export function secretsEqual(provided: string, expected: string): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
