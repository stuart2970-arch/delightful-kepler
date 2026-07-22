import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase admin credentials");
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET() {
  try {
    const supabase = createAdminClient();
    
    // Fetch tiers joined with entitlements and feature metadata
    const { data, error } = await supabase
      .from('tier_entitlements')
      .select(`
        tier_id,
        limit_value,
        feature_id,
        features (id, name, is_metered, category_id)
      `);
  
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    const { tier_id, feature_id, limit_value } = await request.json();

    // 1. Fetch the old limit before changing it
    const { data: oldEntitlement } = await supabase
      .from('tier_entitlements')
      .select('limit_value')
      .eq('tier_id', tier_id)
      .eq('feature_id', feature_id)
      .single();

    const oldLimit = oldEntitlement?.limit_value === undefined ? 0 : oldEntitlement.limit_value;
    
    // Determine if limit decreased
    let isDecrease = false;
    if (oldLimit === null && limit_value !== null) {
      isDecrease = true; // Unlimited -> Limited
    } else if (oldLimit !== null && limit_value !== null && oldLimit > limit_value) {
      isDecrease = true; // e.g. 5000 -> 3000
    }

    if (isDecrease) {
      // Grandfathering: Protect existing tenants
      // Fetch all tenants currently on this tier
      const { data: tenants } = await supabase
        .from('tenants')
        .select('id')
        .eq('plan_tier', tier_id);
        
      if (tenants && tenants.length > 0) {
        // Fetch existing overrides to avoid double overriding
        const { data: existingOverrides } = await supabase
          .from('tenant_feature_overrides')
          .select('tenant_id')
          .eq('feature_id', feature_id)
          .in('tenant_id', tenants.map(t => t.id));
          
        const existingTenantIds = new Set(existingOverrides?.map(o => o.tenant_id) || []);
        
        const overridesToInsert = tenants
          .filter(t => !existingTenantIds.has(t.id))
          .map(t => ({
            tenant_id: t.id,
            feature_id: feature_id,
            override_limit_value: oldLimit,
            reason: 'Grandfathered (Tier limit reduced)'
          }));
          
        if (overridesToInsert.length > 0) {
          const { error: overrideError } = await supabase
            .from('tenant_feature_overrides')
            .insert(overridesToInsert);
          
          if (overrideError) {
            console.error('Error applying grandfathered overrides:', overrideError);
          }
        }
      }
    }

    // 2. Upsert the new limit configuration dynamically
    const { data, error } = await supabase
      .from('tier_entitlements')
      .upsert({ tier_id, feature_id, limit_value }, { onConflict: 'tier_id,feature_id' })
      .select();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // 3. Log the change
    await supabase.from('entitlement_change_logs').insert({
      feature_id: feature_id,
      old_limit: oldLimit,
      new_limit: limit_value,
      change_reason: `SuperAdmin global tier limit change for ${tier_id}`
    });

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
