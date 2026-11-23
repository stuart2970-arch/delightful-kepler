import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Salon operational data removed on deletion day.
 * Billing rows (the tenant, usage ledger, failed-payment cases, add-on
 * history, and system email log) stay so invoices can still be explained.
 */
const CUSTOMER_DATA_TABLES = [
  'whatsapp_messages',
  'whatsapp_contacts',
  'whatsapp_accounts',
  'messages',
  'conversations',
  'document_chunks',
  'appointments',
  'booking_audit_log',
  'calendar_push_subscriptions',
  'tenant_integrations',
  'staff',
  'services',
  'chatbots',
] as const;

function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /does not exist|schema cache/i.test(error.message || '');
}

export async function deleteClosedAccountData(db: SupabaseClient, tenantId: string): Promise<void> {
  for (const table of CUSTOMER_DATA_TABLES) {
    const { error } = await db.from(table).delete().eq('tenant_id', tenantId);
    if (error && !isMissingRelation(error)) {
      throw new Error(error.message || `Could not delete ${table}`);
    }
  }
}
