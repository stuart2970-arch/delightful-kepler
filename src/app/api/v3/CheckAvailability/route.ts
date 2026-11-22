import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { staffIdsBlockingSlot } from '@/lib/booking/rwg-slot-busy';
import { verifyRwgBookingServerAuth } from '@/lib/booking/rwg-booking-auth';
import type { StaffCalendarTarget } from '@/lib/calendar/provider';

export const dynamic = 'force-dynamic';

function serviceRoleClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function startSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * POST /api/v3/CheckAvailability
 * Reserve with Google Booking Server. Google authenticates with HTTP Basic
 * (Actions Center username and password). The service row is the service id
 * scoped to the merchant, not both filters on id.
 */
export async function POST(request: Request) {
  const auth = verifyRwgBookingServerAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = asRecord(await request.json());
    const slot = asRecord(payload?.slot);
    const merchantId = text(slot?.merchant_id);
    const serviceId = text(slot?.service_id);
    const startSec = startSeconds(slot?.start_time_sec);

    if (!merchantId || !serviceId || startSec == null || startSec <= 0) {
      return NextResponse.json({ error: 'Invalid Payload' }, { status: 400 });
    }

    const supabase = serviceRoleClient();

    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('duration_minutes, buffer_minutes')
      .eq('id', serviceId)
      .eq('tenant_id', merchantId)
      .maybeSingle();

    if (serviceError) {
      console.error('[RwG CheckAvailability] Service lookup failed:', serviceError.message);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

    if (!service) {
      return NextResponse.json({
        error: 'SERVICE_UNAVAILABLE',
        description: 'The requested service does not exist.',
      });
    }

    const durationMs = (service.duration_minutes + (service.buffer_minutes || 0)) * 60000;
    const startMs = startSec * 1000;
    const endMs = startMs + durationMs;
    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();

    const { data: staffData, error: staffError } = await supabase
      .from('staff')
      .select('id, name, email, calendar_provider, google_calendar_id, microsoft_calendar_id')
      .eq('tenant_id', merchantId);

    if (staffError) {
      console.error('[RwG CheckAvailability] Staff lookup failed:', staffError.message);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

    if (!staffData || staffData.length === 0) {
      return NextResponse.json({
        error: 'SLOT_UNAVAILABLE',
        description: 'No staff available for this merchant.',
      });
    }

    const staffById = new Map<string, StaffCalendarTarget>();
    for (const member of staffData) {
      staffById.set(member.id, {
        id: member.id,
        name: member.name,
        email: member.email ?? undefined,
        calendar_provider: member.calendar_provider ?? undefined,
        google_calendar_id: member.google_calendar_id ?? undefined,
        microsoft_calendar_id: member.microsoft_calendar_id ?? undefined,
      });
    }

    const bookedStaffIds = await staffIdsBlockingSlot({
      admin: supabase,
      tenantId: merchantId,
      slotStart: new Date(startIso),
      slotEnd: new Date(endIso),
      staffById,
    });
    const availableStaff = staffData.filter((member) => !bookedStaffIds.has(member.id));

    if (availableStaff.length === 0) {
      return NextResponse.json({
        slot_available: false,
        error: 'SLOT_UNAVAILABLE',
        description: 'This time slot was just booked locally and is no longer available.',
      });
    }

    return NextResponse.json({
      slot_available: true,
      duration_sec: service.duration_minutes * 60,
    });
  } catch (error) {
    console.error('[RwG CheckAvailability] Exception:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
