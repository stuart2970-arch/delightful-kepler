import type { SupabaseClient } from '@supabase/supabase-js';

/** Columns that exist on tenants. currency and timezone are not tenant columns. */
export const VOICE_TENANT_COLUMNS =
  'id, company_name, rwg_business_name, booking_mode, booking_url, general_operating_hours, is_24_7';

/** The services table stores the amount in price, not base_price. */
export const VOICE_SERVICE_COLUMNS =
  'id, name, price, duration_minutes, buffer_minutes, description';

export interface VoiceSalon {
  tenant: {
    id?: string;
    company_name?: string | null;
    rwg_business_name?: string | null;
    booking_mode?: string | null;
    booking_url?: string | null;
    general_operating_hours?: unknown;
    is_24_7?: boolean | null;
  } | null;
  services: Array<Record<string, unknown>>;
  tenantError: string | null;
  servicesError: string | null;
}

export async function loadVoiceSalon(
  admin: SupabaseClient,
  tenantId: string,
  chatbotId: string,
): Promise<VoiceSalon> {
  const [tenantQuery, servicesQuery] = await Promise.all([
    admin.from('tenants').select(VOICE_TENANT_COLUMNS).eq('id', tenantId).maybeSingle(),
    admin.from('services').select(VOICE_SERVICE_COLUMNS).eq('tenant_id', tenantId).eq('chatbot_id', chatbotId),
  ]);

  return {
    tenant: tenantQuery.data,
    services: servicesQuery.data || [],
    tenantError: tenantQuery.error?.message || null,
    servicesError: servicesQuery.error?.message || null,
  };
}
