import { allocateRollingCredits as allocateRollingCreditsDefault } from '@/lib/entitlements';
import { isBoltOnMetadata, mapAddonCategoryToFeatureId } from '@/lib/billing/bolt-on';
import { resolvePricePaidPence } from '@/lib/billing/account-ownership';
import {
  addonActivateStatusFields,
  addonDeactivateStatusFields,
  addonPastDueStatusFields,
} from '@/lib/billing/addon-subscription-status';

export type AddonLineItemContext = {
  stripeSubscriptionStatus?: string | null;
  stripeSubscriptionId?: string | null;
};

export function stripeSubscriptionIdFrom(object: Record<string, any> | null | undefined): string | null {
  if (!object) return null;
  const sub = object.subscription;
  if (typeof sub === 'string' && sub.trim()) return sub.trim();
  if (sub && typeof sub === 'object' && typeof sub.id === 'string' && sub.id.trim()) return sub.id.trim();
  if (typeof object.id === 'string' && object.id.startsWith('sub_')) return object.id;
  return null;
}

export function invoicePriceIdsFrom(object: Record<string, any> | null | undefined): string[] {
  const lines = object?.lines?.data || object?.lines || [];
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line: any) => line?.price?.id || line?.plan?.id)
    .filter((id: unknown): id is string => typeof id === 'string' && Boolean(id.trim()));
}

function notCancelledStatusFilter(query: any) {
  return query.or('subscription_status.is.null,subscription_status.neq.cancelled');
}

export async function syncAddonStatusAfterInvoice(
  supabaseAdmin: any,
  input: {
    stripeSubscriptionId?: string | null;
    outcome: 'succeeded' | 'failed';
    tenantId?: string | null;
    addonCatalogId?: string | null;
    priceIds?: string[] | null;
  },
) {
  const subscriptionId = (input.stripeSubscriptionId || '').trim();
  const fields = {
    ...(input.outcome === 'failed' ? addonPastDueStatusFields() : addonActivateStatusFields('active')),
    ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {}),
  };

  if (subscriptionId) {
    await notCancelledStatusFilter(
      supabaseAdmin
        .from('tenant_active_addons')
        .update(fields)
        .eq('stripe_subscription_id', subscriptionId)
        .eq('is_active', true),
    );
  }

  const tenantId = (input.tenantId || '').trim();
  if (!tenantId || !subscriptionId) {
    return { error: null, skipped: !subscriptionId };
  }

  let catalogIds = (input.addonCatalogId || '').trim() ? [(input.addonCatalogId || '').trim()] : [];
  if (!catalogIds.length && input.priceIds?.length) {
    for (const priceId of input.priceIds) {
      const { data: addon } = await supabaseAdmin
        .from('addon_catalog')
        .select('id')
        .eq('stripe_price_id', priceId)
        .maybeSingle();
      if (addon?.id) catalogIds.push(addon.id);
    }
  }
  catalogIds = [...new Set(catalogIds)];
  if (!catalogIds.length) {
    return { error: null, skipped: false };
  }

  let fillNull = supabaseAdmin
    .from('tenant_active_addons')
    .update(fields)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .is('stripe_subscription_id', null);
  fillNull = notCancelledStatusFilter(fillNull);
  if (catalogIds.length === 1) {
    fillNull = fillNull.eq('addon_catalog_id', catalogIds[0]);
  } else {
    fillNull = fillNull.in('addon_catalog_id', catalogIds);
  }
  return fillNull;
}

export async function deactivateAddonsForCancelledSubscription(
  supabaseAdmin: any,
  input: { tenantId: string; addonCatalogId?: string | null; stripeSubscriptionId?: string | null },
) {
  const payload = { ...addonDeactivateStatusFields(), deactivated_at: new Date().toISOString() };
  if (input.stripeSubscriptionId) {
    await supabaseAdmin
      .from('tenant_active_addons')
      .update(payload)
      .eq('tenant_id', input.tenantId)
      .eq('stripe_subscription_id', input.stripeSubscriptionId);
  }
  if (input.addonCatalogId) {
    await supabaseAdmin
      .from('tenant_active_addons')
      .update(payload)
      .eq('tenant_id', input.tenantId)
      .eq('addon_catalog_id', input.addonCatalogId);
  }
  if (!input.stripeSubscriptionId && !input.addonCatalogId) {
    return supabaseAdmin
      .from('tenant_active_addons')
      .update(payload)
      .eq('tenant_id', input.tenantId);
  }
  return { error: null };
}

export type StripeBillingEvent = {
  type?: string;
  data?: { object?: Record<string, any> };
};

