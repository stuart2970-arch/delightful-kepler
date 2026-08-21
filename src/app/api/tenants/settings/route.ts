import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// We use the service role to update the tenant since the user might be an admin of the tenant

export async function PATCH(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('[Tenant Settings] Missing Supabase environment variables');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { 
      tenantId, 
      domain,
      business_address,
      postcode,
      rwgConfig,
      bookingMode, 
      bookingUrl,
      general_operating_hours,
      operating_hours_overrides,
      holiday_settings,
      flexible_breaks, flexibleBreaks,
      is_24_7, is247,
      open_public_holidays, openPublicHolidays,
      max_advance_weeks, maxAdvanceWeeks,

      // New Address Profile Fields
      trading_address_street, tradingAddressStreet,
      trading_address_city, tradingAddressCity,
      trading_address_postcode, tradingAddressPostcode,
      trading_address_phone, tradingAddressPhone,
      company_registration_number, companyRegistrationNumber,
      registered_address_street, registeredAddressStreet,
      registered_address_city, registeredAddressCity,
      registered_address_postcode, registeredAddressPostcode,
      is_registered_company, isRegisteredCompany,
      registered_address_same_as_trading, registeredAddressSameAsTrading,
      rwg_address_same_as_trading, rwgAddressSameAsTrading
    } = body;

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    // Standard Core Calendar & Operating Hours Settings
    const coreUpdate: Record<string, any> = {
      ...(domain !== undefined && { domain: domain ? domain.trim() : null }),
      ...(rwgConfig !== undefined && { 
        is_rwg_enabled: rwgConfig.is_rwg_enabled,
        rwg_business_name: rwgConfig.rwg_business_name,
        rwg_street_address: rwgConfig.rwg_street_address,
        rwg_city: rwgConfig.rwg_city,
        rwg_postcode: rwgConfig.rwg_postcode,
        rwg_phone: rwgConfig.rwg_phone,
        is_registered_business_address: rwgConfig.is_registered_business_address
      }),
      ...(bookingMode !== undefined && { booking_mode: bookingMode }),
      ...(bookingUrl !== undefined && { booking_url: bookingUrl }),
      ...(general_operating_hours !== undefined && { general_operating_hours }),
      ...(operating_hours_overrides !== undefined && { operating_hours_overrides }),
      ...(holiday_settings !== undefined && { holiday_settings }),
      ...((flexible_breaks !== undefined || flexibleBreaks !== undefined) && { flexible_breaks: flexible_breaks ?? flexibleBreaks }),
      ...((is_24_7 !== undefined || is247 !== undefined) && { is_24_7: is_24_7 ?? is247 }),
      ...((open_public_holidays !== undefined || openPublicHolidays !== undefined) && { open_public_holidays: open_public_holidays ?? openPublicHolidays }),
      ...((max_advance_weeks !== undefined || maxAdvanceWeeks !== undefined) && { max_advance_weeks: max_advance_weeks ?? maxAdvanceWeeks }),
    };

    // Extended Address Profile Fields (if columns exist in DB schema)
    const extendedAddressUpdate: Record<string, any> = {
      ...((trading_address_street !== undefined || tradingAddressStreet !== undefined) && { trading_address_street: trading_address_street ?? tradingAddressStreet }),
      ...((trading_address_city !== undefined || tradingAddressCity !== undefined) && { trading_address_city: trading_address_city ?? tradingAddressCity }),
      ...((trading_address_postcode !== undefined || tradingAddressPostcode !== undefined) && { trading_address_postcode: trading_address_postcode ?? tradingAddressPostcode }),
      ...((trading_address_phone !== undefined || tradingAddressPhone !== undefined) && { trading_address_phone: trading_address_phone ?? tradingAddressPhone }),
      
      ...((company_registration_number !== undefined || companyRegistrationNumber !== undefined) && { company_registration_number: company_registration_number ?? companyRegistrationNumber }),
      
      ...((registered_address_street !== undefined || registeredAddressStreet !== undefined) && { registered_address_street: registered_address_street ?? registeredAddressStreet }),
      ...((registered_address_city !== undefined || registeredAddressCity !== undefined) && { registered_address_city: registered_address_city ?? registeredAddressCity }),
      ...((registered_address_postcode !== undefined || registeredAddressPostcode !== undefined) && { registered_address_postcode: registered_address_postcode ?? registeredAddressPostcode }),
      
      ...((is_registered_company !== undefined || isRegisteredCompany !== undefined) && { is_registered_company: is_registered_company ?? isRegisteredCompany }),
      ...((registered_address_same_as_trading !== undefined || registeredAddressSameAsTrading !== undefined) && { registered_address_same_as_trading: registered_address_same_as_trading ?? registeredAddressSameAsTrading }),
      ...((rwg_address_same_as_trading !== undefined || rwgAddressSameAsTrading !== undefined) && { rwg_address_same_as_trading: rwg_address_same_as_trading ?? rwgAddressSameAsTrading }),
    };

    // First attempt: Try updating with all fields
    let { data, error } = await supabase
      .from('tenants')
      .update({
        ...coreUpdate,
        ...extendedAddressUpdate
      })
      .eq('id', tenantId)
      .select()
      .single();

    // Fallback: If Postgres throws error (e.g. 42703 missing column), retry with core update only
    if (error) {
      console.warn('[Tenant Settings] Full update failed, attempting core settings fallback:', error.message);
      const fallbackResult = await supabase
        .from('tenants')
        .update(coreUpdate)
        .eq('id', tenantId)
        .select()
        .single();
      
      if (!fallbackResult.error) {
        data = fallbackResult.data;
        error = null;
      }
    }

    if (error) {
      console.error('[Tenant Settings] Error updating settings:', error);
      return NextResponse.json({ error: error.message || 'Failed to update settings' }, { status: 500 });
    }

    return NextResponse.json({ success: true, tenant: data });
  } catch (error: any) {
    console.error('[Tenant Settings] Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
