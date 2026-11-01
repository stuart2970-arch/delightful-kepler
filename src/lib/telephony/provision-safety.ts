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
    const paid = (row.price_paid_pence ?? 0) > 0;
    return status === 'active' || status === 'paid' || status === 'trialing' || paid;
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
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
    return { ok: true };
  } catch {
    return { ok: false, error: 'Vapi import request failed.' };
  }
}

export async function releaseTwilioIncomingNumber(
  client: { incomingPhoneNumbers: (sid: string) => { remove: () => Promise<unknown> } },
  sid: string,
): Promise<void> {
  await client.incomingPhoneNumbers(sid).remove();
}

export function requireVoiceAppUrl(env: NodeJS.ProcessEnv = process.env) {
  return requireConfiguredAppUrl(env);
}
