import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireTenantRole } from '@/lib/auth/require-tenant-role';
import { openingHoursForSave, mergeHolidaySettings } from '@/lib/opening-hours';

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireTenantRole(req, ['owner', 'admin']);
    if (!auth.ok) return auth.response;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('[Tenant Settings] Missing Supabase environment variables');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    // Membership decides the row. requireTenantRole rejects a body tenantId
    // that is not this user's tenant (superadmins may name one). Never pick
    // the first tenant when the body omits an id.
    const tenantId = auth.tenantId;
    let { 
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
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (general_operating_hours !== undefined) {
      general_operating_hours = openingHoursForSave(general_operating_hours);
    }

    const phoneKeys = [
      'twilio_shadow_number',
      'twilioShadowNumber',
      'twilio_mobile_number',
      'twilioMobileNumber',
    ];
    if (!auth.isSuperAdmin && phoneKeys.some((key) => body[key] !== undefined && body[key] !== null)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Merge onto the stored holiday JSON. Stamp accepted-by and accepted-at
    // only when acceptance changes from false or missing to true.
    let stampedHolidaySettings: Record<string, unknown> | undefined;
    if (holiday_settings !== undefined) {
      const { data: storedTenant } = await supabase
        .from('tenants')
        .select('holiday_settings')
        .eq('id', tenantId)
        .maybeSingle();
      stampedHolidaySettings = mergeHolidaySettings(
        storedTenant?.holiday_settings,
        holiday_settings,
        auth.email,
        new Date().toISOString(),
      );
    }

    // Tier 1: Core Base Fields (Guaranteed in all Supabase schemas)
    const baselineUpdate: Record<string, any> = {
      ...(domain !== undefined && { domain: domain ? domain.trim() : null }),
      ...(bookingMode !== undefined && { booking_mode: bookingMode }),
      ...(bookingUrl !== undefined && { booking_url: bookingUrl }),
      ...(general_operating_hours !== undefined && { general_operating_hours }),
      ...(body.twilio_shadow_number !== undefined && { twilio_shadow_number: body.twilio_shadow_number }),
      ...(body.twilioShadowNumber !== undefined && { twilio_shadow_number: body.twilioShadowNumber }),
      ...(body.twilio_mobile_number !== undefined && { twilio_mobile_number: body.twilio_mobile_number }),
      ...(body.twilioMobileNumber !== undefined && { twilio_mobile_number: body.twilioMobileNumber }),
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
      ...(stampedHolidaySettings !== undefined && { holiday_settings: stampedHolidaySettings }),
      ...((flexible_breaks !== undefined || flexibleBreaks !== undefined) && { flexible_breaks: flexible_breaks ?? flexibleBreaks }),
      ...((is_24_7 !== undefined || is247 !== undefined) && { is_24_7: is_24_7 ?? is247 }),
      ...((open_public_holidays !== undefined || openPublicHolidays !== undefined) && { open_public_holidays: open_public_holidays ?? openPublicHolidays }),
      ...((max_advance_weeks !== undefined || maxAdvanceWeeks !== undefined) && { max_advance_weeks: max_advance_weeks ?? maxAdvanceWeeks }),
      ...(body.voice_auto_topup !== undefined && { voice_auto_topup: body.voice_auto_topup }),
      ...(body.voiceAutoTopup !== undefined && { voice_auto_topup: body.voiceAutoTopup }),
      ...(body.voice_auto_topup_threshold !== undefined && { voice_auto_topup_threshold: body.voice_auto_topup_threshold }),
      ...(body.voiceAutoTopupThreshold !== undefined && { voice_auto_topup_threshold: body.voiceAutoTopupThreshold }),
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

    // Check if tenant row exists in database
    const { data: existingTenant } = await supabase
      .from('tenants')
      .select('id, company_name')
      .eq('id', tenantId)
      .maybeSingle();

    if (existingTenant) {
      // Row EXISTS -> Execute UPDATE (does NOT trigger company_name NOT NULL requirement)
      let { data, error } = await supabase
        .from('tenants')
        .update({
          ...baselineUpdate,
          ...advancedPolicyUpdate,
          ...extendedAddressUpdate
        })
        .eq('id', tenantId)
        .select()
        .maybeSingle();

      if (error) {
        console.warn('[Tenant Settings] Update Attempt 1 failed, retrying Attempt 2:', error.message);
        const res2 = await supabase
          .from('tenants')
          .update({
            ...baselineUpdate,
            ...advancedPolicyUpdate
          })
          .eq('id', tenantId)
          .select()
          .maybeSingle();

        if (!res2.error) {
          data = res2.data;
          error = null;
        } else {
          error = res2.error;
        }
      }

      if (error) {
        console.warn('[Tenant Settings] Update Attempt 2 failed, retrying Attempt 3 (Guaranteed Baseline ONLY):', error.message);
        const res3 = await supabase
          .from('tenants')
          .update(baselineUpdate)
          .eq('id', tenantId)
          .select()
          .maybeSingle();

        if (!res3.error) {
          data = res3.data;
          error = null;
        } else {
          error = res3.error;
        }
      }

      if (!error) {
        return NextResponse.json({ success: true, tenant: data });
      }
    }

    // Row does NOT exist -> Execute UPSERT with company_name fallback
    const company_name = body.company_name || body.companyName || 'StyleFlo Business';
    const fullUpsert = {
      id: tenantId,
      tenant_id: tenantId,
      company_name,
      ...baselineUpdate,
      ...advancedPolicyUpdate,
      ...extendedAddressUpdate
    };

    let { data, error } = await supabase
      .from('tenants')
      .upsert(fullUpsert, { onConflict: 'id' })
      .select()
      .maybeSingle();

    if (error) {
      console.warn('[Tenant Settings] Upsert Attempt 1 failed, retrying Attempt 2:', error.message);
      const res2 = await supabase
        .from('tenants')
        .upsert({
          id: tenantId,
          tenant_id: tenantId,
          company_name,
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

    if (error) {
      console.warn('[Tenant Settings] Upsert Attempt 2 failed, retrying Attempt 3 (Guaranteed Baseline ONLY):', error.message);
      const res3 = await supabase
        .from('tenants')
        .upsert({
          id: tenantId,
          tenant_id: tenantId,
          company_name,
          ...baselineUpdate
        }, { onConflict: 'id' })
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
