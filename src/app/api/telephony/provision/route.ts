import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import twilio from 'twilio';
import { evaluateVoiceGate, getVapiPrivateKey, requireConfiguredAppUrl } from '@/lib/env/vapi-config';
import {
  buildVapiPhoneImportPayload,
  importTwilioNumberToVapi,
  releaseTwilioIncomingNumber,
  tenantHasExistingNumber,
  tenantHasPaidPhoneAddon,
  verifyVapiPrivateKeyWorks,
} from '@/lib/telephony/provision-safety';

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
    const { tenant_id, area_code, number_type, phone_number } = body;

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

    const voiceGate = evaluateVoiceGate();
    if (!voiceGate.allowed) {
      return NextResponse.json({ error: voiceGate.reason }, { status: 403 });
    }

    const appUrlResult = requireConfiguredAppUrl();
    if (!appUrlResult.ok) {
      return NextResponse.json({ error: appUrlResult.error }, { status: 500 });
    }
    const appBaseUrl = appUrlResult.url;
    const webhookSecret = (process.env.VAPI_WEBHOOK_SECRET || '').trim();
    if (!webhookSecret) {
      return NextResponse.json({ error: 'VAPI_WEBHOOK_SECRET is not configured.' }, { status: 500 });
    }

    // Fetch tenant channel flags and any existing numbers
    const { data: tenant } = await supabase
      .from('tenants')
      .select('has_landline, has_mobile, twilio_shadow_number, twilio_mobile_number')
      .eq('id', tenant_id)
      .single();

    if (tenantHasExistingNumber(tenant)) {
      return NextResponse.json(
        { error: 'This tenant already has a phone number. Number purchase is buy-once.' },
        { status: 409 },
      );
    }

    const { data: addonRows } = await supabase
      .from('tenant_active_addons')
      .select('addon_catalog_id, is_active, price_paid_pence')
      .eq('tenant_id', tenant_id)
      .in('addon_catalog_id', ['landline_addon', 'mobile_addon']);

    if (!tenantHasPaidPhoneAddon(addonRows)) {
      return NextResponse.json(
        { error: 'An active paid landline or mobile bolt-on is required before buying a number.' },
        { status: 403 },
      );
    }

    const vapiKeyCheck = await verifyVapiPrivateKeyWorks();
    if (!vapiKeyCheck.ok) {
      return NextResponse.json({ error: vapiKeyCheck.error }, { status: 502 });
    }

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
    const addressSid = process.env.TWILIO_ADDRESS_SID_LOCAL || process.env.TWILIO_ADDRESS_SID;

    // Support separate bundle SIDs for mobile vs local regulatory compliance
    const bundleSidLocal = process.env.TWILIO_BUNDLE_SID_LOCAL || process.env.TWILIO_LOCAL_BUNDLE_SID || process.env.TWILIO_BUNDLE_SID;
    const bundleSidMobile = process.env.TWILIO_BUNDLE_SID_MOBILE || process.env.TWILIO_MOBILE_BUNDLE_SID || process.env.TWILIO_BUNDLE_SID;
    const bundleSid = isMobile ? bundleSidMobile : bundleSidLocal;

    let purchasedNumber: any = null;

    async function tryPurchaseNumber(country: string) {
      let targetPhoneNumber = phone_number;

      if (!targetPhoneNumber) {
        let available: any[] = [];

        if (isMobile) {
          console.log(`[Telephony Provisioning] Searching mobile numbers for country: ${country}`);
          available = await client.availablePhoneNumbers(country).mobile.list({ limit: 1 });
        } else {
          const cleanCode = area_code
            ? area_code.toString().trim().replace(/^(\+44|0044|0)+/, '').replace(/[\s-]/g, '')
            : '';

          if (cleanCode) {
            const searchPattern = `+44${cleanCode}*`;
            console.log(`[Telephony Provisioning] Searching local numbers matching pattern ${searchPattern} for country: ${country}`);
            const rawList = await client.availablePhoneNumbers(country).local.list({
              contains: searchPattern,
              limit: 5,
            });
            available = (rawList || []).filter((num: any) =>
              num.phoneNumber && num.phoneNumber.startsWith(`+44${cleanCode}`)
            );

            if (!available || available.length === 0) {
              throw new Error(`No phone numbers are currently available for area code ${area_code}. Please choose an available number from the list or try another area code.`);
            }
          } else {
            console.log(`[Telephony Provisioning] Searching general local numbers for country: ${country}`);
            available = await client.availablePhoneNumbers(country).local.list({ limit: 1 });
          }
        }

        if (!available || available.length === 0) {
          throw new Error(`No ${isMobile ? 'mobile' : 'local'} phone numbers available for country: ${country}`);
        }
        targetPhoneNumber = available[0].phoneNumber;
      }

      const purchaseParams: any = {
        phoneNumber: targetPhoneNumber,
        voiceUrl: `${appBaseUrl}/api/telephony/inbound`,
        voiceMethod: 'POST',
        smsUrl: `${appBaseUrl}/api/telephony/sms`,
        smsMethod: 'POST',
      };

      let resolvedAddressSid = addressSid;

      // Twilio requires an AddressSid for UK geographic/local numbers (addressRequirements: local).
      // If bundleSid is present, we automatically resolve the approved address assigned directly to that bundle
      // to guarantee a 100% match, preventing both "AddressSid parameter was empty" and "Address not contained in bundle".
      if (!isMobile && bundleSid) {
        try {
          const itemAssignments = await client.numbers.v2.regulatoryCompliance.bundles(bundleSid).itemAssignments.list();
          for (const item of itemAssignments) {
            if (item.objectSid && item.objectSid.startsWith('RD')) {
              const doc = await client.numbers.v2.regulatoryCompliance.supportingDocuments(item.objectSid).fetch();
              if (doc.attributes && Array.isArray((doc.attributes as any).address_sids) && (doc.attributes as any).address_sids.length > 0) {
                resolvedAddressSid = (doc.attributes as any).address_sids[0];
                break;
              }
            }
          }
        } catch (err: any) {
          console.warn('[Telephony Provisioning] Could not query bundle items, falling back to configured address:', err.message);
        }
      }

      if (resolvedAddressSid && !isMobile) purchaseParams.addressSid = resolvedAddressSid;
      if (bundleSid) purchaseParams.bundleSid = bundleSid;

      console.log(`[Telephony Provisioning] Purchasing number ${targetPhoneNumber} with bundle ${bundleSid || 'none'} and address ${purchaseParams.addressSid || 'none'}`);
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

    const vapiPrivateKey = getVapiPrivateKey();
    const importPayload = buildVapiPhoneImportPayload({
      phoneNumber: purchasedNumber.phoneNumber,
      twilioAccountSid: accountSid,
      twilioAuthToken: authToken,
      tenantId: tenant_id,
      appUrl: appBaseUrl,
      webhookSecret,
    });
    const imported = await importTwilioNumberToVapi({
      payload: importPayload,
      apiKey: vapiPrivateKey,
    });
    if (!imported.ok) {
      console.error('[Telephony Provisioning] Vapi import failed; releasing Twilio number', {
        sid: purchasedNumber.sid,
        number: purchasedNumber.phoneNumber,
      });
      try {
        await releaseTwilioIncomingNumber(client, purchasedNumber.sid);
      } catch {
        console.error('[Telephony Provisioning] Failed to release Twilio number after Vapi import error', {
          sid: purchasedNumber.sid,
        });
      }
      return NextResponse.json(
        { error: imported.error || 'Failed to import number into Vapi. The Twilio number was released.' },
        { status: 502 },
      );
    }

    // 3. Save it to Supabase
    const updateData = isMobile
      ? { twilio_mobile_number: purchasedNumber.phoneNumber }
      : { twilio_shadow_number: purchasedNumber.phoneNumber, twilio_mobile_number: purchasedNumber.phoneNumber };

    const { error: updateError } = await supabase
      .from('tenants')
      .update(updateData)
      .eq('id', tenant_id);

    if (updateError) {
      console.error('[Telephony Provisioning] Error updating tenant in Supabase:', updateError);
      return NextResponse.json({ error: 'Failed to save number to database' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      number: purchasedNumber.phoneNumber,
      number_type: isMobile ? 'mobile' : 'local' 
    });
  } catch (error: any) {
    console.error('[Telephony Provisioning API] Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
