import { createClient } from '@supabase/supabase-js';

// =========================================================================
// Admin Client
// =========================================================================
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase admin credentials');
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

// =========================================================================
// Types
// =========================================================================
export type EntitlementCheckResult = {
  allowed: boolean;
  error?: string;
  limit?: number;
  currentUsage?: number;
};

export type ChannelFlags = {
  has_landline: boolean;
  has_mobile: boolean;
  has_whatsapp: boolean;
};

export type ActiveAddon = {
  id: string;
  addon_catalog_id: string;
  name: string;
  category: string;
  monthly_price_pence: number;
  included_voice_minutes: number;
  included_sms: number;
  included_messages: number;
  included_data_chunks: number;
  is_active: boolean;
  activated_at: string;
};

export type RolloverBalance = {
  voice_minutes_allocated: number;
  voice_minutes_consumed: number;
  voice_minutes_remaining: number;
  sms_allocated: number;
  sms_consumed: number;
  sms_remaining: number;
};

export type CapacityThreshold = {
  featureId: string;
  featureName: string;
  percentUsed: number;
  currentUsage: number;
  limit: number;
  upgradeCategory: string;
  upgradeAddonId: string;
  upgradeAddonName: string;
  upgradePricePence: number;
};

// Feature ID mapping for bolt-on categories
const FEATURE_TO_UPGRADE_MAP: Record<string, { category: string; addonId: string; addonName: string; pricePence: number }> = {
  voice_minutes: { category: 'voice_pack', addonId: 'voice_pack_20', addonName: '20 Voice Minutes Pack', pricePence: 1500 },
  sms_messages: { category: 'sms_pack', addonId: 'sms_pack_100', addonName: '100 SMS Pack', pricePence: 599 },
  knowledge_data_chunks: { category: 'data_pack', addonId: 'data_pack_500', addonName: '500 Knowledge Base Chunks', pricePence: 999 },
  whatsapp_messages: { category: 'whatsapp', addonId: 'whatsapp_addon', addonName: 'WhatsApp (Add-on)', pricePence: 999 },
};

// =========================================================================
// Channel Flags
// =========================================================================
export async function getTenantChannelFlags(tenantId: string): Promise<ChannelFlags> {
  const supabase = createAdminClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('has_landline, has_mobile, has_whatsapp')
    .eq('id', tenantId)
    .single();

  return {
    has_landline: tenant?.has_landline ?? false,
    has_mobile: tenant?.has_mobile ?? false,
    has_whatsapp: tenant?.has_whatsapp ?? false,
  };
}

// =========================================================================
// Active Add-ons
// =========================================================================
export async function getTenantActiveAddons(tenantId: string): Promise<ActiveAddon[]> {
  const supabase = createAdminClient();
  const { data: addons } = await supabase
    .from('tenant_active_addons')
    .select(`
      id,
      addon_catalog_id,
      is_active,
      activated_at,
      addon_catalog (
        name,
        category,
        monthly_price_pence,
        included_voice_minutes,
        included_sms,
        included_messages,
        included_data_chunks
      )
    `)
    .eq('tenant_id', tenantId)
    .eq('is_active', true);

  if (!addons) return [];

  return addons.map((a: any) => ({
    id: a.id,
    addon_catalog_id: a.addon_catalog_id,
    name: a.addon_catalog?.name || '',
    category: a.addon_catalog?.category || '',
    monthly_price_pence: a.addon_catalog?.monthly_price_pence || 0,
    included_voice_minutes: a.addon_catalog?.included_voice_minutes || 0,
    included_sms: a.addon_catalog?.included_sms || 0,
    included_messages: a.addon_catalog?.included_messages || 0,
    included_data_chunks: a.addon_catalog?.included_data_chunks || 0,
    is_active: a.is_active,
    activated_at: a.activated_at,
  }));
}

