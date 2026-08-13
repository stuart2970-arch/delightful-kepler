import { createClient } from '@supabase/supabase-js';

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

    // 2. Direct-dispatch payload to your external OpenClaw server's Outbound SMS Route
    const openClawHost = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:18789';
    const openClawEndpoint = `${openClawHost}/api/channels/twilio_sms/send`;
    const secretKey = process.env.OPENCLAW_BEARER_TOKEN || 'openclaw_secret_bearer_key_to_styleflo_api';

    const response = await fetch(openClawEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`
      },
      body: JSON.stringify({
        from: chatbot.sms_phone_number,
        to: phoneNumber,
        message: reminderMessage
      })
    });

    if (!response.ok) {
      throw new Error(`OpenClaw responded with status: ${response.status}`);
    }

    console.log(`Successfully dispatched outbound SMS reminder to ${phoneNumber}`);
    return { success: true };

  } catch (err: any) {
    console.error('Outbound Reminder Execution Failed:', err);
    return { success: false, error: err.message };
  }
}
