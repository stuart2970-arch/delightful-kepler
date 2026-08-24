import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

async function getSupabaseAuthClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase environment variables are missing');
  }

  return createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Safe to ignore in Server Components
        }
      },
    },
  });
}

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
    const body = await request.json();
    const { tenant_id, confirmed_downgrade } = body;

    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
    }

    // Check authorization: user cookie session OR admin secret header
    let isAuthorized = false;
    const authHeader = request.headers.get('Authorization');
    const cronSecret = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (authHeader && cronSecret && authHeader === `Bearer ${cronSecret}`) {
      isAuthorized = true;
    } else {
      const supabase = await getSupabaseAuthClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (user && !authError) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('id', user.id)
          .eq('tenant_id', tenant_id)
          .single();
        if (profile) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized to deprovision this tenant' }, { status: 403 });
    }

    const adminSupabase = getSupabaseAdmin();

    // 1. Get current shadow number from tenant
    const { data: tenant, error: tenantError } = await adminSupabase
      .from('tenants')
      .select('id, twilio_shadow_number')
      .eq('id', tenant_id)
      .single();

    if (tenantError || !tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const numberToRelease = tenant.twilio_shadow_number;
    if (!numberToRelease) {
      return NextResponse.json({ success: true, message: 'No phone number currently provisioned for this tenant' });
    }

    console.log(`[Telephony Deprovisioning] Releasing number ${numberToRelease} for tenant ${tenant_id}...`);

    // 2. Delete / Release number from Twilio
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (accountSid && authToken) {
      try {
        const client = twilio(accountSid, authToken);
        const incomingNumbers = await client.incomingPhoneNumbers.list({ phoneNumber: numberToRelease, limit: 1 });
        if (incomingNumbers && incomingNumbers.length > 0) {
          const sid = incomingNumbers[0].sid;
          await client.incomingPhoneNumbers(sid).remove();
          console.log(`[Telephony Deprovisioning] Successfully released Twilio number SID: ${sid}`);
        } else {
          console.warn(`[Telephony Deprovisioning] Number ${numberToRelease} not found in Twilio account.`);
        }
      } catch (err: any) {
        console.error('[Telephony Deprovisioning] Error releasing number from Twilio:', err.message);
      }
    }

    // 3. Delete number from Vapi
    const vapiPrivateKey = process.env.VAPI_PRIVATE_API_KEY;
    if (vapiPrivateKey) {
      try {
        const listRes = await fetch('https://api.vapi.ai/phone-number', {
          headers: { 'Authorization': `Bearer ${vapiPrivateKey}` }
        });
        if (listRes.ok) {
          const vapiNumbers: any[] = await listRes.json();
          const target = vapiNumbers.find((n: any) => n.number === numberToRelease || n.number === numberToRelease.replace('+', ''));
          if (target && target.id) {
            const delRes = await fetch(`https://api.vapi.ai/phone-number/${target.id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${vapiPrivateKey}` }
            });
            if (delRes.ok) {
              console.log(`[Telephony Deprovisioning] Successfully deleted number ${target.id} from Vapi.`);
            } else {
              console.error('[Telephony Deprovisioning] Failed to delete number from Vapi:', await delRes.text());
            }
          }
        }
      } catch (err: any) {
        console.error('[Telephony Deprovisioning] Error cleaning up Vapi number:', err.message);
      }
    }

    // 4. Reset twilio_shadow_number in Supabase
    const { error: clearError } = await adminSupabase
      .from('tenants')
      .update({ twilio_shadow_number: null })
      .eq('id', tenant_id);

    if (clearError) {
      console.error('[Telephony Deprovisioning] Error clearing tenant shadow number in Supabase:', clearError);
      return NextResponse.json({ error: 'Failed to update database' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      releasedNumber: numberToRelease,
      message: `Phone number ${numberToRelease} has been permanently released and deprovisioned.`
    });
  } catch (error: any) {
    console.error('[Telephony Deprovisioning API] Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
