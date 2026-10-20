import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withSuperAdmin } from '@/lib/auth/require-superadmin';
import { validateAddonText } from '@/lib/addon-text';

export const dynamic = 'force-dynamic';

const ALLOWED_ADDON_FIELDS = new Set([
  'name',
  'description',
  'monthly_price_pence',
  'max_price_pence',
  'price_step_pence',
  'is_sliding',
  'included_voice_minutes',
  'max_voice_minutes',
  'included_sms',
  'max_sms',
  'included_data_chunks',
  'display_order',
]);

const ALLOWED_BASE_TIER_FIELDS = new Set([
  'name',
  'description',
  'monthly_price_pence',
  'price_pence_annual',
  'is_active',
]);

export const GET = withSuperAdmin(async () => {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const [baseTierResponse, addonsResponse, auditLogResponse] = await Promise.all([
      supabase.from('subscription_tiers').select('*').eq('id', 'base_tier').single(),
      supabase.from('addon_catalog').select('*').order('display_order', { ascending: true }),
      supabase.from('addon_audit_log').select('*').order('created_at', { ascending: false }).limit(50)
    ]);

    if (baseTierResponse.error && baseTierResponse.error.code !== 'PGRST116') {
      throw baseTierResponse.error;
    }

    if (addonsResponse.error) throw addonsResponse.error;
    if (auditLogResponse.error) throw auditLogResponse.error;

    return NextResponse.json({
      baseTier: baseTierResponse.data || null,
      addons: addonsResponse.data || [],
      auditLog: auditLogResponse.data || []
    });
  } catch (error: any) {
    console.error('Error fetching addon catalog:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const PATCH = withSuperAdmin(async (req: NextRequest, _ctx: any, admin: { user: any; userId: string }) => {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const type = body.type || 'addon';
    const id = body.id;
    const updates = body.updates || { ...body };
    delete updates.id;
    delete updates.type;
    delete updates.summary;

    if (!id || Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Missing required fields (id, updates)' }, { status: 400 });
    }

    if (type === 'addon') {
      for (const key of Object.keys(updates)) {
        if (!ALLOWED_ADDON_FIELDS.has(key)) {
          return NextResponse.json({ error: `Disallowed field in updates: ${key}` }, { status: 400 });
        }
      }

      if (updates.name !== undefined || updates.description !== undefined) {
        const textVal = validateAddonText({
          name: updates.name,
          description: updates.description,
        });
        if (!textVal.valid) {
          return NextResponse.json({ error: textVal.error }, { status: 400 });
        }
        if (updates.name) updates.name = updates.name.trim();
        if (updates.description !== undefined && updates.description !== null) {
          updates.description = updates.description.trim();
        }
      }
    } else if (type === 'base_tier') {
      for (const key of Object.keys(updates)) {
        if (!ALLOWED_BASE_TIER_FIELDS.has(key)) {
          return NextResponse.json({ error: `Disallowed field in updates: ${key}` }, { status: 400 });
        }
      }
    }

    const performedBy = admin.userId;

    let oldValues = null;
    let tableName = '';

    if (type === 'base_tier') {
      tableName = 'subscription_tiers';
      const { data } = await supabase.from(tableName).select('*').eq('id', 'base_tier').single();
      oldValues = data;
    } else if (type === 'addon') {
      tableName = 'addon_catalog';
      const { data } = await supabase.from(tableName).select('*').eq('id', id).single();
      oldValues = data;
    } else {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    // Update the record
    const { error: updateError } = await supabase
      .from(tableName)
      .update(updates)
      .eq('id', id);

    if (updateError) throw updateError;

    // Write audit log with authenticated superadmin userId
    const summaryText = body.summary || `Updated ${type} (${id}): ${Object.keys(updates).join(', ')}`;
    const auditInsert: Record<string, any> = {
      addon_catalog_id: id,
      action: type === 'base_tier' ? 'base_tier_updated' : 'addon_updated',
      old_value: oldValues,
      new_value: updates,
      summary: summaryText,
      performed_by: performedBy,
    };

    const { error: auditError } = await supabase.from('addon_audit_log').insert(auditInsert);
    if (auditError) {
      console.error('Failed to write audit log:', auditError);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating catalog:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
