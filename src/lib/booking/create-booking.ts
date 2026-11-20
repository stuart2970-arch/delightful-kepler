import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifyChatSessionToken } from '@/lib/chat-session';
import { clientIp, consumeAuthRateLimit } from '@/lib/security/auth-rate-limit';
import { verifyVapiWebhookSecret } from '@/lib/env/vapi-webhook-auth';
import { getBusy, resolveCalendarProvider, type StaffCalendarTarget } from '@/lib/calendar/provider';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-session-token',
};

const DEFAULT_IP_LIMIT = 20;
const DEFAULT_TENANT_LIMIT = 60;
const DEFAULT_WINDOW_SECONDS = 15 * 60;

type BookingSource = 'vapi' | 'widget' | 'anonymous';

type StaffRow = StaffCalendarTarget & { tenant_id: string };

type AuditInput = {
  tenantId: string | null;
  chatbotId: string | null;
  source: BookingSource;
  outcome: 'accepted' | 'rejected';
  reason: string;
  httpStatus: number;
  ip: string;
  staffId: string | null;
  serviceId: string | null;
  slotStart: string | null;
  slotEnd: string | null;
  customerEmail: string | null;
  ignoredBodyTenant: boolean;
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

function limitFrom(raw: string | null | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function rateLimits(request: Request): { ip: number; tenant: number; windowSeconds: number } {
  const playwright = process.env.PLAYWRIGHT_TEST === 'true';
  let ip = limitFrom(
    process.env.CREATE_BOOKING_RATE_LIMIT_PER_IP,
    playwright ? 10_000 : DEFAULT_IP_LIMIT,
  );
  let tenant = limitFrom(
    process.env.CREATE_BOOKING_RATE_LIMIT_PER_TENANT,
    playwright ? 10_000 : DEFAULT_TENANT_LIMIT,
  );
  if (playwright) {
    const ipHeader = request.headers.get('x-test-booking-rate-limit');
    const tenantHeader = request.headers.get('x-test-booking-tenant-rate-limit');
    if (ipHeader != null && ipHeader.trim() !== '') ip = limitFrom(ipHeader, ip);
    if (tenantHeader != null && tenantHeader.trim() !== '') tenant = limitFrom(tenantHeader, tenant);
  }
  return {
    ip,
    tenant,
    windowSeconds: limitFrom(process.env.CREATE_BOOKING_RATE_LIMIT_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS),
  };
}

function serviceRoleClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function writeAudit(admin: SupabaseClient, entry: AuditInput): Promise<void> {
  const { error } = await admin.from('booking_audit_log').insert({
    tenant_id: entry.tenantId,
    chatbot_id: entry.chatbotId,
    source: entry.source,
    outcome: entry.outcome,
    reason: entry.reason,
    http_status: entry.httpStatus,
    ip_address: entry.ip,
    staff_id: uuidOrNull(entry.staffId),
    service_id: uuidOrNull(entry.serviceId),
    slot_start: entry.slotStart,
    slot_end: entry.slotEnd,
    customer_email: entry.customerEmail,
    ignored_body_tenant: entry.ignoredBodyTenant,
  });
  if (error) {
    console.error('[CreateBooking] Audit insert failed:', error.message);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function uuidOrNull(value: string | null): string | null {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function assistantIdFrom(request: Request, body: Record<string, unknown>): string {
  const header = text(request.headers.get('x-vapi-assistant-id'));
  if (header) return header;
  const direct = text(body.assistantId);
  if (direct) return direct;
  const call = asRecord(body.call);
  const callId = text(call?.assistantId);
  if (callId) return callId;
  const message = asRecord(body.message);
  const messageCall = text(asRecord(message?.call)?.assistantId);
  if (messageCall) return messageCall;
  return text(asRecord(message?.assistant)?.id);
}

function slotFields(body: Record<string, unknown>): {
  merchantId: string;
  serviceId: string;
  staffId: string;
  startSec: number;
  durationSec: number;
  email: string;
  givenName: string;
  familyName: string;
  telephone: string;
} | null {
  const slot = asRecord(body.slot);
  const user = asRecord(body.user_information);
  if (!slot || !user) return null;
  const resources = asRecord(slot.resources);
  const startSec = finiteNumber(slot.start_time_sec);
  const durationParsed = finiteNumber(slot.duration_sec);
  const durationSec = durationParsed ?? 3600;
  const serviceId = text(slot.service_id);
  const staffId = text(resources?.staff_id);
  if (!serviceId || !staffId || startSec == null || startSec <= 0) return null;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
  return {
    merchantId: text(slot.merchant_id),
    serviceId,
    staffId,
    startSec,
    durationSec,
    email: text(user.email),
    givenName: text(user.given_name),
    familyName: text(user.family_name),
    telephone: text(user.telephone),
  };
}

function customerEmailFrom(body: Record<string, unknown> | null): string | null {
  const user = asRecord(body?.user_information);
  const email = text(user?.email);
  return email || null;
}

/**
 * Authenticate a CreateBooking request.
 * Vapi: X-Vapi-Secret via verifyVapiWebhookSecret (constant-time compare of VAPI_WEBHOOK_SECRET).
 * Widget: existing signed chat session. The chatbot id inside the token is the widget key.
 * Tenant is never taken from the body.
 */
async function authenticate(
  request: Request,
  body: Record<string, unknown> | null,
  admin: SupabaseClient,
): Promise<
  | { ok: true; source: 'vapi' | 'widget'; tenantId: string; chatbotId: string }
  | { ok: false; source: BookingSource; status: number; reason: string }
> {
  const vapiHeader = request.headers.get('x-vapi-secret');
  if (vapiHeader !== null) {
    const secretCheck = verifyVapiWebhookSecret(request);
    if (!secretCheck.ok) {
      return { ok: false, source: 'vapi', status: secretCheck.response.status, reason: 'unauthorized' };
    }
    const assistantId = body ? assistantIdFrom(request, body) : '';
    if (!assistantId) {
      return { ok: false, source: 'vapi', status: 401, reason: 'assistant_unknown' };
    }
    const { data, error } = await admin
      .from('chatbots')
      .select('id, tenant_id')
      .eq('configuration_json->>vapi_assistant_id', assistantId)
      .limit(2);
    if (error || !data || data.length !== 1 || !data[0]?.tenant_id) {
      return { ok: false, source: 'vapi', status: 401, reason: 'assistant_unknown' };
    }
    return { ok: true, source: 'vapi', tenantId: data[0].tenant_id, chatbotId: data[0].id };
  }

  const sessionToken = request.headers.get('x-session-token');
  if (sessionToken) {
    const verification = verifyChatSessionToken(sessionToken);
    if (!verification.valid || !verification.payload?.chatbotId) {
      return { ok: false, source: 'widget', status: 401, reason: 'unauthorized' };
    }
    const { data, error } = await admin
      .from('chatbots')
      .select('id, tenant_id')
      .eq('id', verification.payload.chatbotId)
      .maybeSingle();
    if (error || !data?.tenant_id) {
      return { ok: false, source: 'widget', status: 401, reason: 'widget_unknown' };
    }
    return { ok: true, source: 'widget', tenantId: data.tenant_id, chatbotId: data.id };
  }

  return { ok: false, source: 'anonymous', status: 401, reason: 'unauthorized' };
}

async function slotIsBusy(
  admin: SupabaseClient,
  tenantId: string,
  staff: StaffRow,
  start: Date,
  end: Date,
): Promise<'free' | 'busy' | 'unknown'> {
  const { data: overlapping, error } = await admin
    .from('appointments')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('staff_id', staff.id)
    .lt('start_time', end.toISOString())
    .gt('end_time', start.toISOString())
    .limit(1);

  if (error) {
    console.error('[CreateBooking] Local busy check failed:', error.message);
    return 'unknown';
  }
  if (overlapping && overlapping.length > 0) return 'busy';

  const { data: integrations, error: integrationError } = await admin
    .from('tenant_integrations')
    .select('provider, refresh_token')
    .eq('tenant_id', tenantId);
  if (integrationError) {
    console.error('[CreateBooking] Calendar integration lookup failed:', integrationError.message);
    return 'unknown';
  }
  const connected = (integrations || []).some((row) => {
    const provider = row.provider;
    return (provider === 'google_calendar' || provider === 'microsoft_calendar') && Boolean(row.refresh_token);
  });
  if (!connected) return 'free';

  try {
    const provider = await resolveCalendarProvider(tenantId, staff);
    if (!provider) return 'free';
    const busy = await getBusy(tenantId, staff, start, end);
    const taken = busy.some((interval) => start < interval.end && end > interval.start);
    return taken ? 'busy' : 'free';
  } catch (err) {
    const message = err instanceof Error ? err.message : 'calendar check failed';
    console.error('[CreateBooking] Calendar busy check failed:', message);
    return 'unknown';
  }
}

export async function handleCreateBooking(request: Request): Promise<NextResponse> {
  const ip = clientIp(request);
  let admin: SupabaseClient;
  try {
    admin = serviceRoleClient();
  } catch (err) {
    console.error('[CreateBooking] Service role client unavailable:', err instanceof Error ? err.message : err);
    return json({ error: 'Internal Server Error' }, 500);
  }

  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await request.json();
    body = asRecord(parsed);
  } catch {
    body = null;
  }

  const limits = rateLimits(request);
  const ipAllowed = await consumeAuthRateLimit(`create-booking:ip:${ip}`, limits.ip, limits.windowSeconds);
  if (!ipAllowed) {
    await writeAudit(admin, {
      tenantId: null,
      chatbotId: null,
      source: 'anonymous',
      outcome: 'rejected',
      reason: 'rate_limited',
      httpStatus: 429,
      ip,
      staffId: null,
      serviceId: null,
      slotStart: null,
      slotEnd: null,
      customerEmail: customerEmailFrom(body),
      ignoredBodyTenant: false,
    });
    return json({ error: 'Too many booking attempts. Please try again later.' }, 429);
  }

  const auth = await authenticate(request, body, admin);
  const email = customerEmailFrom(body);
  if (!auth.ok) {
    await writeAudit(admin, {
      tenantId: null,
      chatbotId: null,
      source: auth.source,
      outcome: 'rejected',
      reason: auth.reason,
      httpStatus: auth.status,
      ip,
      staffId: null,
      serviceId: null,
      slotStart: null,
      slotEnd: null,
      customerEmail: email,
      ignoredBodyTenant: false,
    });
    const message = auth.status === 503 ? 'VAPI_WEBHOOK_SECRET is not configured.' : 'Unauthorized';
    return json({ error: message }, auth.status);
  }

  const tenantAllowed = await consumeAuthRateLimit(
    `create-booking:tenant:${auth.tenantId}`,
    limits.tenant,
    limits.windowSeconds,
  );
  if (!tenantAllowed) {
    await writeAudit(admin, {
      tenantId: auth.tenantId,
      chatbotId: auth.chatbotId,
      source: auth.source,
      outcome: 'rejected',
      reason: 'rate_limited',
      httpStatus: 429,
      ip,
      staffId: null,
      serviceId: null,
      slotStart: null,
      slotEnd: null,
      customerEmail: email,
      ignoredBodyTenant: false,
    });
    return json({ error: 'Too many booking attempts. Please try again later.' }, 429);
  }

  const fields = body ? slotFields(body) : null;
  if (!fields || !fields.email) {
    await writeAudit(admin, {
      tenantId: auth.tenantId,
      chatbotId: auth.chatbotId,
      source: auth.source,
      outcome: 'rejected',
      reason: 'invalid_payload',
      httpStatus: 400,
      ip,
      staffId: fields?.staffId ?? null,
      serviceId: fields?.serviceId ?? null,
      slotStart: null,
      slotEnd: null,
      customerEmail: email,
      ignoredBodyTenant: false,
    });
    return json({ error: 'Invalid Payload' }, 400);
  }

  const ignoredBodyTenant = fields.merchantId !== '' && fields.merchantId !== auth.tenantId;
  const start = new Date(fields.startSec * 1000);
  const end = new Date(start.getTime() + fields.durationSec * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    await writeAudit(admin, {
      tenantId: auth.tenantId,
      chatbotId: auth.chatbotId,
      source: auth.source,
      outcome: 'rejected',
      reason: 'invalid_payload',
      httpStatus: 400,
      ip,
      staffId: fields.staffId,
      serviceId: fields.serviceId,
      slotStart: null,
      slotEnd: null,
      customerEmail: fields.email,
      ignoredBodyTenant,
    });
    return json({ error: 'Invalid Payload' }, 400);
  }

  const { data: staff, error: staffError } = await admin
    .from('staff')
    .select('id, name, email, tenant_id, calendar_provider, google_calendar_id, microsoft_calendar_id')
    .eq('id', fields.staffId)
    .eq('tenant_id', auth.tenantId)
    .maybeSingle();

  const { data: service, error: serviceError } = await admin
    .from('services')
    .select('id')
    .eq('id', fields.serviceId)
    .eq('tenant_id', auth.tenantId)
    .maybeSingle();

  if (staffError || serviceError || !staff || !service) {
    await writeAudit(admin, {
      tenantId: auth.tenantId,
      chatbotId: auth.chatbotId,
      source: auth.source,
      outcome: 'rejected',
      reason: 'invalid_payload',
      httpStatus: 400,
      ip,
      staffId: fields.staffId,
      serviceId: fields.serviceId,
      slotStart: start.toISOString(),
      slotEnd: end.toISOString(),
      customerEmail: fields.email,
      ignoredBodyTenant,
    });
    return json({ error: 'Invalid Payload' }, 400);
  }

  const busy = await slotIsBusy(admin, auth.tenantId, staff as StaffRow, start, end);
  if (busy !== 'free') {
    await writeAudit(admin, {
      tenantId: auth.tenantId,
      chatbotId: auth.chatbotId,
      source: auth.source,
      outcome: 'rejected',
      reason: 'slot_unavailable',
      httpStatus: 409,
      ip,
      staffId: fields.staffId,
      serviceId: fields.serviceId,
      slotStart: start.toISOString(),
      slotEnd: end.toISOString(),
      customerEmail: fields.email,
      ignoredBodyTenant,
    });
    return json({
      booking_failure: {
        reason: 'SLOT_UNAVAILABLE',
        description: 'The requested slot was recently booked and is no longer available.',
      },
    }, 409);
  }

  const customerName = `${fields.givenName} ${fields.familyName}`.trim();

  // Service-role appointment insert. Only reached after the secret or widget
  // session check, server-side tenant, per-IP and per-tenant rate limits, and
  // the busy re-check.
  const { data: appointment, error: insertError } = await admin
    .from('appointments')
    .insert({
      tenant_id: auth.tenantId,
      staff_id: fields.staffId,
      service_id: fields.serviceId,
      customer_name: customerName,
      customer_email: fields.email,
      customer_phone: fields.telephone,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      google_event_id: `rwg-${Date.now()}`,
    })
    .select('id')
    .single();

  if (insertError || !appointment) {
    console.error('[CreateBooking] Insert error:', insertError?.message || 'no row');
    await writeAudit(admin, {
      tenantId: auth.tenantId,
      chatbotId: auth.chatbotId,
      source: auth.source,
      outcome: 'rejected',
      reason: 'insert_failed',
      httpStatus: 500,
      ip,
      staffId: fields.staffId,
      serviceId: fields.serviceId,
      slotStart: start.toISOString(),
      slotEnd: end.toISOString(),
      customerEmail: fields.email,
      ignoredBodyTenant,
    });
    return json({
      booking_failure: {
        reason: 'INTERNAL_ERROR',
        description: 'Failed to commit booking to database.',
      },
    }, 500);
  }

  await writeAudit(admin, {
    tenantId: auth.tenantId,
    chatbotId: auth.chatbotId,
    source: auth.source,
    outcome: 'accepted',
    reason: 'booked',
    httpStatus: 200,
    ip,
    staffId: fields.staffId,
    serviceId: fields.serviceId,
    slotStart: start.toISOString(),
    slotEnd: end.toISOString(),
    customerEmail: fields.email,
    ignoredBodyTenant,
  });

  return json({
    booking: {
      booking_id: appointment.id,
      slot: body?.slot,
      user_information: body?.user_information,
      status: 'CONFIRMED',
    },
  }, 200);
}

export function createBookingOptions(): NextResponse {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}
