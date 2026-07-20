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
      bookingMode, 
      bookingUrl,
      general_operating_hours,
      operating_hours_overrides,
      holiday_settings
    } = body;

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('tenants')
      .update({
        ...(bookingMode !== undefined && { booking_mode: bookingMode }),
        ...(bookingUrl !== undefined && { booking_url: bookingUrl }),
        ...(general_operating_hours !== undefined && { general_operating_hours }),
        ...(operating_hours_overrides !== undefined && { operating_hours_overrides }),
        ...(holiday_settings !== undefined && { holiday_settings }),
      })
      .eq('id', tenantId)
      .select()
      .single();

    if (error) {
      console.error('[Tenant Settings] Error updating:', error);
      return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }

    return NextResponse.json({ success: true, tenant: data });
  } catch (error) {
    console.error('[Tenant Settings] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
