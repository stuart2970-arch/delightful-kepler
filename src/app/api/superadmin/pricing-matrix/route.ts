import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    
    // Fetch all tiers, features, and entitlements
    const [tiersRes, featuresRes, entitlementsRes] = await Promise.all([
      supabaseAdmin.from('subscription_tiers').select('*').order('created_at', { ascending: true }),
      supabaseAdmin.from('features').select('*, feature_categories(name)').order('created_at', { ascending: true }),
      supabaseAdmin.from('tier_entitlements').select('*')
    ]);

    if (tiersRes.error) throw tiersRes.error;
    if (featuresRes.error) throw featuresRes.error;
    if (entitlementsRes.error) throw entitlementsRes.error;

    return NextResponse.json({
      tiers: tiersRes.data,
      features: featuresRes.data,
      entitlements: entitlementsRes.data
    });
  } catch (err: any) {
    console.error('Error fetching pricing matrix:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, payload } = body;
    const supabaseAdmin = getSupabaseAdmin();

    if (action === 'CREATE_TIER_VERSION') {
      const { newTierId, newTierName, baseTierId, entitlements } = payload;
      
      // 1. Create the new tier
      const { error: tierError } = await supabaseAdmin
        .from('subscription_tiers')
        .insert({ id: newTierId, name: newTierName, is_active: true });
      if (tierError) throw tierError;

      // 2. Map old tier to inactive (legacy) if we are replacing it
      if (baseTierId) {
        await supabaseAdmin
          .from('subscription_tiers')
          .update({ is_active: false })
          .eq('id', baseTierId);
      }

      // 3. Insert entitlements
      if (entitlements && entitlements.length > 0) {
        const toInsert = entitlements.map((ent: any) => ({
          tier_id: newTierId,
          feature_id: ent.feature_id,
          included_volume: ent.included_volume,
          string_value: ent.string_value
        }));
        const { error: entError } = await supabaseAdmin
          .from('tier_entitlements')
          .insert(toInsert);
        if (entError) throw entError;
      }

      return NextResponse.json({ success: true, tierId: newTierId });
    }

    if (action === 'UPDATE_ENTITLEMENTS') {
      // Direct update to an existing tier (affects all users immediately)
      const { tierId, entitlements } = payload;
      
      // Delete old
      await supabaseAdmin.from('tier_entitlements').delete().eq('tier_id', tierId);
      
      // Insert new
      if (entitlements && entitlements.length > 0) {
        const toInsert = entitlements.map((ent: any) => ({
          tier_id: tierId,
          feature_id: ent.feature_id,
          included_volume: ent.included_volume,
          string_value: ent.string_value
        }));
        const { error: entError } = await supabaseAdmin
          .from('tier_entitlements')
          .insert(toInsert);
        if (entError) throw entError;
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    console.error('Error modifying pricing matrix:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