export type StripeWebhookDeps = {
  supabaseAdmin: any;
  allocateRollingCredits?: (
    tenantId: string,
    featureId: string,
    quantity: number,
    addonCatalogId?: string,
  ) => Promise<{ id?: string } | void>;
};

export type StripeWebhookResult = {
  status: number;
  body: Record<string, any>;
};

type ActivateBoltOnResult = {
  ok: boolean;
  addonId?: string;
  oneOff?: boolean;
  alreadyGranted?: boolean;
  retry?: boolean;
  error?: string;
};

function isUniqueViolation(error: any): boolean {
  return String(error?.code ?? '') === '23505';
}

function isMissingRpc(error: any): boolean {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '');
  return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(message);
}

type AddonActivationOutcome = 'inserted' | 'reactivated' | 'already_active';

type AddonActivationResult =
  | { ok: true; outcome: AddonActivationOutcome; id?: string }
  | { ok: false; retry: true; error: string };

function readActivationOutcome(data: any): AddonActivationOutcome | null {
  const payload = Array.isArray(data) ? data[0] : data;
  const outcome = payload?.outcome;
  if (outcome === 'inserted' || outcome === 'reactivated' || outcome === 'already_active') return outcome;
  return null;
}

async function listFirstActiveAddon(supabaseAdmin: any, tenantId: string, addonCatalogId: string) {
  const { data, error } = await supabaseAdmin
    .from('tenant_active_addons')
    .select('id, is_active, created_at, stripe_subscription_id, stripe_subscription_item_id, subscription_status, feature_id, price_paid_pence')
    .eq('tenant_id', tenantId)
    .eq('addon_catalog_id', addonCatalogId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1);
  const row = Array.isArray(data) ? data[0] : data || null;
  return { row: row || null, error };
}

async function fallbackActivateTenantAddon(options: {
  supabaseAdmin: any;
  tenantId: string;
  addonCatalogId: string;
  featureId: string | null;
  subscriptionStatus: string;
  stripeSubscriptionId: string | null;
  subscriptionItemId: string | null;
  pricePaidPence: number | null;
}): Promise<AddonActivationResult> {
  const listed = await listFirstActiveAddon(options.supabaseAdmin, options.tenantId, options.addonCatalogId);
  if (listed.error) {
    if (isUniqueViolation(listed.error)) return { ok: true, outcome: 'already_active' };
    return { ok: false, retry: true, error: listed.error.message || 'Failed to read active bolt-on' };
  }

  const statusFields = addonActivateStatusFields(options.subscriptionStatus);
  if (listed.row) {
    const { error: updateErr } = await options.supabaseAdmin
      .from('tenant_active_addons')
      .update({
        ...statusFields,
        deactivated_at: null,
        price_paid_pence: options.pricePaidPence ?? listed.row.price_paid_pence ?? null,
        feature_id: options.featureId || listed.row.feature_id || null,
        stripe_subscription_id: listed.row.stripe_subscription_id || options.stripeSubscriptionId,
        stripe_subscription_item_id: listed.row.stripe_subscription_item_id || options.subscriptionItemId,
      })
      .eq('id', listed.row.id);
    if (updateErr) {
      if (isUniqueViolation(updateErr)) return { ok: true, outcome: 'already_active' };
      return { ok: false, retry: true, error: updateErr.message || 'Failed to refresh active bolt-on' };
    }
    return { ok: true, outcome: 'already_active', id: listed.row.id };
  }

  const { error: insertErr } = await options.supabaseAdmin.from('tenant_active_addons').insert({
    tenant_id: options.tenantId,
    addon_catalog_id: options.addonCatalogId,
    feature_id: options.featureId,
    quantity: 1,
    ...statusFields,
    activated_at: new Date().toISOString(),
    stripe_subscription_item_id: options.subscriptionItemId,
    stripe_subscription_id: options.stripeSubscriptionId,
    price_paid_pence: options.pricePaidPence,
  });
  if (insertErr) {
    if (isUniqueViolation(insertErr)) return { ok: true, outcome: 'already_active' };
    return { ok: false, retry: true, error: insertErr.message || 'Failed to insert active bolt-on' };
  }
  return { ok: true, outcome: 'inserted' };
}

