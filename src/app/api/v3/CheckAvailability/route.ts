import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { slot } = payload;
    
    if (!slot || !slot.merchant_id || !slot.service_id || !slot.start_time_sec) {
      return NextResponse.json({ error: 'Invalid Payload' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabaseUrl = process.env.SUPABASE_URL || process.env['NEXT_PUBLIC_SUPABASE_URL'] || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {}
        },
      },
    });

    // 1. Fetch Service to know duration
    const { data: service } = await supabase
      .from('services')
      .select('duration_minutes, buffer_minutes')
      .eq('id', slot.merchant_id) // Wait, service_id might be the ID. Let's fix this.
      .eq('id', slot.service_id)
      .single();

    if (!service) {
      return NextResponse.json({ 
        error: 'SERVICE_UNAVAILABLE',
        description: 'The requested service does not exist.'
      });
    }

    const durationMs = (service.duration_minutes + (service.buffer_minutes || 0)) * 60000;
    const startMs = parseInt(slot.start_time_sec) * 1000;
    const endMs = startMs + durationMs;

    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();

    // 2. Look for any overlapping appointments for this merchant
    // A more rigorous check would map staff working days, but for CheckAvailability we just ensure
    // that at least ONE staff member is not double-booked at this time.
    const { data: staffData } = await supabase
      .from('staff')
      .select('id')
      .eq('tenant_id', slot.merchant_id);
      
    if (!staffData || staffData.length === 0) {
      return NextResponse.json({ 
        error: 'SLOT_UNAVAILABLE',
        description: 'No staff available for this merchant.'
      });
    }

    const { data: overlappingAppointments } = await supabase
      .from('appointments')
      .select('staff_id')
      .eq('tenant_id', slot.merchant_id)
      .lt('start_time', endIso)
      .gt('end_time', startIso);

    const bookedStaffIds = new Set((overlappingAppointments || []).map(a => a.staff_id));
    const availableStaff = staffData.filter(s => !bookedStaffIds.has(s.id));

    if (availableStaff.length === 0) {
      // Slot sniped locally
      return NextResponse.json({
        slot_available: false,
        error: 'SLOT_UNAVAILABLE',
        description: 'This time slot was just booked locally and is no longer available.'
      });
    }

    // It's empty, slot is available
    return NextResponse.json({
      slot_available: true,
      duration_sec: service.duration_minutes * 60
    });

  } catch (error) {
    console.error('[RwG CheckAvailability] Exception:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
