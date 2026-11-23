import { clearTenantPhonePurchase } from '@/lib/telephony/provision-safety';
import { releaseTwilioNumber, releaseVapiNumber } from '@/lib/telephony/release-vendors';
import type { SupabaseClient } from '@supabase/supabase-js';

export type NumberReleaser = {
  releaseTwilio(phoneNumber: string): Promise<void>;
  releaseVapi(phoneNumber: string): Promise<void>;
};

export function defaultNumberReleaser(): NumberReleaser {
  return {
    releaseTwilio: releaseTwilioNumber,
    releaseVapi: releaseVapiNumber,
  };
}

export function closurePhoneNumbers(shadow: string | null, mobile: string | null): string[] {
  const numbers: string[] = [];
  for (const value of [shadow, mobile]) {
    const trimmed = (value || '').trim();
    if (!trimmed || numbers.includes(trimmed)) continue;
    numbers.push(trimmed);
  }
  return numbers;
}

export function closurePhoneLabel(shadow: string | null, mobile: string | null): string {
  return closurePhoneNumbers(shadow, mobile).join(' and ');
}

/**
 * Release each stored number through Twilio and Vapi, then clear the tenant
 * columns and the purchase reservation. Safe to call again: a missing vendor
 * number is a no-op, and a second pass does not run once released_at is set.
 */
export async function releaseHeldNumbers(
  db: SupabaseClient,
  input: {
    tenantId: string;
    shadowNumber: string | null;
    mobileNumber: string | null;
    releaser?: NumberReleaser;
  },
): Promise<{ released: number }> {
  const releaser = input.releaser ?? defaultNumberReleaser();
  const numbers = closurePhoneNumbers(input.shadowNumber, input.mobileNumber);
  for (const phoneNumber of numbers) {
    await releaser.releaseTwilio(phoneNumber);
    await releaser.releaseVapi(phoneNumber);
  }

  const { error: tenantError } = await db
    .from('tenants')
    .update({
      twilio_shadow_number: null,
      twilio_mobile_number: null,
      has_landline: false,
      has_mobile: false,
    })
    .eq('id', input.tenantId);
  if (tenantError) {
    throw new Error(tenantError.message || 'Could not clear the held number');
  }

  const cleared = await clearTenantPhonePurchase(db, input.tenantId);
  if (cleared.error) {
    throw new Error(cleared.error.message || 'Could not return the number reservation');
  }
  return { released: numbers.length };
}