async function activateTenantAddonRecord(options: {
  supabaseAdmin: any;
  tenantId: string;
  addonCatalogId: string;
  featureId: string | null;
  subscriptionStatus: string | null;
  stripeSubscriptionId: string | null;
  subscriptionItemId: string | null;
  pricePaidPence: number | null;
}): Promise<AddonActivationResult> {
  const subscriptionStatus = addonActivateStatusFields(options.subscriptionStatus).subscription_status;
  const { data, error } = await options.supabaseAdmin.rpc('activate_tenant_addon', {
    p_tenant_id: options.tenantId,
    p_addon_catalog_id: options.addonCatalogId,
    p_feature_id: options.featureId,
    p_subscription_status: subscriptionStatus,
    p_stripe_subscription_id: options.stripeSubscriptionId,
    p_stripe_subscription_item_id: options.subscriptionItemId,
    p_price_paid_pence: options.pricePaidPence,
  });

  if (error && isMissingRpc(error)) {
    console.error(
      `[Stripe Webhook] activate_tenant_addon RPC is missing (${error.code || 'unknown'}); falling back to a list read`,
    );
    return fallbackActivateTenantAddon({ ...options, subscriptionStatus });
  }
  if (error) {
    console.error(
      `[Stripe Webhook] activate_tenant_addon failed (${error.code || 'unknown'})`,
    );
    return { ok: false, retry: true, error: error.message || 'activate_tenant_addon failed' };
  }

  const outcome = readActivationOutcome(data);
  if (!outcome) {
    return { ok: false, retry: true, error: 'activate_tenant_addon returned no outcome' };
  }
  const payload = Array.isArray(data) ? data[0] : data;
  return { ok: true, outcome, id: payload?.id };
}

function creditLines(voiceMinutes: number, smsCount: number, messagesCount: number) {
  const credits: Array<{ feature_id: string; quantity: number }> = [];
  if (voiceMinutes > 0) credits.push({ feature_id: 'voice_minutes', quantity: voiceMinutes });
  if (smsCount > 0) credits.push({ feature_id: 'sms_messages', quantity: smsCount });
  if (messagesCount > 0) credits.push({ feature_id: 'whatsapp_messages', quantity: messagesCount });
  return credits;
}

async function tryGrantOneOffAtomically(options: {
  supabaseAdmin: any;
  tenantId: string;
  addonCatalogId: string;
  stripeSessionId?: string | null;
  auditNewValue: Record<string, any>;
  auditSummary: string;
  credits: Array<{ feature_id: string; quantity: number }>;
}): Promise<{ used: boolean; alreadyGranted?: boolean; retry?: boolean; error?: string }> {
  const { data, error } = await options.supabaseAdmin.rpc('grant_one_off_pack', {
    p_tenant_id: options.tenantId,
    p_addon_catalog_id: options.addonCatalogId,
    p_stripe_session_id: options.stripeSessionId || null,
    p_audit_new_value: options.auditNewValue,
    p_audit_summary: options.auditSummary,
    p_credits: options.credits,
  });
  if (error && isMissingRpc(error)) return { used: false };
  if (error) {
    return { used: true, retry: true, error: error.message || 'Atomic one-off grant failed' };
  }
  if (data?.already_granted) return { used: true, alreadyGranted: true };
  return { used: true };
}

async function syncChannelFlags(supabaseAdmin: any, tenantId: string) {
  await supabaseAdmin.rpc('sync_tenant_channel_flags', { p_tenant_id: tenantId });
}

function metadataNumber(metadata: Record<string, any> | undefined, ...keys: string[]): number | null {
  if (!metadata) return null;
  for (const key of keys) {
    if (metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== '') {
      const value = Number(metadata[key]);
      if (!Number.isNaN(value)) return value;
    }
  }
  return null;
}