// =========================================================================
// 3-Month Rolling Balance (Voice Minutes & SMS)
// =========================================================================
export async function getRolloverBalance(tenantId: string): Promise<RolloverBalance> {
  const supabase = createAdminClient();
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  // Query allocations (credits) that haven't expired
  const { data: allocations } = await supabase
    .from('usage_ledger')
    .select('feature_id, quantity')
    .eq('tenant_id', tenantId)
    .eq('usage_type', 'allocation')
    .in('feature_id', ['voice_minutes', 'sms_messages'])
    .gte('expires_at', now.toISOString())
    .gte('billing_period_start', threeMonthsAgo.toISOString());

  // Query consumptions in the same window
  const { data: consumptions } = await supabase
    .from('usage_ledger')
    .select('feature_id, quantity')
    .eq('tenant_id', tenantId)
    .eq('usage_type', 'consumption')
    .in('feature_id', ['voice_minutes', 'sms_messages'])
    .gte('recorded_at', threeMonthsAgo.toISOString());

  const sumByFeature = (rows: any[] | null, featureId: string): number => {
    if (!rows) return 0;
    return rows
      .filter(r => r.feature_id === featureId)
      .reduce((sum, r) => sum + Number(r.quantity || 0), 0);
  };

  const voiceAllocated = sumByFeature(allocations, 'voice_minutes');
  const voiceConsumed = sumByFeature(consumptions, 'voice_minutes');
  const smsAllocated = sumByFeature(allocations, 'sms_messages');
  const smsConsumed = sumByFeature(consumptions, 'sms_messages');

  return {
    voice_minutes_allocated: voiceAllocated,
    voice_minutes_consumed: voiceConsumed,
    voice_minutes_remaining: Math.max(0, voiceAllocated - voiceConsumed),
    sms_allocated: smsAllocated,
    sms_consumed: smsConsumed,
    sms_remaining: Math.max(0, smsAllocated - smsConsumed),
  };
}

// =========================================================================
// Effective Limit (Modular Bolt-On Evaluation)
// =========================================================================
export async function getTenantEffectiveLimit(tenantId: string, featureId: string): Promise<number | null> {
  const supabase = createAdminClient();

  // 1. Check if an explicit tenant-level override exists (Grandfathering protection)
  const { data: override } = await supabase
    .from('tenant_feature_overrides')
    .select('override_limit_value')
    .eq('tenant_id', tenantId)
    .eq('feature_id', featureId)
    .single();

  if (override) {
    return override.override_limit_value;
  }

  // 2. Check active bolt-on add-ons from addon_catalog
  const { data: addons } = await supabase
    .from('tenant_active_addons')
    .select('addon_catalog_id, addon_catalog(included_voice_minutes, included_sms, included_messages, included_data_chunks)')
    .eq('tenant_id', tenantId)
    .eq('is_active', true);

  let addonBonus = 0;
  if (addons && addons.length > 0) {
    for (const addon of addons) {
      const catalog = (addon as any).addon_catalog;
      if (!catalog) continue;

      switch (featureId) {
        case 'voice_minutes':
        case 'vapi_voice_minutes':
        case 'voice_agent_minutes_web':
          addonBonus += catalog.included_voice_minutes || 0;
          break;
        case 'sms_messages':
        case 'sms':
        case 'sms_marketing':
        case 'messaging_sms':
          addonBonus += catalog.included_sms || 0;
          break;
        case 'whatsapp_messages':
        case 'whatsapp_omni':
          addonBonus += catalog.included_messages || 0;
          break;
        case 'knowledge_data_chunks':
        case 'data_chunks_addon':
          addonBonus += catalog.included_data_chunks || 0;
          break;
      }
    }
  }

  // Also check legacy tenant_active_addons with feature_id (backward compat)
  const { data: legacyAddons } = await supabase
    .from('tenant_active_addons')
    .select('quantity')
    .eq('tenant_id', tenantId)
    .eq('feature_id', featureId)
    .is('addon_catalog_id', null);

  const legacyBonus = legacyAddons?.reduce((acc, curr) => acc + (curr.quantity || 0), 0) || 0;
  addonBonus += legacyBonus;

  // 3. Fall back to base subscription tier entitlements
  const { data: tenant } = await supabase
    .from('tenants')
    .select('plan_tier, is_active, trial_ends_at')
    .eq('id', tenantId)
    .single();

  // If tenant is marked inactive (unpaid / paused), block feature volume
  if (tenant && tenant.is_active === false) {
    if (tenant.trial_ends_at && new Date(tenant.trial_ends_at) < new Date()) {
      return 0;
    }
    return 0;
  }

  // Normalize feature_id for shared pool lookups
  let lookupFeatureId = featureId;
  if (featureId === 'vapi_voice_minutes' || featureId === 'voice_agent_minutes_web') {
    lookupFeatureId = 'voice_minutes';
  }
  if (featureId === 'sms' || featureId === 'sms_marketing' || featureId === 'messaging_sms') {
    lookupFeatureId = 'sms_messages';
  }
  if (featureId === 'whatsapp_omni') {
    lookupFeatureId = 'whatsapp_messages';
  }

  const { data: entitlement } = await supabase
    .from('tier_entitlements')
    .select('limit_value')
    .eq('tier_id', tenant?.plan_tier || 'base_tier')
    .eq('feature_id', lookupFeatureId)
    .single();

  if (!entitlement) {
    return addonBonus > 0 ? addonBonus : 0;
  }

  const baseLimit = entitlement.limit_value;

  // If base limit is null (unlimited), it stays unlimited.
  if (baseLimit === null) return null;
  return baseLimit + addonBonus;
}

