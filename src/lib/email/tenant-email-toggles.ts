import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type TenantEmailToggles = {
  enquiryDetailsEmailEnabled: boolean
  bookingConfirmationEmailEnabled: boolean
}

function adminClient(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Missing column or a read error stays on, which is the default. */
export function emailToggleOn(value: boolean | null | undefined): boolean {
  return value !== false
}

export async function readTenantEmailToggles(tenantId: string): Promise<TenantEmailToggles> {
  const fallback: TenantEmailToggles = {
    enquiryDetailsEmailEnabled: true,
    bookingConfirmationEmailEnabled: true,
  }
  const admin = adminClient()
  if (!admin || !tenantId) return fallback
  const { data, error } = await admin
    .from('tenants')
    .select('enquiry_details_email_enabled, booking_confirmation_email_enabled')
    .eq('id', tenantId)
    .maybeSingle()
  if (error || !data) return fallback
  return {
    enquiryDetailsEmailEnabled: emailToggleOn(data.enquiry_details_email_enabled),
    bookingConfirmationEmailEnabled: emailToggleOn(data.booking_confirmation_email_enabled),
  }
}

export async function isEnquiryDetailsEmailEnabled(tenantId: string): Promise<boolean> {
  const toggles = await readTenantEmailToggles(tenantId)
  return toggles.enquiryDetailsEmailEnabled
}

export async function isBookingConfirmationEmailEnabled(tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return true
  const toggles = await readTenantEmailToggles(tenantId)
  return toggles.bookingConfirmationEmailEnabled
}

export async function writeTenantEmailToggles(
  tenantId: string,
  patch: Partial<TenantEmailToggles>,
): Promise<TenantEmailToggles | null> {
  const admin = adminClient()
  if (!admin || !tenantId) return null
  const update: Record<string, boolean> = {}
  if (typeof patch.enquiryDetailsEmailEnabled === 'boolean') {
    update.enquiry_details_email_enabled = patch.enquiryDetailsEmailEnabled
  }
  if (typeof patch.bookingConfirmationEmailEnabled === 'boolean') {
    update.booking_confirmation_email_enabled = patch.bookingConfirmationEmailEnabled
  }
  if (Object.keys(update).length === 0) return readTenantEmailToggles(tenantId)
  const { error } = await admin.from('tenants').update(update).eq('id', tenantId)
  if (error) return null
  return readTenantEmailToggles(tenantId)
}
