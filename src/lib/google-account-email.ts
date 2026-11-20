const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailFromCalendarId(calendarId: string | null | undefined): string | null {
  if (!calendarId) return null;
  const id = calendarId.trim();
  if (!id || id.toLowerCase() === 'primary') return null;
  return EMAIL_PATTERN.test(id) ? id : null;
}

export function emailFromIdToken(idToken: string | null | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json) as { email?: unknown };
    return typeof payload.email === 'string' ? emailFromCalendarId(payload.email) : null;
  } catch {
    return null;
  }
}

/**
 * Prefer the ID token email when Google already returned one.
 * Otherwise the primary calendar id is the account email under the
 * calendar.readonly scope already requested for Calendar sync.
 */
export function resolveGoogleAccountEmail(input: {
  idToken?: string | null;
  calendarId?: string | null;
}): string | null {
  return emailFromIdToken(input.idToken) || emailFromCalendarId(input.calendarId);
}

export function emailInMockCode(code: string): string | null {
  const withoutPrefix = code.replace(/^mock_/, '');
  const match = withoutPrefix.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? emailFromCalendarId(match[0]) : null;
}

/** Unsigned JWT body so the mock OAuth path can carry an email without calling Google. */
export function unsignedIdTokenForEmail(email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ email })).toString('base64url');
  return `${header}.${body}.sig`;
}
