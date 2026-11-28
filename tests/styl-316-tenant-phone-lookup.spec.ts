import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeDialledE164 } from '../src/lib/telephony/tenant-by-twilio-number';

test.describe('STYL-316: parameterised tenant phone lookup', () => {
  test('assistant inbound route avoids interpolated PostgREST or() filters', () => {
    const assistant = readFileSync(join(process.cwd(), 'src/app/api/webhooks/vapi/assistant/route.ts'), 'utf8');
    expect(assistant).toContain('findTenantByDialledTwilioNumber');
    expect(assistant).not.toMatch(/\.or\(`twilio_shadow_number/);
  });

  test('normalizeDialledE164 produces E.164', () => {
    expect(normalizeDialledE164('+44 7446 900 875')).toBe('+447446900875');
    expect(normalizeDialledE164('447446900875')).toBe('+447446900875');
    expect(normalizeDialledE164('')).toBeNull();
  });
});