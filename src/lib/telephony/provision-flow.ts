import { NextResponse } from 'next/server';
import { evaluateVoiceGate, getVapiPrivateKey, requireConfiguredAppUrl } from '@/lib/env/vapi-config';
import {
  buildVapiPhoneImportPayload,
  clearTenantPhonePurchase,
  deleteVapiPhoneNumber,
  importTwilioNumberToVapi,
  markTenantPhonePurchaseActive,
  recordOrphanedPhonePurchase,
  releaseTwilioIncomingNumber,
  reserveTenantPhonePurchase,
  tenantHasExistingNumber,
  tenantHasPaidPhoneAddon,
  verifyVapiPrivateKeyWorks,
} from '@/lib/telephony/provision-safety';

export type ProvisionQueryResult<T> = { data: T; error: { message?: string; code?: string } | null };

export type ProvisionQuery = {
  select: (columns: string) => ProvisionQuery;
  eq: (column: string, value: string) => ProvisionQuery;
  in: (column: string, values: string[]) => ProvisionQuery;
  single: () => Promise<ProvisionQueryResult<any>>;
  then: Promise<ProvisionQueryResult<any>>['then'];
  insert: (row: Record<string, unknown>) => Promise<{ error: { code?: string; message?: string } | null }>;
  update: (row: Record<string, unknown>) => {
    eq: (column: string, value: string) => Promise<{ error: { message?: string } | null }>;
  };
  delete: () => {
    eq: (column: string, value: string) => Promise<{ error: { message?: string } | null }>;
  };
};

export type ProvisionSupabase = {
  from: (table: string) => ProvisionQuery;
  auth?: {
    getUser: (token?: string) => Promise<{ data?: { user?: { id: string } | null } }>;
  };
};

export type ProvisionTwilioNumber = {
  sid: string;
  phoneNumber: string;
};

export type ProvisionTwilioClient = {
  availablePhoneNumbers: (country: string) => {
    mobile: { list: (opts: { limit: number }) => Promise<Array<{ phoneNumber: string }>> };
    local: { list: (opts: { limit: number; contains?: string }) => Promise<Array<{ phoneNumber: string }>> };
  };
  incomingPhoneNumbers: {
    create: (params: Record<string, unknown>) => Promise<ProvisionTwilioNumber>;
  } & ((sid: string) => { remove: () => Promise<unknown> });
  numbers?: {
    v2: {
      regulatoryCompliance: {
        bundles: (sid: string) => {
          itemAssignments: { list: () => Promise<Array<{ objectSid?: string }>> };
        };
        supportingDocuments: (sid: string) => {
          fetch: () => Promise<{ attributes?: { address_sids?: string[] } }>;
        };
      };
    };
  };
};

export type ProvisionDeps = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  getUser: (request: Request) => Promise<{ id: string } | null>;
  userSupabase: ProvisionSupabase;
  adminSupabase: ProvisionSupabase;
  createTwilio: (accountSid: string, authToken: string) => ProvisionTwilioClient;
};

