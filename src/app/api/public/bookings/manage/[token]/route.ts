import { NextResponse } from 'next/server';
import { clientIp, consumeAuthRateLimit } from '@/lib/security/auth-rate-limit';
import { resolveManageToken } from '@/lib/booking/manage-token';
import {
  INVALID_MANAGE_TOKEN_MESSAGE,
  cancelBookingViaManage,
  loadManageBooking,
  rescheduleBookingViaManage,
} from '@/lib/booking/public-manage';
import { getAvailabilityData } from '@/app/api/chat/stream/calendar';
import { APPOINTMENT_STATUS_BOOKED } from '@/lib/booking/appointment-status';

const MANAGE_RATE_LIMIT = 60;
const MANAGE_WINDOW_SECONDS = 15 * 60;

function genericError(status = 404): NextResponse {
  return NextResponse.json({ error: INVALID_MANAGE_TOKEN_MESSAGE }, { status });
}

async function rateLimitOk(request: Request, suffix: string): Promise<boolean> {
  const ip = clientIp(request);
  const allowed = await consumeAuthRateLimit(
    `booking-manage:${suffix}:${ip}`,
    MANAGE_RATE_LIMIT,
    MANAGE_WINDOW_SECONDS,
  );
  return allowed;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> | { token: string } },
) {
  if (!(await rateLimitOk(request, 'get'))) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 });
  }

  const { token } = await context.params;
  const resolved = await resolveManageToken(token);
  if (!resolved) return genericError();

  const appt = await loadManageBooking(resolved.appointmentId);
  if (!appt) return genericError();

  const staffRow = Array.isArray(appt.staff) ? appt.staff[0] : appt.staff;
  const serviceRow = Array.isArray(appt.services) ? appt.services[0] : appt.services;
  const tenantRow = Array.isArray(appt.tenants) ? appt.tenants[0] : appt.tenants;
  const timezone = (tenantRow as { timezone?: string } | null)?.timezone || 'Europe/London';
  const businessName = (tenantRow as { name?: string } | null)?.name || 'Small business';

  let availability: { quickDaysTag?: string; quickTimesTag?: string; text?: string } | null = null;
  if (appt.status === APPOINTMENT_STATUS_BOOKED && appt.staff_id && appt.service_id) {
    const start = new Date();
    const end = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const avail = await getAvailabilityData(
      appt.tenant_id as string,
      appt.staff_id as string,
      appt.service_id as string,
      start.toISOString(),
      end.toISOString(),
      timezone,
    );
    if (avail.outcome === 'ok') {
      availability = {
        quickDaysTag: avail.quickDaysTag,
        quickTimesTag: avail.quickTimesTag,
        text: avail.text,
      };
    }
  }

  return NextResponse.json({
    businessName,
    timezone,
    appointment: {
      id: appt.id,
      status: appt.status,
      customerName: appt.customer_name,
      serviceName: serviceRow?.name || 'Appointment',
      staffName: staffRow?.name || 'Colleague',
      startTime: appt.start_time,
      endTime: appt.end_time,
    },
    availability,
    expiresAt: resolved.expiresAt,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> | { token: string } },
) {
  if (!(await rateLimitOk(request, 'post'))) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 });
  }

  const { token } = await context.params;
  const resolved = await resolveManageToken(token);
  if (!resolved) return genericError(400);

  let body: { action?: string; startTime?: string; endTime?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const action = (body.action || '').trim().toLowerCase();
  if (action === 'cancel') {
    const result = await cancelBookingViaManage(resolved.appointmentId);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }
    return NextResponse.json({ success: true, status: 'cancelled' });
  }

  if (action === 'reschedule') {
    if (!body.startTime || !body.endTime) {
      return NextResponse.json({ error: 'startTime and endTime are required.' }, { status: 400 });
    }
    const result = await rescheduleBookingViaManage(
      resolved.appointmentId,
      body.startTime,
      body.endTime,
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 409 });
    }
    return NextResponse.json({ success: true, status: 'rescheduled' });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}