import { createClient } from '@supabase/supabase-js';
import { sendDirectTwilioSms } from './twilio-sms';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://tkoasyjvrgaglofpzduq.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase environment variables are missing');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface BookingNotification {
  tenantId: string;
  customerName: string;
  phoneNumber: string; // Captured during Instagram DM or web intake
  appointmentTime: string;
  stylistName: string;
}

export async function sendOutboundAppointmentReminder(details: BookingNotification) {
  const { tenantId, customerName, phoneNumber, appointmentTime, stylistName } = details;

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Verify if the target business has SMS enabled in their chatbot configurations
    const { data: chatbot, error } = await supabaseAdmin
      .from('chatbots')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('sms_enabled', true)
      .single();

    if (error || !chatbot || !chatbot.sms_phone_number) {
      console.warn(`SMS reminders are not active or configured for Tenant ID: ${tenantId}`);
      return { success: false, reason: 'SMS integration disabled for tenant' };
    }

    const reminderMessage = `Hi ${customerName}, this is a confirmation for your appointment with ${stylistName} on ${appointmentTime}. We look forward to seeing you!`;

    // 2. Direct-dispatch outbound SMS via Native Twilio SDK
    const result = await sendDirectTwilioSms({
      from: chatbot.sms_phone_number,
      to: phoneNumber,
      body: reminderMessage,
    });

    if (!result.success) {
      throw new Error(`Direct Twilio SMS failed: ${result.error}`);
    }

    console.log(`Successfully dispatched outbound SMS reminder directly via Twilio to ${phoneNumber}`);
    return { success: true, messageSid: result.messageSid };

  } catch (err: any) {
    console.error('Outbound Reminder Execution Failed:', err);
    return { success: false, error: err.message };
  }
}
