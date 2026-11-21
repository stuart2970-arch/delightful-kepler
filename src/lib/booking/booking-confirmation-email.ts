import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { manageBookingUrl } from '@/lib/booking/manage-token';

export interface BookingConfirmationEmailParams {
  customerName: string;
  customerEmail: string;
  serviceName: string;
  staffName: string;
  formattedStart: string;
  manageToken: string;
  businessName?: string;
}

export async function sendBookingConfirmationEmail(
  params: BookingConfirmationEmailParams,
): Promise<void> {
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
    return;
  }

  const manageUrl = manageBookingUrl(params.manageToken);
  const mailgun = new Mailgun(formData);
  const mg = mailgun.client({
    username: 'api',
    key: process.env.MAILGUN_API_KEY,
    url: 'https://api.eu.mailgun.net',
  });

  const business = params.businessName || 'the small business';
  const text = `Hi ${params.customerName},

Your appointment for ${params.serviceName} with ${params.staffName} is confirmed for ${params.formattedStart}.

You can cancel or reschedule online using this secure link (valid for 30 days):
${manageUrl}

Thank you for booking with ${business}.`;

  await mg.messages.create(process.env.MAILGUN_DOMAIN, {
    from: `StyleFlo Bookings <no-reply@${process.env.MAILGUN_DOMAIN}>`,
    to: [params.customerEmail],
    subject: `Booking Confirmed: ${params.serviceName} with ${params.staffName}`,
    text,
    html: `<p>Hi ${params.customerName},</p>
<p>Your appointment for <strong>${params.serviceName}</strong> with <strong>${params.staffName}</strong> is confirmed for <strong>${params.formattedStart}</strong>.</p>
<p><a href="${manageUrl}">Manage your booking</a> (cancel or reschedule — link valid for 30 days).</p>
<p>Thank you for booking with ${business}.</p>`,
  });
}