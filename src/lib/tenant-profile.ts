/**
 * Columns the dashboard may read from public.tenants.
 * business_address and postcode were dropped in 20260721220000_drop_duplicate_addresses.sql.
 * Selecting them makes PostgREST reject the whole row, so company_name never reaches the UI.
 */
export const TENANT_PROFILE_SELECT = [
  'company_name',
  'domain',
  'plan_tier',
  'is_rwg_enabled',
  'rwg_business_name',
  'rwg_street_address',
  'rwg_city',
  'rwg_postcode',
  'rwg_phone',
  'is_registered_business_address',
  'booking_mode',
  'booking_url',
  'general_operating_hours',
  'operating_hours_overrides',
  'holiday_settings',
  'twilio_shadow_number',
  'twilio_mobile_number',
  'trading_address_street',
  'trading_address_city',
  'trading_address_postcode',
  'trading_address_phone',
  'company_registration_number',
  'registered_address_street',
  'registered_address_city',
  'registered_address_postcode',
  'is_registered_company',
  'registered_address_same_as_trading',
  'rwg_address_same_as_trading',
  'has_google_calendar',
  'has_microsoft_calendar',
].join(', ');

/** Salon name shown in the dashboard. Blank when the tenant row has no company name. */
export function salonNameFromTenant(companyName: string | null | undefined): string {
  return (companyName || '').trim();
}
