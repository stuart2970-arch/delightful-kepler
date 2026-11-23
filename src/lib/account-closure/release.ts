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

async function markPurchaseReleased(db: SupabaseClient, tenantId: string): Promise<void> {
  const { error } = await db
    .from('tenant_phone_number_purchases')
    .update({ status: 'released', updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'active', 'unknown', 'held']);
  if (error) throw new Error(error.message || 'Could not mark the number as released');
}

/**
 * Release each stored number through Twilio and Vapi, then clear the tenant
 * columns and mark the purchase row released. Safe to call again: a missing
 * vendor number is a no-op, and a second pass does not run once released_at is set.
 * Deprovision still uses clearTenantPhonePurchase, which deletes the row.
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

  await markPurchaseReleased(db, input.tenantId);
  return { released: numbers.length };
}
