import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
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
}

export async function PATCH(req: Request) {
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

    // Try to get auth user
    const authHeader = req.headers.get('Authorization');
    let performedBy = 'system';
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) performedBy = user.email || user.id;
    }

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

    // Write audit log
    const summaryText = body.summary || `Updated ${type} (${id}): ${Object.keys(updates).join(', ')}`;
    const auditInsert: Record<string, any> = {
      addon_catalog_id: id,
      action: type === 'base_tier' ? 'base_tier_updated' : 'addon_updated',
      old_value: oldValues,
      new_value: updates,
      summary: summaryText,
    };
    // performed_by expects uuid if set
    if (performedBy && performedBy !== 'system' && performedBy.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      auditInsert.performed_by = performedBy;
    }
    const { error: auditError } = await supabase.from('addon_audit_log').insert(auditInsert);

    if (auditError) {
      console.error('Failed to write audit log:', auditError);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating catalog:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
