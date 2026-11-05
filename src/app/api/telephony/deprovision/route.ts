import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireTenantRole } from '@/lib/auth/require-tenant-role';
import { recordSuperadminAudit } from '@/lib/auth/superadmin-audit';
import {
  isInternalCronRequest,
  releaseTwilioNumber,
  releaseVapiNumber,
  telephonyReleaseCallLog,
} from '@/lib/telephony/release-vendors';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase admin environment variables are missing');
  }
  return createClient(supabaseUrl, serviceKey);
}

export async function POST(request: Request) {
  try {
    const cronAuthorized = isInternalCronRequest(request);
    let tenantId: string | undefined;
    let actor = 'cron';

    if (cronAuthorized) {
      const body = await request.clone().json().catch(() => ({}));
      tenantId = typeof body?.tenant_id === 'string' ? body.tenant_id : undefined;
      if (!tenantId) {
        return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
      }
    } else {
      const auth = await requireTenantRole(request, ['owner']);
      if (!auth.ok) return auth.response;
      tenantId = auth.tenantId;
      actor = auth.isSuperAdmin ? 'superadmin' : 'owner';
      if (auth.isSuperAdmin) {
        recordSuperadminAudit({
          action: 'telephony_deprovision',
          userId: auth.userId,
          tenantId,
          detail: { role: auth.role },
        });
      }
    }

    const body = await request.json().catch(() => ({}));
    const { confirmed_downgrade, number_type } = body;
    const isMobile = number_type === 'mobile';
    void confirmed_downgrade;

    const adminSupabase = getSupabaseAdmin();

    const { data: tenant, error: tenantError } = await adminSupabase
      .from('tenants')
      .select('id, twilio_shadow_number, twilio_mobile_number')
      .eq('id', tenantId)
      .single();

    if (tenantError || !tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const numberToRelease = isMobile ? tenant.twilio_mobile_number : tenant.twilio_shadow_number;
    if (!numberToRelease) {
      return NextResponse.json({
        success: true,
        message: `No ${isMobile ? 'mobile' : 'landline'} phone number currently provisioned for this tenant`,
      });
    }

    console.log(`[Telephony Deprovisioning] Releasing number ${numberToRelease} for tenant ${tenantId} (${actor})...`);

    try {
      await releaseTwilioNumber(numberToRelease);
    } catch (err: any) {
      console.error('[Telephony Deprovisioning] Error releasing number from Twilio:', err.message);
    }

    try {
      await releaseVapiNumber(numberToRelease);
    } catch (err: any) {
      console.error('[Telephony Deprovisioning] Error cleaning up Vapi number:', err.message);
    }

    telephonyReleaseCallLog.dbClear += 1;
    const isSame = tenant.twilio_shadow_number && tenant.twilio_mobile_number && tenant.twilio_shadow_number === tenant.twilio_mobile_number;
    const clearPayload = isSame
      ? { twilio_shadow_number: null, twilio_mobile_number: null }
      : isMobile ? { twilio_mobile_number: null } : { twilio_shadow_number: null };
    const { error: clearError } = await adminSupabase
      .from('tenants')
      .update(clearPayload)
      .eq('id', tenantId);

    if (clearError) {
      console.error('[Telephony Deprovisioning] Error clearing tenant number in Supabase:', clearError);
      return NextResponse.json({ error: 'Failed to update database' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      releasedNumber: numberToRelease,
      message: `Phone number ${numberToRelease} has been permanently released and deprovisioned.`,
    });
  } catch (error: any) {
    console.error('[Telephony Deprovisioning API] Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
