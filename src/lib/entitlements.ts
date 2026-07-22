import { createClient } from '@supabase/supabase-js';

// We need an admin client to fetch entitlements securely bypassing RLS
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase admin credentials");
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

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

  // 2. Check if they have an active add-on pack for this feature
  const { data: addons } = await supabase
    .from('tenant_active_addons')
    .select('quantity')
    .eq('tenant_id', tenantId)
    .eq('feature_id', featureId);

  const addonBonus = addons?.reduce((acc, curr) => acc + (curr.quantity || 0), 0) || 0;

  // 3. Fall back to their base subscription tier entitlements
  const { data: tenant } = await supabase
    .from('tenants')
    .select('plan_tier')
    .eq('id', tenantId)
    .single();

  const { data: entitlement } = await supabase
    .from('tier_entitlements')
    .select('limit_value')
    .eq('tier_id', tenant?.plan_tier || 'basic')
    .eq('feature_id', featureId)
    .single();

  // If there is no entitlement row, we assume 0 (no access).
  if (!entitlement) {
    return addonBonus > 0 ? addonBonus : 0;
  }

  const baseLimit = entitlement.limit_value;

  // If base limit is null (unlimited), it stays unlimited. Otherwise, add any bolt-on packages.
  if (baseLimit === null) return null;
  return baseLimit + addonBonus;
}

export type EntitlementCheckResult = {
  allowed: boolean;
  error?: string;
  limit?: number;
  currentUsage?: number;
};

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

  // Check usage
  const firstDay = new Date();
  firstDay.setDate(1);
  firstDay.setHours(0, 0, 0, 0);

  const { data: usageRows } = await dbClient
    .from('usage_ledger')
    .select('quantity')
    .eq('tenant_id', tenantId)
    .eq('feature_id', featureId)
    .gte('recorded_at', firstDay.toISOString());

  const currentUsage = usageRows ? usageRows.reduce((sum: number, r: any) => sum + Number(r.quantity), 0) : 0;

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

export async function logMeteredUsage(
  dbClient: any,
  tenantId: string,
  featureId: string,
  quantity: number = 1,
  description?: string
): Promise<void> {
  await dbClient.from('usage_logs').insert({
    tenant_id: tenantId,
    feature_id: featureId,
    amount: quantity,
    description: description || null
  });
}
