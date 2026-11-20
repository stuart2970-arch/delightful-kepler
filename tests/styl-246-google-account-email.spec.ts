import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emailFromCalendarId,
  emailFromIdToken,
  emailInMockCode,
  resolveGoogleAccountEmail,
  unsignedIdTokenForEmail,
} from '../src/lib/google-account-email';

/**
 * STYL-246: Google Calendar OAuth must store the connected account email
 * without adding userinfo or openid scopes. The primary calendar id is the
 * account address under the calendar.readonly scope already requested.
 */

const root = process.cwd();

test.describe('STYL-246 Google account email', () => {
  test('an ID token email is stored when Google already returned one', () => {
    const token = unsignedIdTokenForEmail('owner@salon.test');
    expect(emailFromIdToken(token)).toBe('owner@salon.test');
    expect(resolveGoogleAccountEmail({
      idToken: token,
      calendarId: 'other@gmail.com',
    })).toBe('owner@salon.test');
  });

  test('the primary calendar id is the account email when there is no ID token', () => {
    expect(resolveGoogleAccountEmail({ idToken: null, calendarId: 'owner@gmail.com' })).toBe('owner@gmail.com');
    expect(emailFromCalendarId('primary')).toBeNull();
    expect(emailFromCalendarId('')).toBeNull();
    expect(resolveGoogleAccountEmail({ calendarId: 'not-an-email' })).toBeNull();
  });

  test('mock OAuth codes can carry an email and the callback does not request userinfo', () => {
    expect(emailInMockCode('mock_owner@salon.test')).toBe('owner@salon.test');
    expect(emailFromIdToken(unsignedIdTokenForEmail(emailInMockCode('mock_owner@salon.test')!))).toBe('owner@salon.test');

    const authorize = readFileSync(join(root, 'src/app/api/integrations/google/authorize/route.ts'), 'utf8');
    const callback = readFileSync(join(root, 'src/app/api/integrations/google/callback/route.ts'), 'utf8');
    expect(authorize).toContain('calendar.readonly');
    expect(authorize).not.toContain('userinfo');
    expect(authorize).not.toContain('openid');
    expect(callback).toContain('calendarList.get');
    expect(callback).not.toContain('userinfo');
    expect(callback).toContain('account_email');
  });

  test('the integrations and scheduling screens show the connected account', () => {
    const integrations = readFileSync(join(root, 'src/components/dashboard-views/IntegrationsView.tsx'), 'utf8');
    const scheduling = readFileSync(join(root, 'src/components/dashboard-views/SchedulingView.tsx'), 'utf8');
    expect(integrations).toContain('data-testid="google-connected-email"');
    expect(integrations).toContain('Connected as');
    expect(scheduling).toContain('Connected as ${googleConnectedEmail}');
  });
});
