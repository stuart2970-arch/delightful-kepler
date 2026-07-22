import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase admin credentials");
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const { id, name, category_id, is_metered } = await req.json();

    if (!id || !name || !category_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Get max display_order
    const { data: maxOrderData } = await supabase
      .from('features')
      .select('display_order')
      .order('display_order', { ascending: false })
      .limit(1)
      .single();
    
    const nextOrder = (maxOrderData?.display_order ?? 0) + 1;

    // 2. Insert into features table
    const { data: newFeature, error: featureError } = await supabase
      .from('features')
      .insert({
        id,
        name,
        category_id,
        is_metered: is_metered || false,
        display_order: nextOrder
      })
      .select()
      .single();

    if (featureError) throw featureError;

    // 3. Seed tier_entitlements for all active tiers
    const { data: tiers } = await supabase.from('subscription_tiers').select('id').eq('is_active', true);
    
    if (tiers && tiers.length > 0) {
      const entitlementsToInsert = tiers.map((t: any) => ({
        tier_id: t.id,
        feature_id: id,
        limit_value: 0
      }));

      const { error: entError } = await supabase.from('tier_entitlements').insert(entitlementsToInsert);
      if (entError) console.error("Failed to seed entitlements:", entError);
    }

    return NextResponse.json({ success: true, feature: newFeature });
  } catch (err: any) {
    console.error('[Create Feature]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
