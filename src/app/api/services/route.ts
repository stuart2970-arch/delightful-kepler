import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  return createClient(
    process.env['NEXT_PUBLIC_' + 'SUPABASE_URL']!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('services')
      .select('*, staff_services(*)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ services: data || [] });
  } catch (err: any) {
    console.error('Error fetching services:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { tenant_id, chatbot_id, name, duration_minutes, buffer_minutes, price, assigned_staff } = body;

    if (!tenant_id || !name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    
    // 1. Insert Service
    const { data, error } = await supabaseAdmin
      .from('services')
      .insert({
        tenant_id,
        chatbot_id,
        name,
        duration_minutes: duration_minutes || 60,
        buffer_minutes: buffer_minutes || 0,
        price: price || 0,
      })
      .select()
      .single();

    if (error) throw error;
    
    // 2. Insert Staff Mappings if any
    if (assigned_staff && Array.isArray(assigned_staff) && assigned_staff.length > 0) {
      const mappings = assigned_staff.map((staff) => ({
        tenant_id,
        service_id: data.id,
        staff_id: staff.staff_id,
        custom_price: staff.custom_price || null,
        custom_duration: staff.custom_duration || null
      }));
      const { error: mappingError } = await supabaseAdmin.from('staff_services').insert(mappings);
      if (mappingError) console.error('Failed to insert staff mappings:', mappingError);
    }
    
    // 3. Return full object with mappings array
    const { data: fullData } = await supabaseAdmin
      .from('services')
      .select('*, staff_services(*)')
      .eq('id', data.id)
      .single();

    return NextResponse.json({ service: fullData || data });
  } catch (err: any) {
    console.error('Error creating service:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, tenant_id, chatbot_id, name, duration_minutes, buffer_minutes, price, assigned_staff } = body;

    if (!id || !tenant_id || !name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    
    // 1. Update Service
    const { error } = await supabaseAdmin
      .from('services')
      .update({
        chatbot_id,
        name,
        duration_minutes: duration_minutes || 60,
        buffer_minutes: buffer_minutes || 0,
        price: price || 0,
      })
      .eq('id', id)
      .eq('tenant_id', tenant_id);

    if (error) throw error;
    
    // 2. Delete existing staff mappings
    await supabaseAdmin
      .from('staff_services')
      .delete()
      .eq('service_id', id)
      .eq('tenant_id', tenant_id);
      
    // 3. Insert New Mappings
    if (assigned_staff && Array.isArray(assigned_staff) && assigned_staff.length > 0) {
      const mappings = assigned_staff.map((staff) => ({
        tenant_id,
        service_id: id,
        staff_id: staff.staff_id,
        custom_price: staff.custom_price || null,
        custom_duration: staff.custom_duration || null
      }));
      const { error: mappingError } = await supabaseAdmin.from('staff_services').insert(mappings);
      if (mappingError) console.error('Failed to update staff mappings:', mappingError);
    }
    
    // 4. Return full object with mappings array
    const { data: fullData } = await supabaseAdmin
      .from('services')
      .select('*, staff_services(*)')
      .eq('id', id)
      .single();

    return NextResponse.json({ service: fullData });
  } catch (err: any) {
    console.error('Error updating service:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const tenantId = searchParams.get('tenantId');

    if (!id || !tenantId) {
      return NextResponse.json({ error: 'Missing id or tenantId' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from('services')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting service:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
