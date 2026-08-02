import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
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

export async function POST(request: Request) {
  try {
    const supabase = await getSupabaseAuthClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenant_id } = await request.json();

    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
    }

    // Verify tenant ownership
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .eq('tenant_id', tenant_id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Unauthorized to provision for this tenant' }, { status: 403 });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      console.error('[Telephony Provisioning] Missing Twilio credentials');
      return NextResponse.json({ error: 'Telephony provisioning is not configured' }, { status: 500 });
    }

    const client = twilio(accountSid, authToken);

    // 1. Search and purchase phone number
    const primaryCountry = process.env.TWILIO_PHONE_COUNTRY || 'GB';
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.styleflo.ai';
    const addressSid = process.env.TWILIO_ADDRESS_SID;
    const bundleSid = process.env.TWILIO_BUNDLE_SID;

    let purchasedNumber: any = null;

    async function tryPurchaseNumber(country: string) {
      const isGB = country === 'GB';
      const available = isGB 
        ? await client.availablePhoneNumbers(country).mobile.list({ limit: 1 })
        : await client.availablePhoneNumbers(country).local.list({ limit: 1 });

      if (!available || available.length === 0) {
        throw new Error(`No phone numbers available for country: ${country}`);
      }

      const purchaseParams: any = {
        phoneNumber: available[0].phoneNumber,
        voiceUrl: `${appBaseUrl}/api/telephony/inbound`,
        voiceMethod: 'POST',
      };

      if (addressSid) purchaseParams.addressSid = addressSid;
      if (bundleSid) purchaseParams.bundleSid = bundleSid;

      return await client.incomingPhoneNumbers.create(purchaseParams);
    }

    try {
      // Attempt primary country purchase (e.g. GB)
      purchasedNumber = await tryPurchaseNumber(primaryCountry);
    } catch (primaryErr: any) {
      console.error(`[Telephony Provisioning] Failed to purchase ${primaryCountry} number:`, primaryErr.message);
      // Return exact error message so user can see why Twilio rejected the UK bundle or credentials
      return NextResponse.json({
        error: `Failed to purchase ${primaryCountry} number: ${primaryErr.message}. (Ensure TWILIO_BUNDLE_SID is set in Google Cloud Run env vars).`
      }, { status: 400 });
    }

    // 2.5. Automatically import and link this number to Vapi!
    // Since Vapi no longer supports direct TwiML WebSocket streams from Twilio, we must register the number in Vapi.
    const vapiPrivateKey = process.env.VAPI_PRIVATE_API_KEY;
    const vapiAssistantId = process.env.VAPI_MASTER_ASSISTANT_ID;

    if (vapiPrivateKey && vapiAssistantId) {
      console.log('[Telephony Provisioning] Importing Twilio number into Vapi...');
      try {
        const vapiRes = await fetch('https://api.vapi.ai/phone-number', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${vapiPrivateKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            provider: 'twilio',
            number: purchasedNumber.phoneNumber,
            twilioAccountSid: accountSid,
            twilioAuthToken: authToken,
            assistantId: vapiAssistantId,
            serverUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.styleflo.ai'}/api/webhooks/vapi/assistant`,
            name: `StyleFlo Tenant ${tenant_id}`
          })
        });
        
        if (!vapiRes.ok) {
          const vapiErr = await vapiRes.text();
          console.error('[Telephony Provisioning] Failed to import into Vapi:', vapiErr);
          // We don't fail the whole request, but it means it won't route correctly until fixed.
        } else {
          console.log('[Telephony Provisioning] Successfully linked number to Vapi Assistant!');
        }
      } catch (err) {
        console.error('[Telephony Provisioning] Vapi import request failed:', err);
      }
    } else {
      console.warn('[Telephony Provisioning] VAPI_PRIVATE_API_KEY or VAPI_MASTER_ASSISTANT_ID missing, skipping Vapi registration.');
    }

    // 3. Save it to Supabase
    const { error: updateError } = await supabase
      .from('tenants')
      .update({ twilio_shadow_number: purchasedNumber.phoneNumber })
      .eq('id', tenant_id);

    if (updateError) {
      console.error('[Telephony Provisioning] Error updating tenant in Supabase:', updateError);
      return NextResponse.json({ error: 'Failed to save number to database' }, { status: 500 });
    }

    return NextResponse.json({ success: true, number: purchasedNumber.phoneNumber });
  } catch (error: any) {
    console.error('[Telephony Provisioning API] Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
