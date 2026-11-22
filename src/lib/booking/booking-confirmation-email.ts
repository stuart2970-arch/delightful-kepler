import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { manageBookingUrl } from '@/lib/booking/manage-token';
import { escapeHtml, escapeHtmlAttr } from '@/lib/email/escape-html';
import { isBookingConfirmationEmailEnabled } from '@/lib/email/tenant-email-toggles';

export interface BookingConfirmationEmailParams {
  customerName: string;
  customerEmail: string;
  serviceName: string;
  staffName: string;
  formattedStart: string;
  manageToken?: string | null;
  businessName?: string;
  tenantId?: string | null;
}

/** From-name required by STYL-265 #45. */
export function bookingConfirmationFromName(businessName?: string | null): string {
  const business = (businessName || 'the small business').replace(/[\r\n<>"]/g, ' ').replace(/\s+/g, ' ').trim() || 'the small business';
  return `${business} via StyleFlo`;
}

export async function sendBookingConfirmationEmail(
  params: BookingConfirmationEmailParams,
): Promise<void> {
  const confirmationOn = await isBookingConfirmationEmailEnabled(params.tenantId);
  if (!confirmationOn) {
    return;
  }

  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
    return;
  }

  const mailgun = new Mailgun(formData);
  const mg = mailgun.client({
    username: 'api',
    key: process.env.MAILGUN_API_KEY,
    url: 'https://api.eu.mailgun.net',
  });

  const business = params.businessName || 'the small business';
  const name = escapeHtml(params.customerName);
  const service = escapeHtml(params.serviceName);
  const staff = escapeHtml(params.staffName);
  const when = escapeHtml(params.formattedStart);
  const businessEsc = escapeHtml(business);

  const manageUrl = params.manageToken ? manageBookingUrl(params.manageToken) : null;
  const manageBlockText = manageUrl
    ? `\n\nYou can cancel or reschedule online using this secure link (valid for 30 days):\n${manageUrl}\n`
    : '\n\nTo cancel or reschedule, please contact the small business directly.\n';

  const manageBlockHtml = manageUrl
    ? `<p><a href="${escapeHtmlAttr(manageUrl)}">Manage your booking</a> (cancel or reschedule — link valid for 30 days).</p>`
    : '<p>To cancel or reschedule, please contact the small business directly.</p>';

  const text = `Hi ${params.customerName},

Your appointment for ${params.serviceName} with ${params.staffName} is confirmed for ${params.formattedStart}.${manageBlockText}
Thank you for booking with ${business}.`;

  await mg.messages.create(process.env.MAILGUN_DOMAIN, {
    from: `${bookingConfirmationFromName(params.businessName)} <no-reply@${process.env.MAILGUN_DOMAIN}>`,
    to: [params.customerEmail],
    subject: `Booking Confirmed: ${params.serviceName} with ${params.staffName}`,
    text,
    html: `<p>Hi ${name},</p>
<p>Your appointment for <strong>${service}</strong> with <strong>${staff}</strong> is confirmed for <strong>${when}</strong>.</p>
${manageBlockHtml}
<p>Thank you for booking with ${businessEsc}.</p>`,
  });
}