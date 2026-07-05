import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { user_information, slot } = payload;
    
    if (!slot || !slot.merchant_id || !slot.service_id || !slot.start_time_sec || !user_information) {
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

    const staffId = slot.resources?.staff_id;
    if (!staffId) {
      return NextResponse.json({ error: 'Missing resources.staff_id in payload' }, { status: 400 });
    }

    const startMs = parseInt(slot.start_time_sec) * 1000;
    const durationMs = parseInt(slot.duration_sec || '3600') * 1000;
    const endMs = startMs + durationMs;

    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();

    // Verify it's not double-booked locally before committing
    const { data: overlappingAppointments } = await supabase
      .from('appointments')
      .select('id')
      .eq('staff_id', staffId)
      .lt('start_time', endIso)
      .gt('end_time', startIso);

    if (overlappingAppointments && overlappingAppointments.length > 0) {
      return NextResponse.json({
        booking_failure: {
          reason: 'SLOT_UNAVAILABLE',
          description: 'The requested slot was recently booked and is no longer available.'
        }
      });
    }

    // Insert the booking
    const { data: appointment, error: insertError } = await supabase
      .from('appointments')
      .insert({
        tenant_id: slot.merchant_id,
        staff_id: staffId,
        service_id: slot.service_id,
        customer_name: `${user_information.given_name || ''} ${user_information.family_name || ''}`.trim(),
        customer_email: user_information.email || '',
        customer_phone: user_information.telephone || '',
        start_time: startIso,
        end_time: endIso,
        google_event_id: `rwg-${Date.now()}` // Placeholder if not syncing to Google Cal immediately, or we could trigger a Google Cal insert via a background job
      })
      .select()
      .single();

    if (insertError) {
      console.error('[RwG CreateBooking] Insert Error:', insertError);
      return NextResponse.json({ 
        booking_failure: {
          reason: 'INTERNAL_ERROR',
          description: 'Failed to commit booking to database.'
        }
      });
    }

    // Success response
    return NextResponse.json({
      booking: {
        booking_id: appointment.id,
        slot: slot,
        user_information: user_information,
        status: 'CONFIRMED'
      }
    });

  } catch (error) {
    console.error('[RwG CreateBooking] Exception:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
