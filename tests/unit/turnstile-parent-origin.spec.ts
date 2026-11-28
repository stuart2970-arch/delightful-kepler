import { test, expect } from '@playwright/test';
import {
  isAllowedTurnstileParentOrigin,
  resolveTurnstilePostMessageTarget,
} from '../../src/lib/turnstile-parent-origin';

test.describe('turnstile parent_origin allowlist', () => {
  test('allows StyleFlo infrastructure hosts without referrer', () => {
    expect(isAllowedTurnstileParentOrigin('https://styleflo.ai')).toBe(true);
    expect(isAllowedTurnstileParentOrigin('https://app.styleflo.ai')).toBe(true);
    expect(isAllowedTurnstileParentOrigin('https://staging.styleflo.ai')).toBe(true);
    expect(isAllowedTurnstileParentOrigin('https://tenant.hosted.app')).toBe(true);
    expect(isAllowedTurnstileParentOrigin('http://localhost:3001')).toBe(true);
    expect(isAllowedTurnstileParentOrigin('https://evil.example')).toBe(false);
  });

  test('rejects parent_origin that disagrees with referrer', () => {
    const result = resolveTurnstilePostMessageTarget(
      'https://evil.example',
      'https://styleflo.ai/business/demo',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('parent_origin_mismatch');
  });

  test('uses referrer for customer sites when referrer is present', () => {
    const result = resolveTurnstilePostMessageTarget(
      'https://salon.example',
      'https://salon.example/book',
    );
    expect(result).toEqual({ ok: true, targetOrigin: 'https://salon.example' });
  });

  test('accepts allowlisted parent_origin when referrer is missing', () => {
    const result = resolveTurnstilePostMessageTarget('https://styleflo.ai', '');
    expect(result).toEqual({ ok: true, targetOrigin: 'https://styleflo.ai' });
  });
});