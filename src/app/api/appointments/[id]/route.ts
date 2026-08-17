import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateICSContent } from '@/lib/ical';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await params;
    const appointmentId = resolvedParams.id;

    if (!appointmentId) {
      return NextResponse.json({ error: 'Appointment ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const {
      start_time,
      end_time,
      staff_id,
      service_name,
      staff_name,
      notes,
      customer_name,
      customer_email,
      customer_phone,
      tenantId
    } = body;

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const updates: Record<string, any> = {};
    if (start_time) updates.start_time = start_time;
    if (end_time) updates.end_time = end_time;
    if (staff_id !== undefined) updates.staff_id = staff_id;
    if (notes !== undefined) updates.notes = notes;
    if (customer_name !== undefined) updates.customer_name = customer_name;
    if (customer_email !== undefined) updates.customer_email = customer_email;
    if (customer_phone !== undefined) updates.customer_phone = customer_phone;

    const { data: updatedAppt, error: updateError } = await supabaseAdmin
      .from('appointments')
      .update(updates)
      .eq('id', appointmentId)
      .select()
      .single();

    if (updateError) {
      console.error('[Appointment PATCH] Error updating appointment:', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Generate iCal attachment content for email notification
    const icsContent = generateICSContent({
      uid: appointmentId,
      summary: `${service_name || 'Service Appointment'} with ${staff_name || 'Specialist'}`,
      description: notes ? `Notes: ${notes}` : 'Amended appointment booking',
      start: start_time || updatedAppt.start_time,
      end: end_time || updatedAppt.end_time,
      customerName: customer_name || updatedAppt.customer_name,
      customerPhone: customer_phone || updatedAppt.customer_phone
    });

    console.log(`[Appointment PATCH] Successfully amended appointment ${appointmentId}. Generated iCal ICS attachment.`);

    return NextResponse.json({
      success: true,
      appointment: updatedAppt,
      icsContent,
      message: 'Appointment amended successfully and confirmation email prepared.'
    });

  } catch (err: any) {
    console.error('[Appointment PATCH] Unhandled error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
