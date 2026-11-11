import { getVapiPrivateKey, requireConfiguredAppUrl } from '@/lib/env/vapi-config';

export const PAID_PHONE_ADDON_IDS = ['landline_addon', 'mobile_addon'] as const;
export const VENDOR_FETCH_TIMEOUT_MS = 15_000;
export const PENDING_RESERVATION_TTL_MS = 10 * 60 * 1000;

export class VendorTimeoutError extends Error {
  readonly label: string;
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'VendorTimeoutError';
    this.label = label;
  }
}

export function vendorTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.VENDOR_FETCH_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : VENDOR_FETCH_TIMEOUT_MS;
}

export async function withVendorTimeout<T>(
  work: Promise<T>,
  label: string,
  timeoutMs = vendorTimeoutMs(),
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new VendorTimeoutError(label, timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchWithVendorTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
  timeoutMs = vendorTimeoutMs(),
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export type PhoneAddonRow = {
  addon_catalog_id?: string | null;
  is_active?: boolean | null;
  subscription_status?: string | null;
  stripe_subscription_id?: string | null;
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
    if (status === 'cancelled' || status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') {
      return false;
    }
    // active/trialing: currently entitled.
    // past_due: the current paid period is still in force until Stripe cancels.
    // NULL/empty: checkout already activated the row; do not wait for the next renewal invoice.
    if (status === 'active' || status === 'trialing' || status === 'past_due' || !status) {
      return true;
    }
    return false;
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
      headers: { 'X-Vapi-Secret': input.webhookSecret },
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
    const orgRes = await fetchWithVendorTimeout(fetchImpl, 'https://api.vapi.ai/org', { headers, cache: 'no-store' });
    if (orgRes.ok) return { ok: true };
    const assistantRes = await fetchWithVendorTimeout(fetchImpl, 'https://api.vapi.ai/assistant?limit=1', {
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
    const res = await fetchWithVendorTimeout(fetchImpl, 'https://api.vapi.ai/phone-number', {
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
      const list = await fetchWithVendorTimeout(fetchImpl, 'https://api.vapi.ai/phone-number', {
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
    const res = await fetchWithVendorTimeout(fetchImpl, `https://api.vapi.ai/phone-number/${phoneId}`, {
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
  await withVendorTimeout(client.incomingPhoneNumbers(sid).remove(), 'Twilio release');
}

export type PurchaseReservationRow = {
  tenant_id: string;
  status: 'pending' | 'active' | 'orphan' | 'unknown';
  twilio_sid?: string | null;
  phone_number?: string | null;
  vapi_phone_id?: string | null;
  error?: string | null;
  created_at?: string | null;
};

export type IncomingTwilioNumber = {
  sid: string;
  phoneNumber: string;
  voiceUrl?: string | null;
};

export function matchIncomingNumberForTenant(
  numbers: IncomingTwilioNumber[] | null | undefined,
  input: { phoneNumber?: string | null },
): IncomingTwilioNumber | null {
  const wanted = (input.phoneNumber || '').trim();
  if (!wanted) return null;
  const exact = (numbers || []).filter((row) => row.phoneNumber === wanted);
  return exact.length === 1 ? exact[0] : null;
}

export type PurchaseStore = {
  from: (table: string) => any;
};

export function isPendingReservationExpired(
  row: { status?: string | null; created_at?: string | null },
  nowMs = Date.now(),
  ttlMs = PENDING_RESERVATION_TTL_MS,
): boolean {
  if ((row.status || '').trim() !== 'pending') return false;
  const created = row.created_at ? Date.parse(row.created_at) : NaN;
  if (!Number.isFinite(created)) return false;
  return nowMs - created >= ttlMs;
}

export async function reclaimExpiredPendingPurchase(
  store: PurchaseStore,
  tenantId: string,
  nowMs = Date.now(),
  ttlMs = PENDING_RESERVATION_TTL_MS,
): Promise<{ reclaimed: boolean; error: { message?: string } | null }> {
  const cutoff = new Date(nowMs - ttlMs).toISOString();
  const result = await store
    .from('tenant_phone_number_purchases')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .select('tenant_id');
  if (result?.error) {
    return { reclaimed: false, error: result.error };
  }
  const rows = Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : [];
  return { reclaimed: rows.length > 0, error: null };
}

export async function reserveTenantPhonePurchase(
  store: PurchaseStore,
  tenantId: string,
  nowMs = Date.now(),
): Promise<
  | { ok: true; reconcile?: false }
  | { ok: true; reconcile: true; reservation: PurchaseReservationRow }
  | { ok: false; status: 409 | 500; error: string }
> {
  const table = store.from('tenant_phone_number_purchases');
  if (typeof table.select === 'function') {
    const existing = await table.select('*').eq('tenant_id', tenantId).maybeSingle();
    if (existing.error && existing.error.code !== 'PGRST116') {
      return { ok: false, status: 500, error: existing.error.message || 'Failed to read phone number reservation.' };
    }
    if (existing.data) {
      if ((existing.data.status || '').trim() === 'unknown') {
        const claimed = await claimUnknownPhonePurchase(store, tenantId);
        if (claimed.error) {
          return {
            ok: false,
            status: 500,
            error: claimed.error.message || 'Failed to claim an unknown phone reservation.',
          };
        }
        if (!claimed.reservation) {
          return {
            ok: false,
            status: 409,
            error: 'This tenant already has a phone number reservation. Number purchase is buy-once.',
          };
        }
        return { ok: true, reconcile: true, reservation: claimed.reservation };
      }
      if (isPendingReservationExpired(existing.data, nowMs)) {
        const reclaimed = await reclaimExpiredPendingPurchase(store, tenantId, nowMs);
        if (reclaimed.error) {
          return { ok: false, status: 500, error: reclaimed.error.message || 'Failed to reclaim a stale phone number reservation.' };
        }
        if (!reclaimed.reclaimed) {
          return {
            ok: false,
            status: 409,
            error: 'This tenant already has a phone number reservation. Number purchase is buy-once.',
          };
        }
      } else {
        return {
          ok: false,
          status: 409,
          error: 'This tenant already has a phone number reservation. Number purchase is buy-once.',
        };
      }
    }
  }

  const { error } = await store.from('tenant_phone_number_purchases').insert({
    tenant_id: tenantId,
    status: 'pending',
  });
  if (error?.code === '23505') {
    return {
      ok: false,
      status: 409,
      error: 'This tenant already has a phone number reservation. Number purchase is buy-once.',
    };
  }
  if (error) {
    return {
      ok: false,
      status: 500,
      error: error.message || 'Failed to reserve a phone number purchase.',
    };
  }
  return { ok: true };
}

export async function clearTenantPhonePurchase(
  store: PurchaseStore,
  tenantId: string,
): Promise<{ error: { message?: string } | null }> {
  return store
    .from('tenant_phone_number_purchases')
    .delete()
    .eq('tenant_id', tenantId)
    .neq('status', 'orphan');
}

export async function saveReservationPhoneNumber(
  store: PurchaseStore,
  tenantId: string,
  phoneNumber: string,
): Promise<{ error: { message?: string } | null }> {
  return store.from('tenant_phone_number_purchases').update({
    phone_number: phoneNumber,
    updated_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId);
}

export async function claimUnknownPhonePurchase(
  store: PurchaseStore,
  tenantId: string,
): Promise<{ reservation: PurchaseReservationRow | null; error: { message?: string } | null }> {
  const result = await store
    .from('tenant_phone_number_purchases')
    .update({
      status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('status', 'unknown')
    .select('*');
  if (result?.error) {
    return { reservation: null, error: result.error };
  }
  const rows = Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : [];
  return { reservation: rows[0] || null, error: null };
}

export async function markTenantPhonePurchaseUnknown(
  store: PurchaseStore,
  tenantId: string,
  details?: { error?: string | null; twilioSid?: string | null },
): Promise<{ error: { message?: string } | null }> {
  const patch: Record<string, unknown> = {
    status: 'unknown',
    error: details?.error || 'Twilio purchase timed out; reconcile before retry.',
    updated_at: new Date().toISOString(),
  };
  if (details?.twilioSid) patch.twilio_sid = details.twilioSid;
  return store.from('tenant_phone_number_purchases').update(patch).eq('tenant_id', tenantId);
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
): Promise<{ error: { message?: string } | null }> {
  return store.from('tenant_phone_number_purchases').update({
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