// =========================================================================
// Feature Entitlement Check (with rolling window for voice/SMS)
// =========================================================================
export async function checkFeatureEntitlement(
  dbClient: any,
  tenantId: string,
  featureId: string,
  requestedVolume: number = 1
): Promise<EntitlementCheckResult> {
  const limit = await getTenantEffectiveLimit(tenantId, featureId);
  if (limit === 0) {
    return { allowed: false, error: 'Feature not included in your plan.', limit: 0, currentUsage: 0 };
  }
  if (limit === null) {
    return { allowed: true };
  }

  // For voice and SMS features, use 3-month rolling window
  const rollingFeatures = ['voice_minutes', 'vapi_voice_minutes', 'voice_agent_minutes_web', 'sms_messages', 'sms', 'sms_marketing', 'messaging_sms'];
  const isRolling = rollingFeatures.includes(featureId);

  let currentUsage = 0;

  if (isRolling) {
    // Use rollover balance for voice/SMS
    const balance = await getRolloverBalance(tenantId);
    const normalizedId = (featureId === 'voice_minutes' || featureId === 'vapi_voice_minutes' || featureId === 'voice_agent_minutes_web')
      ? 'voice' : 'sms';

    if (normalizedId === 'voice') {
      // For rolling features, the "limit" is the allocated amount and "usage" is consumed
      currentUsage = balance.voice_minutes_consumed;
      const effectiveLimit = balance.voice_minutes_allocated > 0 ? balance.voice_minutes_allocated : limit;
      if (currentUsage + requestedVolume > effectiveLimit) {
        return {
          allowed: false,
          limit: effectiveLimit,
          currentUsage,
          error: `Voice minutes quota exceeded. Allocated: ${effectiveLimit}. Used: ${currentUsage}.`
        };
      }
      return { allowed: true, limit: effectiveLimit, currentUsage };
    } else {
      currentUsage = balance.sms_consumed;
      const effectiveLimit = balance.sms_allocated > 0 ? balance.sms_allocated : limit;
      if (currentUsage + requestedVolume > effectiveLimit) {
        return {
          allowed: false,
          limit: effectiveLimit,
          currentUsage,
          error: `SMS quota exceeded. Allocated: ${effectiveLimit}. Used: ${currentUsage}.`
        };
      }
      return { allowed: true, limit: effectiveLimit, currentUsage };
    }
  }

  // Standard monthly window for non-rolling features
  const firstDay = new Date();
  firstDay.setDate(1);
  firstDay.setHours(0, 0, 0, 0);

  const { data: usageRows } = await dbClient
    .from('usage_ledger')
    .select('quantity')
    .eq('tenant_id', tenantId)
    .eq('feature_id', featureId)
    .gte('recorded_at', firstDay.toISOString());

  currentUsage = usageRows ? usageRows.reduce((sum: number, r: any) => sum + Number(r.quantity), 0) : 0;

  if (currentUsage + requestedVolume > limit) {
    return {
      allowed: false,
      limit,
      currentUsage,
      error: `Quota exceeded. Limit: ${limit}. Used: ${currentUsage}.`
    };
  }

  return { allowed: true, limit, currentUsage };
}

