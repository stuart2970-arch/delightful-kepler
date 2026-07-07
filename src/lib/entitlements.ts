import { SupabaseClient } from '@supabase/supabase-js';

export type EntitlementCheckResult = {
  allowed: boolean;
  error?: string;
  limit?: number;
  currentUsage?: number;
};

/**
 * Validates whether a tenant is allowed to perform an action based on their subscription tier
 * and current usage.
 * 
 * @param dbClient - A server-side Supabase client with admin or authenticated context
 * @param tenantId - The UUID of the tenant
 * @param featureId - The string ID of the feature (e.g. 'knowledge_data_chunks', 'message_allowance')
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
    // 1. Get Tenant's Plan Tier
    const { data: tenant, error: tenantError } = await dbClient
      .from('tenants')
      .select('plan_tier')
      .eq('id', tenantId)
      .single();

    if (tenantError || !tenant) {
      console.error(`[Entitlements] Error fetching tenant ${tenantId}:`, tenantError);
      return { allowed: false, error: 'Internal error: Could not verify tenant tier.' };
    }

    // 2. Get the Feature definition to see if it's metered
    const { data: feature, error: featureError } = await dbClient
      .from('features')
      .select('is_metered, name')
      .eq('id', featureId)
      .single();

    if (featureError || !feature) {
      console.error(`[Entitlements] Feature not found: ${featureId}`, featureError);
      return { allowed: false, error: 'Internal error: Invalid feature configuration.' };
    }

    // 3. Get the specific entitlement limit for this tier and feature
    const { data: entitlement, error: entitlementError } = await dbClient
      .from('tier_entitlements')
      .select('included_volume')
      .eq('tier_id', tenant.plan_tier)
      .eq('feature_id', featureId)
      .single();

    // If no entitlement row exists, or volume is explicitly 0, they don't have access.
    if (entitlementError && entitlementError.code !== 'PGRST116') {
      console.error(`[Entitlements] Error fetching entitlement for ${tenant.plan_tier} -> ${featureId}:`, entitlementError);
      return { allowed: false, error: 'Internal error: Could not load tier limits.' };
    }

    if (!entitlement || entitlement.included_volume === 0) {
      return { 
        allowed: false, 
        error: `Your current ${tenant.plan_tier} plan does not include access to ${feature.name}. Please upgrade to unlock this feature.`,
        limit: 0,
        currentUsage: 0
      };
    }

    // If included_volume is null, it means UNLIMITED.
    if (entitlement.included_volume === null) {
      return { allowed: true, limit: Infinity };
    }

    const limit = entitlement.included_volume;
    let currentUsage = 0;

    // 4. Calculate Current Usage
    // Handle specific hard-state features like knowledge chunks which count rows directly
    if (featureId === 'knowledge_data_chunks') {
      const { count, error: countError } = await dbClient
        .from('document_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

      if (countError) {
        console.error(`[Entitlements] Error counting document_chunks:`, countError);
        return { allowed: false, error: 'Internal error validating quota.' };
      }
      currentUsage = count || 0;
    } 
    // Handle rolling monthly metered features (like message_allowance)
    else if (feature.is_metered) {
      const firstDayOfMonth = new Date();
      firstDayOfMonth.setDate(1);
      firstDayOfMonth.setHours(0, 0, 0, 0);

      // Sum usage from the ledger for this month
      // Note: We use Postgres RPC or a quick select.
      const { data: ledgerRows, error: ledgerError } = await dbClient
        .from('usage_ledger')
        .select('quantity')
        .eq('tenant_id', tenantId)
        .eq('feature_id', featureId)
        .gte('recorded_at', firstDayOfMonth.toISOString());

      if (ledgerError) {
        console.error(`[Entitlements] Error summing usage_ledger:`, ledgerError);
        return { allowed: false, error: 'Internal error calculating monthly usage.' };
      }
      
      currentUsage = ledgerRows ? ledgerRows.reduce((sum, row) => sum + row.quantity, 0) : 0;
    }

    // 5. Enforce Boundary
    const totalProjectedVolume = currentUsage + requestedVolume;

    if (totalProjectedVolume > limit) {
      // Stub sending an email to the business owner about quota limits
      console.log(`[EMAIL STUB] Action Required: ${feature.name} Quota Exceeded for Tenant ${tenantId}`);
      console.log(`[EMAIL STUB] Body: You have reached your limit of ${limit} for ${feature.name}. Please upgrade your plan before your cycle renews.`);

      return {
        allowed: false,
        limit,
        currentUsage,
        error: `${feature.name} quota exceeded. Your ${tenant.plan_tier} plan limits you to ${limit} units. You have used ${currentUsage}, and this action requires ${requestedVolume} more. Please upgrade your active package plan to unlock higher capacity.`
      };
    }

    return { allowed: true, limit, currentUsage };

  } catch (err: any) {
    console.error(`[Entitlements] Unexpected error checking entitlement:`, err);
    return { allowed: false, error: 'An unexpected internal error occurred.' };
  }
}

/**
 * Logs a metered usage event into the usage_ledger.
 * Call this ONLY AFTER a successful action (e.g. after a message is generated).
 * 
 * @param dbClient - A server-side Supabase client
 * @param tenantId - The UUID of the tenant
 * @param featureId - The string ID of the feature (e.g. 'message_allowance')
 * @param quantity - The amount of units consumed (e.g. 1 message)
 * @param cost - The actual API cost associated with this usage (e.g. $0.001)
 * @param sectorTag - Optional metadata tagging (e.g. 'appointment_booking')
 */
export async function logMeteredUsage(
  dbClient: SupabaseClient,
  tenantId: string,
  featureId: string,
  quantity: number = 1,
  cost: number = 0,
  sectorTag?: string
): Promise<void> {
  const { error } = await dbClient
    .from('usage_ledger')
    .insert({
      tenant_id: tenantId,
      feature_id: featureId,
      quantity,
      actual_cost: cost,
      sector_tag: sectorTag || null
    });

  if (error) {
    // We log it but typically don't throw to avoid crashing the user flow just because logging failed.
    // In a high-stakes production environment, this might drop into a dead-letter queue.
    console.error(`[Entitlements] CRITICAL: Failed to log usage for ${featureId} (tenant ${tenantId}):`, error);
  } else {
    console.log(`[Entitlements] Logged ${quantity} ${featureId} units for tenant ${tenantId}. Cost: $${cost}`);
  }
}
