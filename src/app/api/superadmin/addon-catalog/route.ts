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
    const { type, id, updates } = body;

    if (!type || !id || !updates) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Try to get auth user
    const authHeader = req.headers.get('Authorization');
    let performedBy = 'system';
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) performedBy = user.id;
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
    const summaryText = `Updated ${type} (${id})`;
    const { error: auditError } = await supabase.from('addon_audit_log').insert({
      item_type: type,
      item_id: id,
      old_values: oldValues,
      new_values: updates,
      summary: summaryText,
      performed_by: performedBy
    });

    if (auditError) {
      console.error('Failed to write audit log:', auditError);
      // We don't fail the request if just the audit log fails, but we log it
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating catalog:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
