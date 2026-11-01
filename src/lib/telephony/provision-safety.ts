import { getVapiPrivateKey, requireConfiguredAppUrl } from '@/lib/env/vapi-config';

export const PAID_PHONE_ADDON_IDS = ['landline_addon', 'mobile_addon'] as const;

export type PhoneAddonRow = {
  addon_catalog_id?: string | null;
  is_active?: boolean | null;
  subscription_status?: string | null;
  price_paid_pence?: number | null;
};

export type TenantPhoneRow = {
  twilio_shadow_number?: string | null;
  twilio_mobile_number?: string | null;
};

export function tenantHasExistingNumber(tenant: TenantPhoneRow | null | undefined): boolean {
  if (!tenant) return false;
  return Boolean(
    (tenant.twilio_shadow_number || '').trim() || (tenant.twilio_mobile_number || '').trim(),
  );
}

export function tenantHasPaidPhoneAddon(rows: PhoneAddonRow[] | null | undefined): boolean {
  return (rows || []).some((row) => {
    const id = (row.addon_catalog_id || '').trim();
    if (!PAID_PHONE_ADDON_IDS.includes(id as (typeof PAID_PHONE_ADDON_IDS)[number])) {
      return false;
    }
    if (row.is_active === false) return false;
    const status = (row.subscription_status || '').trim().toLowerCase();
    return status === 'active' || status === 'trialing';
  });
}

export function buildVapiPhoneImportPayload(input: {
  phoneNumber: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  tenantId: string;
  appUrl: string;
  webhookSecret: string;
}): Record<string, unknown> {
  return {
    provider: 'twilio',
    number: input.phoneNumber,
    twilioAccountSid: input.twilioAccountSid,
    twilioAuthToken: input.twilioAuthToken,
    server: {
      url: `${input.appUrl.replace(/\/+$/, '')}/api/webhooks/vapi/assistant`,
      secret: input.webhookSecret,
    },
    name: `StyleFlo Tenant ${input.tenantId}`,
  };
}

export async function verifyVapiPrivateKeyWorks(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = getVapiPrivateKey(env);
  if (!key) {
    return { ok: false, error: 'Vapi private API key is not configured.' };
  }
  try {
    const headers = { Authorization: `Bearer ${key}` };
    const orgRes = await fetchImpl('https://api.vapi.ai/org', { headers, cache: 'no-store' });
    if (orgRes.ok) return { ok: true };
    const assistantRes = await fetchImpl('https://api.vapi.ai/assistant?limit=1', {
      headers,
      cache: 'no-store',
    });
    if (assistantRes.ok) return { ok: true };
    return { ok: false, error: `Vapi key check failed (${orgRes.status}).` };
  } catch {
    return { ok: false, error: 'Vapi key check failed.' };
  }
}

export async function importTwilioNumberToVapi(input: {
  payload: Record<string, unknown>;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  const fetchImpl = input.fetchImpl || fetch;
  try {
    const res = await fetchImpl('https://api.vapi.ai/phone-number', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.payload),
    });
    if (!res.ok) {
      return { ok: false, error: `Vapi import failed (${res.status}).` };
    }
    const body = await res.json().catch(() => ({}));
    return { ok: true, id: typeof body?.id === 'string' ? body.id : undefined };
  } catch {
    return { ok: false, error: 'Vapi import request failed.' };
  }
}

export async function deleteVapiPhoneNumber(input: {
  apiKey: string;
  phoneId?: string | null;
  phoneNumber?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const fetchImpl = input.fetchImpl || fetch;
  const headers = { Authorization: `Bearer ${input.apiKey}` };
  try {
    let phoneId = (input.phoneId || '').trim();
    if (!phoneId && input.phoneNumber) {
      const list = await fetchImpl('https://api.vapi.ai/phone-number', {
        headers,
        cache: 'no-store',
      });
      if (list.ok) {
        const rows = await list.json().catch(() => []);
        const match = (Array.isArray(rows) ? rows : []).find(
          (row: { id?: string; number?: string }) => row.number === input.phoneNumber,
        );
        phoneId = match?.id || '';
      }
    }
    if (!phoneId) {
      return { ok: false, error: 'Vapi phone id is unknown; cannot delete the import.' };
    }
    const res = await fetchImpl(`https://api.vapi.ai/phone-number/${phoneId}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      return { ok: false, error: `Vapi delete failed (${res.status}).` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Vapi delete request failed.' };
  }
}

export async function releaseTwilioIncomingNumber(
  client: { incomingPhoneNumbers: (sid: string) => { remove: () => Promise<unknown> } },
  sid: string,
): Promise<void> {
  await client.incomingPhoneNumbers(sid).remove();
}

export type PurchaseReservationRow = {
  tenant_id: string;
  status: 'pending' | 'active' | 'orphan';
  twilio_sid?: string | null;
  phone_number?: string | null;
  vapi_phone_id?: string | null;
  error?: string | null;
};

export type PurchaseStore = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: { code?: string; message?: string } | null }>;
    update: (row: Record<string, unknown>) => {
      eq: (column: string, value: string) => Promise<{ error: { message?: string } | null }>;
    };
    delete: () => {
      eq: (column: string, value: string) => Promise<{ error: { message?: string } | null }>;
    };
  };
};

export async function reserveTenantPhonePurchase(
  store: PurchaseStore,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; status: 409; error: string }> {
  const { error } = await store.from('tenant_phone_number_purchases').insert({
    tenant_id: tenantId,
    status: 'pending',
  });
  if (error) {
    return {
      ok: false,
      status: 409,
      error: 'This tenant already has a phone number reservation. Number purchase is buy-once.',
    };
  }
  return { ok: true };
}

export async function clearTenantPhonePurchase(
  store: PurchaseStore,
  tenantId: string,
): Promise<void> {
  await store.from('tenant_phone_number_purchases').delete().eq('tenant_id', tenantId);
}

export async function markTenantPhonePurchaseActive(
  store: PurchaseStore,
  tenantId: string,
  details: { twilioSid?: string; phoneNumber?: string; vapiPhoneId?: string },
): Promise<{ error: { message?: string } | null }> {
  return store.from('tenant_phone_number_purchases').update({
    status: 'active',
    twilio_sid: details.twilioSid || null,
    phone_number: details.phoneNumber || null,
    vapi_phone_id: details.vapiPhoneId || null,
    error: null,
    updated_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId);
}

export async function recordOrphanedPhonePurchase(
  store: PurchaseStore,
  tenantId: string,
  details: {
    twilioSid?: string | null;
    phoneNumber?: string | null;
    vapiPhoneId?: string | null;
    error: string;
  },
): Promise<void> {
  await store.from('tenant_phone_number_purchases').update({
    status: 'orphan',
    twilio_sid: details.twilioSid || null,
    phone_number: details.phoneNumber || null,
    vapi_phone_id: details.vapiPhoneId || null,
    error: details.error,
    updated_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId);
}

export function requireVoiceAppUrl(env: NodeJS.ProcessEnv = process.env) {
  return requireConfiguredAppUrl(env);
}
