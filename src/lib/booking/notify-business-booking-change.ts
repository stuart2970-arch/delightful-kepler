import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { createClient } from '@supabase/supabase-js';
import { buildBrandedEmailHtml } from '@/lib/email/branded-email-layout';
import { resolveServerPublicAppOrigin } from '@/lib/env/public-app-url';
import { escapeHtml } from '@/lib/email/escape-html';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resolveOwnerEmail(tenantId: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();
  if (!profile?.id) return null;
  const { data: authUser } = await admin.auth.admin.getUserById(profile.id);
  return authUser?.user?.email ?? null;
}

export async function sendBusinessBookingCancelledEmail(params: {
  tenantId: string;
  customerName: string;
  customerEmail: string;
  serviceName: string;
  staffName: string;
  formattedStart: string;
}): Promise<void> {
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) return;

  const adminEmail = await resolveOwnerEmail(params.tenantId);
  if (!adminEmail) return;

  const dashboardUrl = `${resolveServerPublicAppOrigin().replace(/\/+$/, '')}/dashboard?tab=scheduling`;
  const bodyHtml = `
<p style="font-size: 14px; color: #334155; line-height: 1.6;">
  <strong>${escapeHtml(params.customerName)}</strong> (${escapeHtml(params.customerEmail)}) cancelled their booking online.
</p>
<ul style="font-size: 14px; color: #334155;">
  <li>Service: ${escapeHtml(params.serviceName)}</li>
  <li>Staff: ${escapeHtml(params.staffName)}</li>
  <li>Was scheduled: ${escapeHtml(params.formattedStart)}</li>
</ul>`;

  const mailgun = new Mailgun(formData);
  const mg = mailgun.client({
    username: 'api',
    key: process.env.MAILGUN_API_KEY,
    url: 'https://api.eu.mailgun.net',
  });

  await mg.messages.create(process.env.MAILGUN_DOMAIN, {
    from: `StyleFlo Bookings <no-reply@${process.env.MAILGUN_DOMAIN}>`,
    to: [adminEmail],
    subject: `Booking cancelled by customer — ${params.serviceName}`,
    text: `Customer ${params.customerName} cancelled ${params.serviceName} with ${params.staffName} (${params.formattedStart}).`,
    html: buildBrandedEmailHtml({
      title: 'Customer cancelled a booking',
      bodyHtml,
      ctaHref: dashboardUrl,
      ctaLabel: 'View schedule',
    }),
  });
}