export async function handleProvisionPost(
  request: Request,
  deps: ProvisionDeps,
): Promise<NextResponse> {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || fetch;

  try {
    const user = await deps.getUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { tenant_id, area_code, number_type, phone_number } = body;

    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
    }

    const { data: profile, error: profileError } = await deps.userSupabase
      .from('profiles')
      .select('tenant_id, is_super_admin')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || (!profile.is_super_admin && profile.tenant_id !== tenant_id)) {
      return NextResponse.json({ error: 'Unauthorized to provision for this tenant' }, { status: 403 });
    }

    const voiceGate = evaluateVoiceGate(env);
    if (!voiceGate.allowed) {
      return NextResponse.json({ error: voiceGate.reason }, { status: 403 });
    }

    const appUrlResult = requireConfiguredAppUrl(env);
    if (!appUrlResult.ok) {
      return NextResponse.json({ error: appUrlResult.error }, { status: 500 });
    }
    const appBaseUrl = appUrlResult.url;
    const webhookSecret = (env.VAPI_WEBHOOK_SECRET || '').trim();
    if (!webhookSecret) {
      return NextResponse.json({ error: 'VAPI_WEBHOOK_SECRET is not configured.' }, { status: 500 });
    }

    const { data: tenant } = await deps.userSupabase
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

    const reserved = await reserveTenantPhonePurchase(deps.adminSupabase, tenant_id);
    if (!reserved.ok) {
      return NextResponse.json({ error: reserved.error }, { status: reserved.status });
    }

    const releaseReservation = async () => {
      await clearTenantPhonePurchase(deps.adminSupabase, tenant_id);
    };

    try {
      const { data: addonRows } = await deps.userSupabase
        .from('tenant_active_addons')
        .select('addon_catalog_id, is_active, subscription_status, price_paid_pence')
        .eq('tenant_id', tenant_id)
        .in('addon_catalog_id', ['landline_addon', 'mobile_addon']);

      if (!tenantHasPaidPhoneAddon(addonRows)) {
        await releaseReservation();
        return NextResponse.json(
          { error: 'An active paid landline or mobile bolt-on is required before buying a number.' },
          { status: 403 },
        );
      }

      const vapiKeyCheck = await verifyVapiPrivateKeyWorks(env, fetchImpl);
      if (!vapiKeyCheck.ok) {
        await releaseReservation();
        return NextResponse.json({ error: vapiKeyCheck.error }, { status: 502 });
      }

      const accountSid = env.TWILIO_ACCOUNT_SID;
      const authToken = env.TWILIO_AUTH_TOKEN;
      if (!accountSid || !authToken) {
        await releaseReservation();
        return NextResponse.json({ error: 'Telephony provisioning is not configured' }, { status: 500 });
      }

      const client = deps.createTwilio(accountSid, authToken);

      let isMobile = number_type === 'mobile';
      if (!number_type) {
        if (area_code) {
          isMobile = false;
        } else if (tenant?.has_mobile && !tenant?.has_landline) {
          isMobile = true;
        } else {
          isMobile = false;
        }
      }

      const primaryCountry = env.TWILIO_PHONE_COUNTRY || 'GB';
      const addressSid = env.TWILIO_ADDRESS_SID_LOCAL || env.TWILIO_ADDRESS_SID;
      const bundleSidLocal = env.TWILIO_BUNDLE_SID_LOCAL || env.TWILIO_LOCAL_BUNDLE_SID || env.TWILIO_BUNDLE_SID;
      const bundleSidMobile = env.TWILIO_BUNDLE_SID_MOBILE || env.TWILIO_MOBILE_BUNDLE_SID || env.TWILIO_BUNDLE_SID;
      const bundleSid = isMobile ? bundleSidMobile : bundleSidLocal;

      let purchasedNumber: ProvisionTwilioNumber;
      try {
        purchasedNumber = await purchaseTwilioNumber({
          client,
          country: primaryCountry,
          isMobile,
          area_code,
          phone_number,
          appBaseUrl,
          addressSid,
          bundleSid,
        });
      } catch (primaryErr: any) {
        await releaseReservation();
        const bundleType = isMobile ? 'TWILIO_BUNDLE_SID_MOBILE' : 'TWILIO_BUNDLE_SID_LOCAL';
        return NextResponse.json({
          error: `Failed to purchase ${primaryCountry} ${isMobile ? 'mobile' : 'local'} number: ${primaryErr.message}. (Ensure ${bundleType} or TWILIO_BUNDLE_SID is configured).`,
        }, { status: 400 });
      }

      const vapiPrivateKey = getVapiPrivateKey(env);
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
        fetchImpl,
      });

      if (!imported.ok) {
        return unwindPaidNumber({
          reason: imported.error || 'Failed to import number into Vapi.',
          purchasedNumber,
          vapiPhoneId: null,
          client,
          adminSupabase: deps.adminSupabase,
          tenantId: tenant_id,
          vapiPrivateKey,
          fetchImpl,
        });
      }

      const updateData = isMobile
        ? { twilio_mobile_number: purchasedNumber.phoneNumber }
        : { twilio_shadow_number: purchasedNumber.phoneNumber, twilio_mobile_number: purchasedNumber.phoneNumber };

      const { error: updateError } = await deps.userSupabase
        .from('tenants')
        .update(updateData)
        .eq('id', tenant_id);

      if (updateError) {
        return unwindPaidNumber({
          reason: 'Failed to save number to database.',
          purchasedNumber,
          vapiPhoneId: imported.id || null,
          client,
          adminSupabase: deps.adminSupabase,
          tenantId: tenant_id,
          vapiPrivateKey,
          fetchImpl,
        });
      }

      await markTenantPhonePurchaseActive(deps.adminSupabase, tenant_id, {
        twilioSid: purchasedNumber.sid,
        phoneNumber: purchasedNumber.phoneNumber,
        vapiPhoneId: imported.id,
      });

      return NextResponse.json({
        success: true,
        number: purchasedNumber.phoneNumber,
        number_type: isMobile ? 'mobile' : 'local',
      });
    } catch (error: any) {
      await releaseReservation();
      throw error;
    }
  } catch (error: any) {
    console.error('[Telephony Provisioning API] Unexpected error', {
      message: error?.message || 'Internal server error',
    });
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

async function purchaseTwilioNumber(input: {
  client: ProvisionTwilioClient;
  country: string;
  isMobile: boolean;
  area_code?: string;
  phone_number?: string;
  appBaseUrl: string;
  addressSid?: string;
  bundleSid?: string;
}): Promise<ProvisionTwilioNumber> {
  let targetPhoneNumber = input.phone_number;

  if (!targetPhoneNumber) {
    let available: Array<{ phoneNumber: string }> = [];
    if (input.isMobile) {
      available = await input.client.availablePhoneNumbers(input.country).mobile.list({ limit: 1 });
    } else {
      const cleanCode = input.area_code
        ? input.area_code.toString().trim().replace(/^(\+44|0044|0)+/, '').replace(/[\s-]/g, '')
        : '';
      if (cleanCode) {
        const searchPattern = `+44${cleanCode}*`;
        const rawList = await input.client.availablePhoneNumbers(input.country).local.list({
          contains: searchPattern,
          limit: 5,
        });
        available = (rawList || []).filter((num) =>
          num.phoneNumber && num.phoneNumber.startsWith(`+44${cleanCode}`),
        );
        if (!available.length) {
          throw new Error(`No phone numbers are currently available for area code ${input.area_code}. Please choose an available number from the list or try another area code.`);
        }
      } else {
        available = await input.client.availablePhoneNumbers(input.country).local.list({ limit: 1 });
      }
    }
    if (!available.length) {
      throw new Error(`No ${input.isMobile ? 'mobile' : 'local'} phone numbers available for country: ${input.country}`);
    }
    targetPhoneNumber = available[0].phoneNumber;
  }

  const purchaseParams: Record<string, unknown> = {
    phoneNumber: targetPhoneNumber,
    voiceUrl: `${input.appBaseUrl}/api/telephony/inbound`,
    voiceMethod: 'POST',
    smsUrl: `${input.appBaseUrl}/api/telephony/sms`,
    smsMethod: 'POST',
  };
  if (input.addressSid && !input.isMobile) purchaseParams.addressSid = input.addressSid;
  if (input.bundleSid) purchaseParams.bundleSid = input.bundleSid;

  console.log('[Telephony Provisioning] Purchasing number', {
    country: input.country,
    isMobile: input.isMobile,
  });
  return input.client.incomingPhoneNumbers.create(purchaseParams);
}

async function unwindPaidNumber(input: {
  reason: string;
  purchasedNumber: ProvisionTwilioNumber;
  vapiPhoneId: string | null;
  client: ProvisionTwilioClient;
  adminSupabase: ProvisionSupabase;
  tenantId: string;
  vapiPrivateKey: string;
  fetchImpl: typeof fetch;
}): Promise<NextResponse> {
  console.error('[Telephony Provisioning] Unwinding paid number', {
    sid: input.purchasedNumber.sid,
    tenantId: input.tenantId,
  });

  await deleteVapiPhoneNumber({
    apiKey: input.vapiPrivateKey,
    phoneId: input.vapiPhoneId,
    phoneNumber: input.purchasedNumber.phoneNumber,
    fetchImpl: input.fetchImpl,
  }).catch(() => ({ ok: false as const, error: 'Vapi delete skipped' }));

  try {
    await releaseTwilioIncomingNumber(input.client, input.purchasedNumber.sid);
    await clearTenantPhonePurchase(input.adminSupabase, input.tenantId);
    return NextResponse.json({
      error: `${input.reason} The Twilio number was released.`,
    }, { status: 502 });
  } catch {
    const orphanError = `${input.reason} The Twilio number was NOT released. Orphan SID ${input.purchasedNumber.sid} needs clean-up.`;
    console.error('[Telephony Provisioning] ORPHANED paid number', {
      sid: input.purchasedNumber.sid,
      tenantId: input.tenantId,
    });
    await recordOrphanedPhonePurchase(input.adminSupabase, input.tenantId, {
      twilioSid: input.purchasedNumber.sid,
      phoneNumber: input.purchasedNumber.phoneNumber,
      vapiPhoneId: input.vapiPhoneId,
      error: orphanError,
    });
    return NextResponse.json({ error: orphanError }, { status: 502 });
  }
}
