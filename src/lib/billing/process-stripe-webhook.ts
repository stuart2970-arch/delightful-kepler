import { allocateRollingCredits as allocateRollingCreditsDefault } from '@/lib/entitlements';
import { isBoltOnMetadata, mapAddonCategoryToFeatureId } from '@/lib/billing/bolt-on';
import { resolvePricePaidPence } from '@/lib/billing/account-ownership';

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
  ) => Promise<void>;
};

export type StripeWebhookResult = {
  status: number;
  body: Record<string, any>;
};

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

async function processAddonLineItems(
  supabaseAdmin: any,
  tenantId: string,
  lineItems: any[],
  action: 'activate' | 'deactivate',
  allocateRollingCredits: StripeWebhookDeps['allocateRollingCredits'],
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
      const { data: existing } = await supabaseAdmin
        .from('tenant_active_addons')
        .select('id, is_active')
        .eq('tenant_id', tenantId)
        .eq('addon_catalog_id', addon.id)
        .maybeSingle();

      const alreadyActive = Boolean(existing?.is_active);

      if (existing) {
        const { error: updateErr } = await supabaseAdmin
          .from('tenant_active_addons')
          .update({
            is_active: true,
            activated_at: new Date().toISOString(),
            deactivated_at: null,
            stripe_subscription_item_id: item.id || null,
            price_paid_pence: pricePaidPence,
          })
          .eq('id', existing.id);
        if (updateErr) console.error('[Stripe Webhook] Error updating active addon:', updateErr);
      } else {
        const { error: insertErr } = await supabaseAdmin
          .from('tenant_active_addons')
          .insert({
            tenant_id: tenantId,
            addon_catalog_id: addon.id,
            feature_id: featureId,
            quantity: 1,
            is_active: true,
            activated_at: new Date().toISOString(),
            stripe_subscription_item_id: item.id || null,
            price_paid_pence: pricePaidPence,
          });
        if (insertErr) console.error('[Stripe Webhook] Error inserting active addon:', insertErr);
      }

      if (!alreadyActive) {
        if (addon.included_voice_minutes > 0) {
          await allocateRollingCredits?.(tenantId, 'voice_minutes', addon.included_voice_minutes, addon.id);
        }
        if (addon.included_sms > 0) {
          await allocateRollingCredits?.(tenantId, 'sms_messages', addon.included_sms, addon.id);
        }
        if (addon.included_messages > 0) {
          await allocateRollingCredits?.(tenantId, 'whatsapp_messages', addon.included_messages, addon.id);
        }
      }

      await supabaseAdmin.from('addon_audit_log').insert({
        tenant_id: tenantId,
        addon_catalog_id: addon.id,
        action: 'addon_activated',
        new_value: { stripe_price_id: priceId, stripe_item_id: item.id, price_paid_pence: pricePaidPence, custom_price_pence: pricePaidPence },
        summary: `Activated ${addon.id} via Stripe subscription.`,
      });
    } else if (action === 'deactivate') {
      await supabaseAdmin
        .from('tenant_active_addons')
        .update({
          is_active: false,
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
}

async function activateBoltOnByCatalogId(options: {
  supabaseAdmin: any;
  tenantId: string;
  addonCatalogId: string;
  metadata?: Record<string, any>;
  subscriptionItemId?: string | null;
  stripeSessionId?: string | null;
  stripeUnitAmount?: number | null;
  allocateRollingCredits: StripeWebhookDeps['allocateRollingCredits'];
}): Promise<{ ok: boolean; addonId?: string; oneOff?: boolean }> {
  const {
    supabaseAdmin,
    tenantId,
    addonCatalogId,
    metadata = {},
    subscriptionItemId,
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

  const { data: existing } = await supabaseAdmin
    .from('tenant_active_addons')
    .select('id, is_active')
    .eq('tenant_id', tenantId)
    .eq('addon_catalog_id', addon.id)
    .maybeSingle();

  const alreadyActive = Boolean(existing?.is_active);
  const featureId = mapAddonCategoryToFeatureId(addon.category);

  let alreadyGrantedForSession = false;
  if (stripeSessionId) {
    const { data: priorAudits } = await supabaseAdmin
      .from('addon_audit_log')
      .select('id, new_value')
      .eq('tenant_id', tenantId)
      .eq('addon_catalog_id', addon.id);
    alreadyGrantedForSession = Boolean(
      (priorAudits || []).some((row: any) => row?.new_value?.stripe_session_id === stripeSessionId),
    );
  }

  if (!isOneOff) {
    if (existing) {
      const updatePayload: Record<string, any> = {
        is_active: true,
        deactivated_at: null,
        stripe_subscription_item_id: subscriptionItemId || null,
        price_paid_pence: pricePaidPence,
        feature_id: featureId,
      };
      if (!existing.is_active) {
        updatePayload.activated_at = new Date().toISOString();
      }
      const { error: updateErr } = await supabaseAdmin
        .from('tenant_active_addons')
        .update(updatePayload)
        .eq('id', existing.id);
      if (updateErr) console.error('[Stripe Webhook] Error updating active addon:', updateErr);
    } else {
      const { error: insertErr } = await supabaseAdmin
        .from('tenant_active_addons')
        .insert({
          tenant_id: tenantId,
          addon_catalog_id: addon.id,
          feature_id: featureId,
          quantity: 1,
          is_active: true,
          activated_at: new Date().toISOString(),
          stripe_subscription_item_id: subscriptionItemId || null,
          price_paid_pence: pricePaidPence,
        });
      if (insertErr) console.error('[Stripe Webhook] Error inserting active addon:', insertErr);
    }
  }

  if (!alreadyActive && !alreadyGrantedForSession) {
    if (voiceMinutes > 0) {
      await allocateRollingCredits?.(tenantId, 'voice_minutes', voiceMinutes, addon.id);
    }
    if (smsCount > 0) {
      await allocateRollingCredits?.(tenantId, 'sms_messages', smsCount, addon.id);
    }
    if (messagesCount > 0) {
      await allocateRollingCredits?.(tenantId, 'whatsapp_messages', messagesCount, addon.id);
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

  if (!alreadyActive && !alreadyGrantedForSession) {
    await supabaseAdmin.from('addon_audit_log').insert({
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
        stripe_subscription_id: subscriptionItemId || null,
        stripe_session_id: stripeSessionId,
      },
      summary: isOneOff
        ? (addon.category === 'voice_pack'
            ? `Purchased one-off pack of ${voiceMinutes} voice minutes for £${((customPricePence || addon.monthly_price_pence) / 100).toFixed(2)} (valid for 3 months).`
            : `Purchased one-off pack of ${smsCount} SMS messages for £${((customPricePence || addon.monthly_price_pence) / 100).toFixed(2)} (valid for 3 months).`)
        : `Activated ${addon.id} (${voiceMinutes} voice mins, ${smsCount} SMS) via Stripe checkout.`,
    });
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
        subscriptionItemId: firstItem?.id || dataObject.id || null,
        stripeUnitAmount: firstItem?.price?.unit_amount ?? null,
        allocateRollingCredits,
      });
      if (activated.ok) {
        return { status: 200, body: { success: true, message: 'Add-ons synced' } };
      }
    }

    if (tenantId && items.length > 0 && !isBoltOnMetadata(metadata)) {
      await processAddonLineItems(supabaseAdmin, tenantId, items, 'activate', allocateRollingCredits);
      return { status: 200, body: { success: true, message: 'Add-ons synced' } };
    }
  }

  if (eventType === 'customer.subscription.deleted') {
    const metadata = dataObject.metadata || {};
    const tenantId = metadata.tenant_id;
    const addonCatalogId = metadata.addon_catalog_id;

    if (tenantId) {
      if (isBoltOnMetadata(metadata) && addonCatalogId) {
        await supabaseAdmin
          .from('tenant_active_addons')
          .update({ is_active: false, deactivated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId)
          .eq('addon_catalog_id', addonCatalogId);

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

      await supabaseAdmin
        .from('tenant_active_addons')
        .update({ is_active: false, deactivated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId);

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
        subscriptionItemId: dataObject.subscription || null,
        stripeSessionId: dataObject.id,
        allocateRollingCredits,
      });

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
      await processAddonLineItems(supabaseAdmin, targetTenantId, dataObject.line_items.data, 'activate', allocateRollingCredits);
    }

    const selectedAddonsStr = dataObject.metadata?.selected_addons;
    if (selectedAddonsStr && targetTenantId) {
      const addonIds = selectedAddonsStr.split(',').map((s: string) => s.trim()).filter(Boolean);
      for (const addonId of addonIds) {
        await activateBoltOnByCatalogId({
          supabaseAdmin,
          tenantId: targetTenantId,
          addonCatalogId: addonId,
          metadata: {},
          allocateRollingCredits,
        });
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