// =========================================================================
// 85% Capacity Threshold Checker
// Points users to bolt-on upgrades (not percentage-based tier upgrades)
// =========================================================================
export async function checkCapacityThresholds(
  tenantId: string
): Promise<CapacityThreshold[]> {
  const thresholds: CapacityThreshold[] = [];

  const meteredFeatures = [
    { id: 'knowledge_data_chunks', name: 'Knowledge Base Data Chunks' },
    { id: 'voice_minutes', name: 'Shared Voice Minutes' },
    { id: 'sms_messages', name: 'SMS Messages' },
    { id: 'message_allowance', name: 'Monthly Chat Messages' },
    { id: 'whatsapp_messages', name: 'WhatsApp Messages' },
  ];

  const supabase = createAdminClient();
  const firstDay = new Date();
  firstDay.setDate(1);
  firstDay.setHours(0, 0, 0, 0);

  for (const feature of meteredFeatures) {
    const limit = await getTenantEffectiveLimit(tenantId, feature.id);
    if (limit === null || limit === 0) continue;

    let currentUsage = 0;

    // For rolling features, use rollover balance
    if (feature.id === 'voice_minutes' || feature.id === 'sms_messages') {
      const balance = await getRolloverBalance(tenantId);
      if (feature.id === 'voice_minutes') {
        currentUsage = balance.voice_minutes_consumed;
      } else {
        currentUsage = balance.sms_consumed;
      }
    } else {
      // Standard monthly count
      const { data: usageRows } = await supabase
        .from('usage_ledger')
        .select('quantity')
        .eq('tenant_id', tenantId)
        .eq('feature_id', feature.id)
        .gte('recorded_at', firstDay.toISOString());

      currentUsage = usageRows
        ? usageRows.reduce((sum: number, r: any) => sum + Number(r.quantity || 0), 0)
        : 0;

      // For knowledge_data_chunks, count actual chunks in document_chunks
      if (feature.id === 'knowledge_data_chunks') {
        const { count } = await supabase
          .from('document_chunks')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId);
        currentUsage = count || 0;
      }
    }

    const percentUsed = Math.round((currentUsage / limit) * 100);

    if (percentUsed >= 85) {
      const upgradeInfo = FEATURE_TO_UPGRADE_MAP[feature.id] || {
        category: 'data_pack',
        addonId: 'data_pack_500',
        addonName: '500 Knowledge Base Chunks',
        pricePence: 999,
      };

      thresholds.push({
        featureId: feature.id,
        featureName: feature.name,
        percentUsed,
        currentUsage,
        limit,
        upgradeCategory: upgradeInfo.category,
        upgradeAddonId: upgradeInfo.addonId,
        upgradeAddonName: upgradeInfo.addonName,
        upgradePricePence: upgradeInfo.pricePence,
      });
    }
  }

  return thresholds;
}

// =========================================================================
// Metered Usage Logging
// =========================================================================
export async function logMeteredUsage(
  dbClient: any,
  tenantId: string,
  featureId: string,
  quantity: number = 1,
  description?: string
): Promise<void> {
  // Write to both usage_ledger (for entitlement checks) and usage_logs (for analytics)
  await dbClient.from('usage_ledger').insert({
    tenant_id: tenantId,
    feature_id: featureId,
    quantity,
    usage_type: 'consumption',
    recorded_at: new Date().toISOString(),
  });

  await dbClient.from('usage_logs').insert({
    tenant_id: tenantId,
    feature_id: featureId,
    amount: quantity,
    description: description || null,
  });
}

// =========================================================================
// Allocate Rolling Credits (called on subscription renewal)
// =========================================================================
export async function allocateRollingCredits(
  tenantId: string,
  featureId: string,
  quantity: number,
  addonCatalogId?: string
): Promise<void> {
  const supabase = createAdminClient();
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + 3);

  await supabase.from('usage_ledger').insert({
    tenant_id: tenantId,
    feature_id: featureId,
    quantity,
    usage_type: 'allocation',
    billing_period_start: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    addon_catalog_id: addonCatalogId || null,
    recorded_at: now.toISOString(),
  });
}
