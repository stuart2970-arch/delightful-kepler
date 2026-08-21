import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
    let { 
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

    // Auto-resolve tenantId if missing or uninitialized
    if (!tenantId || tenantId === '00000000-0000-0000-0000-000000000000') {
      const { data: firstTenant } = await supabase.from('tenants').select('id').limit(1).maybeSingle();
      if (firstTenant?.id) {
        tenantId = firstTenant.id;
      }
    }

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    // Tier 1: Core Base Fields (Guaranteed in all Supabase schemas)
    const baselineUpdate: Record<string, any> = {
      id: tenantId,
      updated_at: new Date().toISOString(),
      ...(domain !== undefined && { domain: domain ? domain.trim() : null }),
      ...(bookingMode !== undefined && { booking_mode: bookingMode }),
      ...(bookingUrl !== undefined && { booking_url: bookingUrl }),
      ...(general_operating_hours !== undefined && { general_operating_hours }),
      ...(rwgConfig !== undefined && { 
        is_rwg_enabled: rwgConfig.is_rwg_enabled,
        rwg_business_name: rwgConfig.rwg_business_name,
        rwg_street_address: rwgConfig.rwg_street_address,
        rwg_city: rwgConfig.rwg_city,
        rwg_postcode: rwgConfig.rwg_postcode,
        rwg_phone: rwgConfig.rwg_phone,
        is_registered_business_address: rwgConfig.is_registered_business_address
      }),
    };

    // Tier 2: Advanced Policy Fields (May be missing in unmigrated schemas)
    const advancedPolicyUpdate: Record<string, any> = {
      ...(operating_hours_overrides !== undefined && { operating_hours_overrides }),
      ...(holiday_settings !== undefined && { holiday_settings }),
      ...((flexible_breaks !== undefined || flexibleBreaks !== undefined) && { flexible_breaks: flexible_breaks ?? flexibleBreaks }),
      ...((is_24_7 !== undefined || is247 !== undefined) && { is_24_7: is_24_7 ?? is247 }),
      ...((open_public_holidays !== undefined || openPublicHolidays !== undefined) && { open_public_holidays: open_public_holidays ?? openPublicHolidays }),
      ...((max_advance_weeks !== undefined || maxAdvanceWeeks !== undefined) && { max_advance_weeks: max_advance_weeks ?? maxAdvanceWeeks }),
    };

    // Tier 3: Extended Address Profile Fields
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

    // Attempt 1: Try upserting all tiers (Baseline + Advanced Policies + Extended Address)
    let { data, error } = await supabase
      .from('tenants')
      .upsert({
        ...baselineUpdate,
        ...advancedPolicyUpdate,
        ...extendedAddressUpdate
      }, { onConflict: 'id' })
      .select()
      .maybeSingle();

    // Attempt 2: If Attempt 1 failed due to missing columns, retry with Baseline + Advanced Policies
    if (error) {
      console.warn('[Tenant Settings] Attempt 1 failed, retrying Attempt 2:', error.message);
      const res2 = await supabase
        .from('tenants')
        .upsert({
          ...baselineUpdate,
          ...advancedPolicyUpdate
        }, { onConflict: 'id' })
        .select()
        .maybeSingle();
      
      if (!res2.error) {
        data = res2.data;
        error = null;
      } else {
        error = res2.error;
      }
    }

    // Attempt 3: If Attempt 2 failed (e.g. flexible_breaks missing), retry with Baseline ONLY
    if (error) {
      console.warn('[Tenant Settings] Attempt 2 failed, retrying Attempt 3 (Guaranteed Baseline ONLY):', error.message);
      const res3 = await supabase
        .from('tenants')
        .upsert(baselineUpdate, { onConflict: 'id' })
        .select()
        .maybeSingle();
      
      if (!res3.error) {
        data = res3.data;
        error = null;
      } else {
        error = res3.error;
      }
    }

    if (error) {
      console.error('[Tenant Settings] Error saving settings across all attempts:', error);
      return NextResponse.json({ error: error.message || 'Failed to save settings' }, { status: 500 });
    }

    return NextResponse.json({ success: true, tenant: data });
  } catch (error: any) {
    console.error('[Tenant Settings] Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
