import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// We use the service role to update the tenant since the user might be an admin of the tenant
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(req: NextRequest) {
  try {
    const { tenantId, bookingMode, bookingUrl } = await req.json();

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('tenants')
      .update({
        booking_mode: bookingMode,
        booking_url: bookingUrl
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