export async function processAddonLineItems(
  supabaseAdmin: any,
  tenantId: string,
  lineItems: any[],
  action: 'activate' | 'deactivate',
  allocateRollingCredits: StripeWebhookDeps['allocateRollingCredits'],
  context: AddonLineItemContext = {},
) {
  for (const item of lineItems) {
    const priceId = item.price?.id || item.plan?.id;
    if (!priceId) continue;

    const { data: addon } = await supabaseAdmin
      .from('addon_catalog')
      .select('id, category, monthly_price_pence, included_voice_minutes, included_sms, included_messages, included_data_chunks')
      .eq('stripe_price_id', priceId)
      .maybeSingle();

    if (!addon) continue;

    const featureId = mapAddonCategoryToFeatureId(addon.category);
    const pricePaidPence = resolvePricePaidPence({
      stripeUnitAmount: item.price?.unit_amount ?? item.plan?.amount ?? null,
      cataloguePricePence: addon.monthly_price_pence,
    });

    if (action === 'activate') {
      const stripeSubscriptionId = stripeSubscriptionIdFrom(item) || context.stripeSubscriptionId || null;
      const activated = await activateTenantAddonRecord({
        supabaseAdmin,
        tenantId,
        addonCatalogId: addon.id,
        featureId,
        subscriptionStatus: context.stripeSubscriptionStatus || null,
        stripeSubscriptionId,
        subscriptionItemId: item.id || null,
        pricePaidPence,
      });
      if (!activated.ok) {
        await syncChannelFlags(supabaseAdmin, tenantId);
        return { ok: false, retry: true, error: activated.error };
      }

      const freshActivation = activated.outcome === 'inserted' || activated.outcome === 'reactivated';
      if (freshActivation) {
        if (addon.included_voice_minutes > 0) {
          await allocateRollingCredits?.(tenantId, 'voice_minutes', addon.included_voice_minutes, addon.id);
        }
        if (addon.included_sms > 0) {
          await allocateRollingCredits?.(tenantId, 'sms_messages', addon.included_sms, addon.id);
        }
        if (addon.included_messages > 0) {
          await allocateRollingCredits?.(tenantId, 'whatsapp_messages', addon.included_messages, addon.id);
        }
        await supabaseAdmin.from('addon_audit_log').insert({
          tenant_id: tenantId,
          addon_catalog_id: addon.id,
          action: 'addon_activated',
          new_value: { stripe_price_id: priceId, stripe_item_id: item.id, price_paid_pence: pricePaidPence, custom_price_pence: pricePaidPence },
          summary: `Activated ${addon.id} via Stripe subscription.`,
        });
      }
    } else if (action === 'deactivate') {
      await supabaseAdmin
        .from('tenant_active_addons')
        .update({
          ...addonDeactivateStatusFields(),
          deactivated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId)
        .eq('addon_catalog_id', addon.id);

      await supabaseAdmin.from('addon_audit_log').insert({
        tenant_id: tenantId,
        addon_catalog_id: addon.id,
        action: 'addon_deactivated',
        old_value: { stripe_price_id: priceId },
        summary: `Deactivated ${addon.id} due to subscription cancellation.`,
      });
    }
  }

  await syncChannelFlags(supabaseAdmin, tenantId);
  return { ok: true };
}

async function activateBoltOnByCatalogId(options: {
  supabaseAdmin: any;
  tenantId: string;
  addonCatalogId: string;
  metadata?: Record<string, any>;
  subscriptionItemId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeSubscriptionStatus?: string | null;
  stripeSessionId?: string | null;
  stripeUnitAmount?: number | null;
  allocateRollingCredits: StripeWebhookDeps['allocateRollingCredits'];
}): Promise<ActivateBoltOnResult> {
  const {
    supabaseAdmin,
    tenantId,
    addonCatalogId,
    metadata = {},
    subscriptionItemId,
    stripeSubscriptionId,
    stripeSubscriptionStatus,
    stripeSessionId,
    stripeUnitAmount,
    allocateRollingCredits,
  } = options;

  const { data: addon } = await supabaseAdmin
    .from('addon_catalog')
    .select('*')
    .eq('id', addonCatalogId)
    .maybeSingle();

  if (!addon) return { ok: false };
  if (!addon.is_active) {
    console.warn(`[Stripe Webhook] Notice: Processing fulfillment for retired addon_catalog item: ${addonCatalogId}`);
  }

  const customPricePence = metadataNumber(metadata, 'custom_price_pence', 'price_pence');
  const customVoiceMinutes = metadataNumber(metadata, 'custom_voice_minutes', 'voice_minutes');
  const customSms = metadataNumber(metadata, 'custom_sms', 'sms');
  const voiceMinutes = customVoiceMinutes !== null ? customVoiceMinutes : (addon.included_voice_minutes || 0);
  const smsCount = customSms !== null ? customSms : (addon.included_sms || 0);
  const messagesCount = addon.included_messages || 0;
  const isOneOff = metadata.is_one_off === 'true' || addon.category === 'sms_pack' || addon.category === 'voice_pack';
  const pricePaidPence = resolvePricePaidPence({
    customPricePence,
    stripeUnitAmount: stripeUnitAmount ?? null,
    cataloguePricePence: addon.monthly_price_pence,
  });

  const featureId = mapAddonCategoryToFeatureId(addon.category);

  const auditRow = {
    tenant_id: tenantId,
    addon_catalog_id: addon.id,
    action: isOneOff ? 'one_off_addon_purchased' : 'addon_activated',
    new_value: {
      is_one_off: isOneOff,
      custom_price_pence: customPricePence ?? pricePaidPence,
      price_paid_pence: pricePaidPence,
      voice_minutes: voiceMinutes,
      sms: smsCount,
      auto_topup: metadata.auto_topup === 'true',
      auto_topup_threshold: metadata.auto_topup_threshold || null,
      stripe_subscription_id: stripeSubscriptionId || subscriptionItemId || null,
      stripe_session_id: stripeSessionId,
    },
    summary: isOneOff
      ? (addon.category === 'voice_pack'
          ? `Purchased one-off pack of ${voiceMinutes} voice minutes for £${((customPricePence || addon.monthly_price_pence) / 100).toFixed(2)} (valid for 3 months).`
          : `Purchased one-off pack of ${smsCount} SMS messages for £${((customPricePence || addon.monthly_price_pence) / 100).toFixed(2)} (valid for 3 months).`)
      : `Activated ${addon.id} (${voiceMinutes} voice mins, ${smsCount} SMS) via Stripe checkout.`,
  };

  const oneOffCredits = creditLines(voiceMinutes, smsCount, messagesCount);
  let freshActivation = false;

  if (isOneOff) {
    const atomic = await tryGrantOneOffAtomically({
      supabaseAdmin,
      tenantId,
      addonCatalogId: addon.id,
      stripeSessionId,
      auditNewValue: auditRow.new_value,
      auditSummary: auditRow.summary,
      credits: oneOffCredits,
    });
    if (atomic.used) {
      if (atomic.retry) {
        return {
          ok: false,
          retry: true,
          oneOff: true,
          addonId: addon.id,
          error: atomic.error || 'Failed to grant one-off pack',
        };
      }
      if (atomic.alreadyGranted) {
        return { ok: true, alreadyGranted: true, addonId: addon.id, oneOff: true };
      }
    } else {
      const { data: insertedAudit, error: auditError } = await supabaseAdmin
        .from('addon_audit_log')
        .insert(auditRow)
        .select('id');
      if (auditError) {
        if (isUniqueViolation(auditError)) {
          return { ok: true, alreadyGranted: true, addonId: addon.id, oneOff: true };
        }
        console.error('[Stripe Webhook] One-off audit insert failed; leaving credits unchanged:', auditError);
        return {
          ok: false,
          retry: true,
          oneOff: true,
          addonId: addon.id,
          error: auditError.message || 'Failed to record one-off pack grant',
        };
      }
      const auditId = Array.isArray(insertedAudit) ? insertedAudit[0]?.id : insertedAudit?.id;
      const grantedLedgerIds: string[] = [];
      try {
        for (const credit of oneOffCredits) {
          const granted = await allocateRollingCredits?.(tenantId, credit.feature_id, credit.quantity, addon.id);
          if (granted?.id) grantedLedgerIds.push(granted.id);
        }
      } catch (allocErr: any) {
        console.error('[Stripe Webhook] One-off allocation failed; rolling back audit grant:', allocErr);
        let rollbackFailed = false;
        if (grantedLedgerIds.length > 0) {
          const { error: ledgerDeleteError } = await supabaseAdmin
            .from('usage_ledger')
            .delete()
            .in('id', grantedLedgerIds);
          if (ledgerDeleteError) {
            console.error(
              '[Stripe Webhook] CRITICAL: failed to roll back one-off usage_ledger rows after allocation failure. Retry must not grant twice.',
              ledgerDeleteError,
            );
            rollbackFailed = true;
          }
        }
        if (auditId) {
          const { error: auditDeleteError } = await supabaseAdmin
            .from('addon_audit_log')
            .delete()
            .eq('id', auditId);
          if (auditDeleteError) {
            console.error(
              '[Stripe Webhook] CRITICAL: failed to roll back one-off addon_audit_log row after allocation failure. Retry must not grant twice.',
              auditDeleteError,
            );
            rollbackFailed = true;
          }
        }
        return {
          ok: false,
          retry: true,
          oneOff: true,
          addonId: addon.id,
          error: rollbackFailed
            ? 'Failed to roll back one-off grant after allocation error'
            : (allocErr?.message || 'Failed to allocate one-off credits'),
        };
      }
    }
  } else {
    const activated = await activateTenantAddonRecord({
      supabaseAdmin,
      tenantId,
      addonCatalogId: addon.id,
      featureId,
      subscriptionStatus: stripeSubscriptionStatus || null,
      stripeSubscriptionId: stripeSubscriptionId || null,
      subscriptionItemId: subscriptionItemId ?? null,
      pricePaidPence,
    });
    if (!activated.ok) {
      return {
        ok: false,
        retry: true,
        addonId: addon.id,
        error: activated.error,
      };
    }
    freshActivation = activated.outcome === 'inserted' || activated.outcome === 'reactivated';
  }

  if (!isOneOff && freshActivation) {
    for (const credit of oneOffCredits) {
      await allocateRollingCredits?.(tenantId, credit.feature_id, credit.quantity, addon.id);
    }
  }

  await syncChannelFlags(supabaseAdmin, tenantId);

  if (metadata.auto_topup === 'true') {
    await supabaseAdmin
      .from('tenants')
      .update({
        voice_auto_topup: true,
        voice_auto_topup_threshold: parseInt(metadata.auto_topup_threshold || '10', 10),
        voice_auto_topup_amount: voiceMinutes,
        voice_auto_topup_price_pence: customPricePence || addon.monthly_price_pence,
      })
      .eq('id', tenantId);
  }

  if (!isOneOff && freshActivation) {
    await supabaseAdmin.from('addon_audit_log').insert(auditRow);
  }

  return { ok: true, addonId: addon.id, oneOff: isOneOff };
}

export async function handleStripeBillingEvent(
  event: StripeBillingEvent,
  deps: StripeWebhookDeps,
): Promise<StripeWebhookResult> {
  const eventType: string = event.type || 'direct_payload';
  const dataObject = (event.data && event.data.object ? event.data.object : {}) as Record<string, any>;
  const supabaseAdmin = deps.supabaseAdmin;
  const allocateRollingCredits = deps.allocateRollingCredits || allocateRollingCreditsDefault;

  if (eventType === 'invoice.payment_succeeded') {
    const customerId = dataObject.customer;
    const invoiceMetadata = dataObject.subscription_details?.metadata || dataObject.metadata || {};
    await syncAddonStatusAfterInvoice(supabaseAdmin, {
      stripeSubscriptionId: stripeSubscriptionIdFrom(dataObject),
      outcome: 'succeeded',
      tenantId: invoiceMetadata.tenant_id,
      addonCatalogId: invoiceMetadata.addon_catalog_id,
      priceIds: invoicePriceIdsFrom(dataObject),
    });
    if (isBoltOnMetadata(invoiceMetadata)) {
      return { status: 200, body: { success: true, message: 'Bolt-on invoice acknowledged' } };
    }

    let tenantId = dataObject.subscription_details?.metadata?.tenant_id
      || dataObject.metadata?.tenant_id;

    if (!tenantId && customerId) {
      const { data: tenant } = await supabaseAdmin
        .from('tenants')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();
      if (tenant) tenantId = tenant.id;
    }

    if (tenantId) {
      await supabaseAdmin
        .from('tenants')
        .update({ is_active: true, subscription_status: 'active' })
        .eq('id', tenantId);

      const { data: activeAddons } = await supabaseAdmin
        .from('tenant_active_addons')
        .select('addon_catalog_id, addon_catalog(category, included_voice_minutes, included_sms, included_messages)')
        .eq('tenant_id', tenantId)
        .eq('is_active', true);

      if (activeAddons) {
        for (const addon of activeAddons) {
          const catalog = (addon as any).addon_catalog;
          if (catalog?.category === 'sms_pack' || catalog?.category === 'voice_pack') continue;

          if (catalog?.included_voice_minutes > 0) {
            await allocateRollingCredits(tenantId, 'voice_minutes', catalog.included_voice_minutes, addon.addon_catalog_id);
          }
          if (catalog?.included_sms > 0) {
            await allocateRollingCredits(tenantId, 'sms_messages', catalog.included_sms, addon.addon_catalog_id);
          }
          if (catalog?.included_messages > 0) {
            await allocateRollingCredits(tenantId, 'whatsapp_messages', catalog.included_messages, addon.addon_catalog_id);
          }
        }
      }

      return { status: 200, body: { success: true, message: `Tenant ${tenantId} unlocked` } };
    }
  }

  if (eventType === 'invoice.payment_failed') {
    const failMetadata = dataObject.subscription_details?.metadata || dataObject.metadata || {};
    await syncAddonStatusAfterInvoice(supabaseAdmin, {
      stripeSubscriptionId: stripeSubscriptionIdFrom(dataObject),
      outcome: 'failed',
      tenantId: failMetadata.tenant_id,
      addonCatalogId: failMetadata.addon_catalog_id,
      priceIds: invoicePriceIdsFrom(dataObject),
    });
    if (isBoltOnMetadata(failMetadata)) {
      return { status: 200, body: { success: true, message: 'Bolt-on invoice failure acknowledged' } };
    }

    const tenantId = dataObject.subscription_details?.metadata?.tenant_id
      || dataObject.metadata?.tenant_id;

    if (tenantId) {
      await supabaseAdmin
        .from('tenants')
        .update({ subscription_status: 'past_due' })
        .eq('id', tenantId);
      return { status: 200, body: { success: true, message: `Tenant ${tenantId} marked past_due` } };
    }
  }

  if (eventType === 'customer.subscription.updated') {
    const metadata = dataObject.metadata || {};
    const tenantId = metadata.tenant_id;
    const items = dataObject.items?.data || [];

    if (tenantId && isBoltOnMetadata(metadata) && metadata.addon_catalog_id) {
      const status = String(dataObject.status || '').toLowerCase();
      if (status !== 'active' && status !== 'trialing') {
        return {
          status: 200,
          body: { success: true, message: `Bolt-on subscription update ignored (status ${status || 'unknown'})` },
        };
      }
      const firstItem = items[0];
      const activated = await activateBoltOnByCatalogId({
        supabaseAdmin,
        tenantId,
        addonCatalogId: metadata.addon_catalog_id,
        metadata,
        subscriptionItemId: firstItem?.id || null,
        stripeSubscriptionId: dataObject.id || stripeSubscriptionIdFrom(dataObject),
        stripeSubscriptionStatus: dataObject.status || status,
        stripeUnitAmount: firstItem?.price?.unit_amount ?? null,
        allocateRollingCredits,
      });
      if (activated.retry) {
        return { status: 500, body: { success: false, error: activated.error || 'Bolt-on fulfilment failed' } };
      }
      if (activated.ok) {
        return { status: 200, body: { success: true, message: 'Add-ons synced' } };
      }
    }

    if (tenantId && items.length > 0 && !isBoltOnMetadata(metadata)) {
      const lineItemsResult = await processAddonLineItems(supabaseAdmin, tenantId, items, 'activate', allocateRollingCredits, {
        stripeSubscriptionStatus: dataObject.status,
        stripeSubscriptionId: dataObject.id || stripeSubscriptionIdFrom(dataObject),
      });
      if (lineItemsResult.retry) {
        return { status: 500, body: { success: false, error: lineItemsResult.error || 'Bolt-on fulfilment failed' } };
      }
      return { status: 200, body: { success: true, message: 'Add-ons synced' } };
    }
  }

  if (eventType === 'customer.subscription.deleted') {
    const metadata = dataObject.metadata || {};
    const tenantId = metadata.tenant_id;
    const addonCatalogId = metadata.addon_catalog_id;

    if (tenantId) {
      if (isBoltOnMetadata(metadata) && addonCatalogId) {
        await deactivateAddonsForCancelledSubscription(supabaseAdmin, {
          tenantId,
          addonCatalogId,
          stripeSubscriptionId: dataObject.id || stripeSubscriptionIdFrom(dataObject),
        });

        await syncChannelFlags(supabaseAdmin, tenantId);

        await supabaseAdmin.from('addon_audit_log').insert({
          tenant_id: tenantId,
          addon_catalog_id: addonCatalogId,
          action: 'addon_deactivated',
          old_value: { stripe_subscription_id: dataObject.id },
          summary: `Deactivated add-on ${addonCatalogId} due to Stripe subscription cancellation.`,
        });

        return { status: 200, body: { success: true, message: `Add-on ${addonCatalogId} cancelled` } };
      }

      await deactivateAddonsForCancelledSubscription(supabaseAdmin, { tenantId });

      await supabaseAdmin
        .from('tenants')
        .update({
          is_active: false,
          subscription_status: 'cancelled',
          has_landline: false,
          has_mobile: false,
          has_whatsapp: false,
        })
        .eq('id', tenantId);

      return { status: 200, body: { success: true, message: `Tenant ${tenantId} subscription cancelled` } };
    }
  }

  if (eventType === 'checkout.session.completed' || eventType === 'direct_payload') {
    const email = (
      dataObject.customer_details?.email ||
      dataObject.customer_email ||
      dataObject.email ||
      dataObject.metadata?.email ||
      ''
    ).toString().trim().toLowerCase();

    let planTier = (dataObject.metadata?.plan_tier || dataObject.metadata?.tier || 'base_tier').toString().toLowerCase();
    const validTiers = ['base_tier', 'foundation', 'basic', 'starter', 'premium', 'ultimate', 'trial'];
    if (!validTiers.includes(planTier)) {
      planTier = 'base_tier';
    }

    const tenantIdInput = dataObject.metadata?.tenant_id || dataObject.client_reference_id;

    if (!email && !tenantIdInput) {
      return { status: 200, body: { message: 'Ignored payload without email or tenant_id' } };
    }

    let targetTenantId = tenantIdInput;

    if (!targetTenantId && email) {
      const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = users.find((u: any) => u.email?.toLowerCase() === email);

      if (existingUser) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('tenant_id')
          .eq('id', existingUser.id)
          .maybeSingle();

        if (profile?.tenant_id) {
          targetTenantId = profile.tenant_id;
        }
      } else {
        const tempPassword = Math.random().toString(36).slice(-10) + 'A1!';
        const companyName = dataObject.metadata?.company_name || 'My Business';
        const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { company_name: companyName },
        });

        if (createErr) {
          return { status: 500, body: { error: createErr.message } };
        }

        if (newUser.user) {
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('tenant_id')
            .eq('id', newUser.user.id)
            .maybeSingle();

          if (profile?.tenant_id) {
            targetTenantId = profile.tenant_id;
          }
        }
      }
    }

    if (!targetTenantId) {
      return { status: 400, body: { error: 'Target tenant could not be resolved' } };
    }

    const stripeCustomerId = dataObject.customer;
    const sessionMetadata = dataObject.metadata || {};

    if (isBoltOnMetadata(sessionMetadata)) {
      const addonCatalogId = sessionMetadata.addon_catalog_id;
      if (stripeCustomerId) {
        await supabaseAdmin
          .from('tenants')
          .update({ stripe_customer_id: stripeCustomerId })
          .eq('id', targetTenantId);
      }

      if (!addonCatalogId) {
        console.error('[Stripe Webhook] Bolt-on checkout is missing addon_catalog_id; leaving plan_tier and minutes unchanged');
        return {
          status: 200,
          body: {
            success: false,
            error: 'Bolt-on checkout is missing addon_catalog_id',
            tenant_id: targetTenantId,
          },
        };
      }

      const activated = await activateBoltOnByCatalogId({
        supabaseAdmin,
        tenantId: targetTenantId,
        addonCatalogId,
        metadata: sessionMetadata,
        stripeSubscriptionId: stripeSubscriptionIdFrom(dataObject),
        stripeSubscriptionStatus: 'active',
        stripeSessionId: dataObject.id,
        allocateRollingCredits,
      });

      if (activated.retry) {
        return {
          status: 500,
          body: {
            success: false,
            error: activated.error || 'Failed to record one-off pack grant',
            tenant_id: targetTenantId,
          },
        };
      }

      if (!activated.ok) {
        console.error(`[Stripe Webhook] Bolt-on catalogue row missing for ${addonCatalogId}; leaving plan_tier and minutes unchanged`);
        return {
          status: 200,
          body: {
            success: false,
            error: `Bolt-on catalogue row missing for ${addonCatalogId}`,
            tenant_id: targetTenantId,
          },
        };
      }

      return {
        status: 200,
        body: {
          success: true,
          message: `Add-on ${activated.addonId} processed for tenant ${targetTenantId}`,
          tenant_id: targetTenantId,
        },
      };
    }

    const updatePayload: any = {
      plan_tier: planTier,
      is_active: true,
      subscription_status: 'active',
    };
    if (stripeCustomerId) {
      updatePayload.stripe_customer_id = stripeCustomerId;
    }

    const { error: updateError } = await supabaseAdmin
      .from('tenants')
      .update(updatePayload)
      .eq('id', targetTenantId);

    if (updateError) {
      return { status: 500, body: { error: 'Database update failed' } };
    }

    if (dataObject.line_items?.data) {
      const lineItemsResult = await processAddonLineItems(
        supabaseAdmin,
        targetTenantId,
        dataObject.line_items.data,
        'activate',
        allocateRollingCredits,
        {
          stripeSubscriptionStatus: 'active',
          stripeSubscriptionId: stripeSubscriptionIdFrom(dataObject),
        },
      );
      if (lineItemsResult.retry) {
        return {
          status: 500,
          body: {
            success: false,
            error: lineItemsResult.error || 'Bolt-on fulfilment failed',
            tenant_id: targetTenantId,
          },
        };
      }
    }

    const selectedAddonsStr = dataObject.metadata?.selected_addons;
    if (selectedAddonsStr && targetTenantId) {
      const addonIds = selectedAddonsStr.split(',').map((s: string) => s.trim()).filter(Boolean);
      for (const addonId of addonIds) {
        const activated = await activateBoltOnByCatalogId({
          supabaseAdmin,
          tenantId: targetTenantId,
          addonCatalogId: addonId,
          metadata: {},
          allocateRollingCredits,
        });
        if (activated.retry) {
          return {
            status: 500,
            body: {
              success: false,
              error: activated.error || 'Bolt-on fulfilment failed',
              tenant_id: targetTenantId,
            },
          };
        }
      }
    }

    await allocateRollingCredits(targetTenantId, 'voice_minutes', 10);

    return {
      status: 200,
      body: {
        success: true,
        message: `Tenant ${targetTenantId} activated on ${planTier} via Stripe`,
        tenant_id: targetTenantId,
        plan_tier: planTier,
      },
    };
  }

  return { status: 200, body: { message: `Event ${eventType} acknowledged` } };
}
