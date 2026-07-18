import { SupabaseClient } from '@supabase/supabase-js';

export type EntitlementCheckResult = {
  allowed: boolean;
  error?: string;
  limit?: number;
  currentUsage?: number;
};

/**
 * Validates whether a tenant is allowed to perform an action based on their
 * tenant_entitlements record and usage_logs.
 * 
 * @param dbClient - A server-side Supabase client with admin or authenticated context
 * @param tenantId - The UUID of the tenant
 * @param featureId - The string ID of the feature (e.g. 'knowledge_base_crawls', 'llm_tokens')
 * @param requestedVolume - How many units are being requested right now (default: 1)
 * @returns { allowed: boolean, error?: string, limit?: number, currentUsage?: number }
 */
export async function checkFeatureEntitlement(
  dbClient: SupabaseClient,
  tenantId: string,
  featureId: string,
  requestedVolume: number = 1
): Promise<EntitlementCheckResult> {
  try {
    // 1. Get the Feature definition
    const { data: feature, error: featureError } = await dbClient
      .from('features')
      .select('name, is_metered')
      .eq('id', featureId)
      .single();

    if (featureError || !feature) {
      console.error(`[Entitlements] Feature not found: ${featureId}`, featureError);
      return { allowed: false, error: 'Internal error: Invalid feature configuration.' };
    }

    // 2. Get the specific entitlement for this tenant and feature
    const { data: entitlement, error: entitlementError } = await dbClient
      .from('tenant_entitlements')
      .select('is_enabled, numeric_limit, used_amount, reset_period')
      .eq('tenant_id', tenantId)
      .eq('feature_id', featureId)
      .single();

    if (entitlementError && entitlementError.code !== 'PGRST116') {
      console.error(`[Entitlements] Error fetching entitlement for ${tenantId} -> ${featureId}:`, entitlementError);
      return { allowed: false, error: 'Internal error: Could not load tenant entitlements.' };
    }

    if (!entitlement) {
      return { 
        allowed: false, 
        error: `Your plan does not include access to ${feature.name}. Please upgrade to unlock this feature.`,
        limit: 0,
        currentUsage: 0
      };
    }

    // Handle boolean features
    if (feature.type === 'boolean') {
      if (!entitlement.is_enabled) {
        return { allowed: false, error: `Access to ${feature.name} is disabled for your account.` };
      }
      return { allowed: true };
    }

    // Handle numeric features (e.g. metered usage)
    if (feature.type === 'numeric') {
      if (!entitlement.is_enabled) {
        return { allowed: false, error: `Access to ${feature.name} is disabled for your account.` };
      }

      const limit = Number(entitlement.numeric_limit);
      const currentUsage = Number(entitlement.used_amount);

      // If limit is 0 or very large, treat as unlimited or soft limit.
      // We will enforce the limit strictly if > 0.
      if (limit > 0 && (currentUsage + requestedVolume > limit)) {
        console.log(`[EMAIL STUB] Action Required: ${feature.name} Quota Exceeded for Tenant ${tenantId}`);
        return {
          allowed: false,
          limit,
          currentUsage,
          error: `${feature.name} quota exceeded. Your plan limits you to ${limit} units. You have used ${currentUsage}, and this action requires ${requestedVolume} more. Please upgrade your active package plan to unlock higher capacity.`
        };
      }

      return { allowed: true, limit, currentUsage };
    }

    return { allowed: true };

  } catch (err: unknown) {
    console.error(`[Entitlements] Unexpected error checking entitlement:`, err);
    return { allowed: false, error: 'An unexpected internal error occurred.' };
  }
}

/**
 * Logs a metered usage event into usage_logs and updates tenant_entitlements.
 * Call this ONLY AFTER a successful action.
 * 
 * @param dbClient - A server-side Supabase client
 * @param tenantId - The UUID of the tenant
 * @param featureId - The string ID of the feature
 * @param quantity - The amount of units consumed
 * @param description - Description of the usage
 */
export async function logMeteredUsage(
  dbClient: SupabaseClient,
  tenantId: string,
  featureId: string,
  quantity: number = 1,
  description?: string
): Promise<void> {
  // Insert log
  const { error: logError } = await dbClient
    .from('usage_logs')
    .insert({
      tenant_id: tenantId,
      feature_id: featureId,
      amount: quantity,
      description: description || null
    });

  if (logError) {
    console.error(`[Entitlements] CRITICAL: Failed to log usage for ${featureId} (tenant ${tenantId}):`, logError);
    return;
  }

  // Atomically increment the used_amount in tenant_entitlements using RPC or direct update if we fetch first
  // Note: For production at scale, an RPC function to increment safely is recommended.
  const { data: currentEntitlement } = await dbClient
    .from('tenant_entitlements')
    .select('used_amount')
    .eq('tenant_id', tenantId)
    .eq('feature_id', featureId)
    .single();

  if (currentEntitlement) {
    await dbClient
      .from('tenant_entitlements')
      .update({ used_amount: Number(currentEntitlement.used_amount) + quantity })
      .eq('tenant_id', tenantId)
      .eq('feature_id', featureId);
  }

  console.log(`[Entitlements] Logged ${quantity} ${featureId} units for tenant ${tenantId}.`);
}
