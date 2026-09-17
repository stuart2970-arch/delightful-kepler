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
    let user = (await supabase.auth.getUser()).data?.user;

    // Fallback to Bearer token in Authorization header if cookies are blocked
    if (!user) {
      const authHeader = request.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        const { data: userData } = await supabase.auth.getUser(token);
        if (userData?.user) {
          user = userData.user;
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { tenant_id, area_code, number_type } = body;

    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
    }

    // Verify tenant ownership
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('tenant_id, is_super_admin')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || (!profile.is_super_admin && profile.tenant_id !== tenant_id)) {
      return NextResponse.json({ error: 'Unauthorized to provision for this tenant' }, { status: 403 });
    }

    // Fetch tenant channel flags to know if they have landline vs mobile
    const { data: tenant } = await supabase
      .from('tenants')
      .select('has_landline, has_mobile')
      .eq('id', tenant_id)
      .single();

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      console.error('[Telephony Provisioning] Missing Twilio credentials');
      return NextResponse.json({ error: 'Telephony provisioning is not configured' }, { status: 500 });
    }

    const client = twilio(accountSid, authToken);

    // Determine target number category (local vs mobile)
    // Preference: explicit number_type > area_code implies local > tenant landline flag > tenant mobile flag > local default
    let isMobile = number_type === 'mobile';
    if (!number_type) {
      if (area_code) {
        isMobile = false;
      } else if (tenant?.has_mobile && !tenant?.has_landline) {
        isMobile = true;
      } else {
        isMobile = false; // default to local landline
      }
    }

    const primaryCountry = process.env.TWILIO_PHONE_COUNTRY || 'GB';
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.styleflo.ai';
    const addressSid = process.env.TWILIO_ADDRESS_SID;

    // Support separate bundle SIDs for mobile vs local regulatory compliance
    const bundleSidLocal = process.env.TWILIO_BUNDLE_SID_LOCAL || process.env.TWILIO_LOCAL_BUNDLE_SID || process.env.TWILIO_BUNDLE_SID;
    const bundleSidMobile = process.env.TWILIO_BUNDLE_SID_MOBILE || process.env.TWILIO_MOBILE_BUNDLE_SID || process.env.TWILIO_BUNDLE_SID;
    const bundleSid = isMobile ? bundleSidMobile : bundleSidLocal;

    let purchasedNumber: any = null;

    async function tryPurchaseNumber(country: string) {
      let available: any[] = [];

      if (isMobile) {
        console.log(`[Telephony Provisioning] Searching mobile numbers for country: ${country}`);
        available = await client.availablePhoneNumbers(country).mobile.list({ limit: 1 });
      } else {
        const searchParams: any = { limit: 1 };
        if (area_code) {
          // Clean leading zero for UK local codes (e.g. 0151 -> 151, 01925 -> 1925)
          const cleanCode = area_code.replace(/^0+/, '');
          searchParams.areaCode = cleanCode;
        }
        console.log(`[Telephony Provisioning] Searching local numbers for country: ${country}`, searchParams);
        available = await client.availablePhoneNumbers(country).local.list(searchParams);

        // Fall back to general local numbers if specified area code had 0 available
        if ((!available || available.length === 0) && area_code) {
          console.log(`[Telephony Provisioning] No numbers for area code ${area_code}, falling back to any local number`);
          available = await client.availablePhoneNumbers(country).local.list({ limit: 1 });
        }
      }

      if (!available || available.length === 0) {
        throw new Error(`No ${isMobile ? 'mobile' : 'local'} phone numbers available for country: ${country}`);
      }

      const purchaseParams: any = {
        phoneNumber: available[0].phoneNumber,
        voiceUrl: `${appBaseUrl}/api/telephony/inbound`,
        voiceMethod: 'POST',
      };

      if (addressSid && !isMobile) purchaseParams.addressSid = addressSid;
      if (bundleSid) purchaseParams.bundleSid = bundleSid;

      console.log(`[Telephony Provisioning] Purchasing number ${available[0].phoneNumber} with bundle ${bundleSid || 'none'}`);
      return await client.incomingPhoneNumbers.create(purchaseParams);
    }

    try {
      // Attempt primary country purchase (e.g. GB)
      purchasedNumber = await tryPurchaseNumber(primaryCountry);
    } catch (primaryErr: any) {
      console.error(`[Telephony Provisioning] Failed to purchase ${primaryCountry} number:`, primaryErr.message);
      const bundleType = isMobile ? 'TWILIO_BUNDLE_SID_MOBILE' : 'TWILIO_BUNDLE_SID_LOCAL';
      return NextResponse.json({
        error: `Failed to purchase ${primaryCountry} ${isMobile ? 'mobile' : 'local'} number: ${primaryErr.message}. (Ensure ${bundleType} or TWILIO_BUNDLE_SID is configured).`
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
