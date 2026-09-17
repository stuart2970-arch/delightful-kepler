import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { allocateRollingCredits } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase service role key');
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

/**
 * Sync tenant channel flags based on their active add-ons.
 * Called after any add-on activation or deactivation.
 */
async function syncChannelFlags(supabaseAdmin: any, tenantId: string) {
  await supabaseAdmin.rpc('sync_tenant_channel_flags', { p_tenant_id: tenantId });
}

/**
 * Process add-on line items from a Stripe subscription.
 * Matches stripe_price_id to addon_catalog and activates/deactivates add-ons.
 */
async function processAddonLineItems(
  supabaseAdmin: any,
  tenantId: string,
  lineItems: any[],
  action: 'activate' | 'deactivate'
) {
  for (const item of lineItems) {
    const priceId = item.price?.id || item.plan?.id;
    if (!priceId) continue;

    // Look up the addon in our catalog by stripe_price_id
    const { data: addon } = await supabaseAdmin
      .from('addon_catalog')
      .select('id, category, included_voice_minutes, included_sms, included_messages, included_data_chunks')
      .eq('stripe_price_id', priceId)
      .maybeSingle();

    if (!addon) continue; // Not an addon line item (could be the base subscription)

    if (action === 'activate') {
      // Upsert the active addon
      const { data: existing } = await supabaseAdmin
        .from('tenant_active_addons')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('addon_catalog_id', addon.id)
        .maybeSingle();

      if (existing) {
        await supabaseAdmin
          .from('tenant_active_addons')
          .update({
            is_active: true,
            activated_at: new Date().toISOString(),
            deactivated_at: null,
            stripe_subscription_item_id: item.id || null,
          })
          .eq('id', existing.id);
      } else {
        await supabaseAdmin
          .from('tenant_active_addons')
          .insert({
            tenant_id: tenantId,
            addon_catalog_id: addon.id,
            feature_id: addon.category,
            quantity: 1,
            is_active: true,
            activated_at: new Date().toISOString(),
            stripe_subscription_item_id: item.id || null,
          });
      }

      // Allocate rolling credits for voice/SMS packs
      if (addon.included_voice_minutes > 0) {
        await allocateRollingCredits(tenantId, 'voice_minutes', addon.included_voice_minutes, addon.id);
      }
      if (addon.included_sms > 0) {
        await allocateRollingCredits(tenantId, 'sms_messages', addon.included_sms, addon.id);
      }
      if (addon.included_messages > 0) {
        await allocateRollingCredits(tenantId, 'whatsapp_messages', addon.included_messages, addon.id);
      }

      // Log activation
      await supabaseAdmin.from('addon_audit_log').insert({
        tenant_id: tenantId,
        addon_catalog_id: addon.id,
        action: 'addon_activated',
        new_value: { stripe_price_id: priceId, stripe_item_id: item.id },
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

  // Sync channel flags after processing all line items
  await syncChannelFlags(supabaseAdmin, tenantId);
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.json().catch(() => ({}));
    const eventType = rawBody.type || 'direct_payload';
    console.log('[Stripe Webhook] Event received:', eventType);

    const event = rawBody;
    const dataObject = event.data?.object || rawBody;

    const supabaseAdmin = getSupabaseAdmin();

    // =====================================================================
    // Handle invoice.payment_succeeded — Auto-unlock account
    // =====================================================================
    if (eventType === 'invoice.payment_succeeded') {
      const customerId = dataObject.customer;
      const subscriptionId = dataObject.subscription;

      // Find tenant by stripe customer ID or subscription metadata
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

        // Re-allocate rolling credits for all active add-ons on renewal
        const { data: activeAddons } = await supabaseAdmin
          .from('tenant_active_addons')
          .select('addon_catalog_id, addon_catalog(included_voice_minutes, included_sms, included_messages)')
          .eq('tenant_id', tenantId)
          .eq('is_active', true);

        if (activeAddons) {
          for (const addon of activeAddons) {
            const catalog = (addon as any).addon_catalog;
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

        console.log(`[Stripe Webhook] Account unlocked and credits allocated for tenant ${tenantId}`);
        return NextResponse.json({ success: true, message: `Tenant ${tenantId} unlocked` });
      }
    }

    // =====================================================================
    // Handle invoice.payment_failed — Deactivate account
    // =====================================================================
    if (eventType === 'invoice.payment_failed') {
      const tenantId = dataObject.subscription_details?.metadata?.tenant_id
        || dataObject.metadata?.tenant_id;

      if (tenantId) {
        await supabaseAdmin
          .from('tenants')
          .update({ subscription_status: 'past_due' })
          .eq('id', tenantId);

        console.log(`[Stripe Webhook] Payment failed for tenant ${tenantId}, marked as past_due`);
        return NextResponse.json({ success: true, message: `Tenant ${tenantId} marked past_due` });
      }
    }

    // =====================================================================
    // Handle customer.subscription.updated — Detect add-on changes
    // =====================================================================
    if (eventType === 'customer.subscription.updated') {
      const tenantId = dataObject.metadata?.tenant_id;
      const items = dataObject.items?.data || [];

      if (tenantId && items.length > 0) {
        await processAddonLineItems(supabaseAdmin, tenantId, items, 'activate');
        console.log(`[Stripe Webhook] Subscription updated for tenant ${tenantId}, ${items.length} items processed`);
        return NextResponse.json({ success: true, message: 'Add-ons synced' });
      }
    }

    // =====================================================================
    // Handle customer.subscription.deleted — Deactivate all add-ons
    // =====================================================================
    if (eventType === 'customer.subscription.deleted') {
      const tenantId = dataObject.metadata?.tenant_id;

      if (tenantId) {
        // Deactivate all add-ons for this tenant
        await supabaseAdmin
          .from('tenant_active_addons')
          .update({ is_active: false, deactivated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId);

        // Update tenant status
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

        console.log(`[Stripe Webhook] Subscription cancelled for tenant ${tenantId}, all add-ons deactivated`);
        return NextResponse.json({ success: true, message: `Tenant ${tenantId} subscription cancelled` });
      }
    }

    // =====================================================================
    // Handle checkout.session.completed — Original flow (enhanced)
    // =====================================================================
    if (eventType === 'checkout.session.completed' || eventType === 'direct_payload') {
      const email = (
        dataObject.customer_details?.email ||
        dataObject.customer_email ||
        dataObject.email ||
        dataObject.metadata?.email ||
        ''
      ).toString().trim().toLowerCase();

      let planTier = (dataObject.metadata?.plan_tier || dataObject.metadata?.tier || 'base_tier').toString().toLowerCase();
      const validTiers = ['base_tier', 'basic', 'starter', 'premium', 'ultimate', 'trial'];
      if (!validTiers.includes(planTier)) {
        planTier = 'base_tier';
      }

      const tenantIdInput = dataObject.metadata?.tenant_id || dataObject.client_reference_id;

      if (!email && !tenantIdInput) {
        console.warn('[Stripe Webhook] Missing customer email or tenant_id in payload');
        return NextResponse.json({ message: 'Ignored payload without email or tenant_id' }, { status: 200 });
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
          // Auto-provision user on payment if missing
          const tempPassword = Math.random().toString(36).slice(-10) + 'A1!';
          const companyName = dataObject.metadata?.company_name || 'My Business';
          const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email,
            password: tempPassword,
            email_confirm: true,
            user_metadata: { company_name: companyName },
          });

          if (createErr) {
            console.error('[Stripe Webhook] Auto-provisioning user failed:', createErr);
            return NextResponse.json({ error: createErr.message }, { status: 500 });
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
        return NextResponse.json({ error: 'Target tenant could not be resolved' }, { status: 400 });
      }

      // Save Stripe customer ID for future lookups
      const stripeCustomerId = dataObject.customer;
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
        console.error('[Stripe Webhook] Error updating tenant:', updateError);
        return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
      }

      // Process any add-on line items from the checkout session
      if (dataObject.line_items?.data) {
        await processAddonLineItems(supabaseAdmin, targetTenantId, dataObject.line_items.data, 'activate');
      }

      // Allocate base tier voice minutes (10 mins)
      await allocateRollingCredits(targetTenantId, 'voice_minutes', 10);

      console.log(`[Stripe Webhook] Successfully activated tenant ${targetTenantId} on plan ${planTier}`);

      return NextResponse.json({
        success: true,
        message: `Tenant ${targetTenantId} activated on ${planTier} via Stripe`,
        tenant_id: targetTenantId,
        plan_tier: planTier,
      }, { status: 200 });
    }

    // Unhandled event type — acknowledge receipt
    return NextResponse.json({ message: `Event ${eventType} acknowledged` }, { status: 200 });

  } catch (err: any) {
    console.error('[Stripe Webhook] Unhandled error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
