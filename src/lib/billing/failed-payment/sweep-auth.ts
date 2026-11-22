import { secretsEqual } from '@/lib/security/secrets-equal';

export const FAILED_PAYMENT_SWEEP_SECRET_ENV = 'FAILED_PAYMENT_SWEEP_SECRET';

function bearerToken(authorization: string | null): string {
  const match = /^Bearer\s+(\S+)/i.exec((authorization || '').trim());
  return match?.[1] ?? '';
}

/** Fail closed. An unset, blank, or mismatched secret never runs the sweep. */
export function isFailedPaymentSweepAuthorized(
  authorization: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = (env[FAILED_PAYMENT_SWEEP_SECRET_ENV] || '').trim();
  if (!expected) return false;
  return secretsEqual(bearerToken(authorization), expected);
}
