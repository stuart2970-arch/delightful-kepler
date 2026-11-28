import type { SupabaseClient } from '@supabase/supabase-js';

const TENANT_PHONE_COLUMNS = ['twilio_shadow_number', 'twilio_mobile_number'] as const;

/**
 * Normalise a dialled number to a conservative E.164-ish form for equality lookups.
 */
export function normalizeDialledE164(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return null;
    return `+${digits}`;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `+${digits}`;
}

export type TenantByTwilioPhoneRow = {
  id: string;
  plan_tier?: string | null;
};

async function tenantByColumn(
  supabase: SupabaseClient,
  column: (typeof TENANT_PHONE_COLUMNS)[number],
  value: string,
): Promise<TenantByTwilioPhoneRow | null> {
  const { data } = await supabase
    .from('tenants')
    .select('id, plan_tier')
    .eq(column, value)
    .maybeSingle();
  return data ?? null;
}

/**
 * Resolve a tenant from a dialled Twilio number using parameterised .eq() filters only.
 */
export async function findTenantByDialledTwilioNumber(
  supabase: SupabaseClient,
  rawNumber: string,
): Promise<TenantByTwilioPhoneRow | null> {
  const e164 = normalizeDialledE164(rawNumber);
  if (!e164) return null;

  for (const column of TENANT_PHONE_COLUMNS) {
    const row = await tenantByColumn(supabase, column, e164);
    if (row) return row;
  }

  const withoutPlus = e164.startsWith('+') ? e164.slice(1) : e164;
  for (const column of TENANT_PHONE_COLUMNS) {
    const row = await tenantByColumn(supabase, column, withoutPlus);
    if (row) return row;
  }

  return null;
}