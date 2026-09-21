import twilio from 'twilio';

export interface OutboundSmsPayload {
  from: string;
  to: string;
  body: string;
  region?: string; // Optional: 'us1' or 'ie1' to handle regional routing
}

/**
 * Send an outbound SMS directly via Twilio SDK (bypassing external gateways)
 */
export async function sendDirectTwilioSms(payload: OutboundSmsPayload): Promise<{ success: boolean; messageSid?: string; error?: string }> {
  const { from, to, body, region } = payload;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    console.error('[Twilio SMS] Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN environment variables');
    return { success: false, error: 'Twilio credentials not configured' };
  }

  try {
    // Initialize Twilio client with region fallback options if specified
    const clientOpts: twilio.TwilioClientOptions = {};
    if (region) {
      clientOpts.region = region;
    }

    const client = twilio(accountSid, authToken, clientOpts);

    const message = await client.messages.create({
      from,
      to,
      body: body.replace(/[*#`_-]/g, '').trim(),
    });

    console.log(`[Twilio SMS] Successfully sent SMS to ${to}. Message SID: ${message.sid}`);
    return { success: true, messageSid: message.sid };
  } catch (error: any) {
    console.error('[Twilio SMS] Failed to send direct SMS:', error);
    return { success: false, error: error.message || 'Twilio transmission failed' };
  }
}
