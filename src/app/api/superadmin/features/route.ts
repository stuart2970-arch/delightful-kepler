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
    const { id, name, category_id, is_metered, value_type } = await req.json();

    if (!id || !name) {
      return NextResponse.json({ error: 'Missing required fields (id, name)' }, { status: 400 });
    }

    const catId = category_id || 'core_ai';
    const valType = value_type === 'boolean' ? 'boolean' : 'numeric';

    // 1. Get max display_order
    const { data: maxOrderData } = await supabase
      .from('features')
      .select('display_order')
      .order('display_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    const nextOrder = (maxOrderData?.display_order ?? 0) + 1;

    // 2. Insert into features table
    const { data: newFeature, error: featureError } = await supabase
      .from('features')
      .insert({
        id,
        name,
        category_id: catId,
        is_metered: is_metered || false,
        value_type: valType,
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
        limit_value: valType === 'boolean' ? 1 : 0
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

export async function PATCH(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const { id, name, value_type, is_metered, display_order } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'Missing feature id' }, { status: 400 });
    }

    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (value_type !== undefined) updates.value_type = value_type === 'boolean' ? 'boolean' : 'numeric';
    if (is_metered !== undefined) updates.is_metered = Boolean(is_metered);
    if (display_order !== undefined) updates.display_order = Number(display_order);

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data: updatedFeature, error } = await supabase
      .from('features')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, feature: updatedFeature });
  } catch (err: any) {
    console.error('[Update Feature]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const url = new URL(req.url);
    let id = url.searchParams.get('id');

    if (!id) {
      const body = await req.json().catch(() => ({}));
      id = body.id;
    }

    if (!id) {
      return NextResponse.json({ error: 'Missing feature id' }, { status: 400 });
    }

    // 1. Delete associated tier_entitlements
    await supabase.from('tier_entitlements').delete().eq('feature_id', id);

    // 2. Delete tenant_feature_overrides if table exists
    await supabase.from('tenant_feature_overrides').delete().eq('feature_id', id);

    // 3. Delete from features table
    const { error } = await supabase.from('features').delete().eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: `Feature ${id} deleted successfully` });
  } catch (err: any) {
    console.error('[Delete Feature]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
