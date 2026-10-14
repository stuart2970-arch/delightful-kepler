import crypto from 'crypto';

export const DEFAULT_META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'styleflo_meta_verify_2026';
export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
export const META_GRAPH_BASE_URL = process.env.META_GRAPH_BASE_URL || `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export interface SendWhatsAppMessageParams {
  phoneNumberId: string;
  to: string;
  text: string;
  accessToken: string;
}

export interface SendMessengerParams {
  recipientId: string;
  text: string;
  accessToken: string;
  pageId?: string;
}

export interface SendInstagramParams {
  recipientId: string;
  text: string;
  accessToken: string;
  igAccountId?: string;
}

/**
 * Validates the X-Hub-Signature-256 header sent by Meta webhooks.
 */
export function validateMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret?: string
): boolean {
  const secret = appSecret || process.env.META_APP_SECRET;
  if (!secret) {
    // If no secret configured, proceed (helpful during initial dev/testing)
    return true;
  }
  if (!signatureHeader) {
    return false;
  }

  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  const signature = parts[1];
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Sends a WhatsApp message via the Meta WhatsApp Cloud API.
 */
export async function sendWhatsAppMessage({
  phoneNumberId,
  to,
  text,
  accessToken,
}: SendWhatsAppMessageParams): Promise<{ success: boolean; data?: any; error?: string }> {
  // Strip any leading '+' or spaces from the phone number
  const cleanTo = to.replace(/[^\d]/g, '');

  if (!phoneNumberId || !cleanTo || !accessToken) {
    return {
      success: false,
      error: 'Missing required parameters (phoneNumberId, to, or accessToken)',
    };
  }

  const url = `${META_GRAPH_BASE_URL}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanTo,
    type: 'text',
    text: {
      preview_url: false,
      body: text,
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[Meta WhatsApp] Outbound message failed:', data);
      return { success: false, error: data?.error?.message || 'Meta API error', data };
    }

    return { success: true, data };
  } catch (err: any) {
    console.error('[Meta WhatsApp] Network error sending WhatsApp message:', err);
    return { success: false, error: err.message || 'Network error' };
  }
}

/**
 * Marks an incoming WhatsApp message as read to show blue double ticks.
 */
export async function markWhatsAppMessageAsRead(
  phoneNumberId: string,
  messageId: string,
  accessToken: string
): Promise<void> {
  if (!phoneNumberId || !messageId || !accessToken) return;

  try {
    await fetch(`${META_GRAPH_BASE_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
  } catch (err) {
    // Non-critical, ignore
  }
}

/**
 * Sends a message via Facebook Messenger Send API.
 */
export async function sendMessengerMessage({
  recipientId,
  text,
  accessToken,
  pageId,
}: SendMessengerParams): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!recipientId || !accessToken) {
    return { success: false, error: 'Missing recipientId or accessToken' };
  }

  const endpoint = pageId ? `${META_GRAPH_BASE_URL}/${pageId}/messages` : `${META_GRAPH_BASE_URL}/me/messages`;

  const payload = {
    recipient: { id: recipientId },
    messaging_type: 'RESPONSE',
    message: { text },
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[Meta Messenger] Outbound message failed:', data);
      return { success: false, error: data?.error?.message || 'Meta API error', data };
    }

    return { success: true, data };
  } catch (err: any) {
    console.error('[Meta Messenger] Network error sending Messenger message:', err);
    return { success: false, error: err.message || 'Network error' };
  }
}

/**
 * Sends a message via Instagram Messaging API.
 */
export async function sendInstagramMessage({
  recipientId,
  text,
  accessToken,
}: SendInstagramParams): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!recipientId || !accessToken) {
    return { success: false, error: 'Missing recipientId or accessToken' };
  }

  const endpoint = `${META_GRAPH_BASE_URL}/me/messages`;

  const payload = {
    recipient: { id: recipientId },
    message: { text },
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[Meta Instagram] Outbound message failed:', data);
      return { success: false, error: data?.error?.message || 'Meta API error', data };
    }

    return { success: true, data };
  } catch (err: any) {
    console.error('[Meta Instagram] Network error sending Instagram message:', err);
    return { success: false, error: err.message || 'Network error' };
  }
}

/**
 * -------------------------------------------------------------
 * WHATSAPP EMBEDDED SIGNUP (v4) & ONBOARDING HELPERS
 * -------------------------------------------------------------
 */

export interface ExchangeCodeParams {
  code: string;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Exchanges the short-lived authorization code from Embedded Signup for a permanent system user access token.
 */
export async function exchangeCodeForToken({
  code,
  clientId,
  clientSecret,
}: ExchangeCodeParams): Promise<{ success: boolean; accessToken?: string; tokenType?: string; error?: string }> {
  const appId = clientId || process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = clientSecret || process.env.META_APP_SECRET;

  if (!appId || !appSecret || !code) {
    return { success: false, error: 'Missing appId, appSecret, or authorization code' };
  }

  const url = `${META_GRAPH_BASE_URL}/oauth/access_token?client_id=${encodeURIComponent(
    appId
  )}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`;

  try {
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();

    if (!res.ok || !data.access_token) {
      console.error('[Meta Onboard] Code exchange failed:', data);
      return { success: false, error: data?.error?.message || 'Token exchange failed' };
    }

    return {
      success: true,
      accessToken: data.access_token,
      tokenType: data.token_type || 'bearer',
    };
  } catch (err: any) {
    console.error('[Meta Onboard] Network error during token exchange:', err);
    return { success: false, error: err.message || 'Network error' };
  }
}

/**
 * Validates that the access token has permission to access the WABA and verifies the phone number belongs to it.
 */
export async function validateWabaAndPhone({
  wabaId,
  phoneNumberId,
  accessToken,
}: {
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
}): Promise<{
  isValid: boolean;
  displayPhone?: string;
  displayName?: string;
  qualityRating?: string;
  error?: string;
}> {
  if (!wabaId || !phoneNumberId || !accessToken) {
    return { isValid: false, error: 'Missing wabaId, phoneNumberId, or accessToken' };
  }

  try {
    // 1. Fetch WABA phone numbers
    const phoneRes = await fetch(`${META_GRAPH_BASE_URL}/${wabaId}/phone_numbers`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const phoneData = await phoneRes.json();

    if (!phoneRes.ok) {
      return { isValid: false, error: phoneData?.error?.message || 'Failed to fetch WABA phone numbers' };
    }

    const matched = (phoneData.data || []).find((p: any) => p.id === phoneNumberId);
    if (!matched) {
      return {
        isValid: false,
        error: `Phone number ID ${phoneNumberId} does not belong to WABA ${wabaId}`,
      };
    }

    return {
      isValid: true,
      displayPhone: matched.display_phone_number,
      displayName: matched.verified_name || matched.display_phone_number,
      qualityRating: matched.quality_rating || 'UNKNOWN',
    };
  } catch (err: any) {
    return { isValid: false, error: err.message || 'Network error validating WABA and phone' };
  }
}

/**
 * Checks whether the salon has attached a valid payment method in WhatsApp Manager.
 * Salons pay Meta directly, so card_missing alerts the salon owner via the dashboard.
 */
export async function checkWabaPaymentMethod({
  wabaId,
  accessToken,
}: {
  wabaId: string;
  accessToken: string;
}): Promise<{ cardMissing: boolean; paymentStatus: string }> {
  try {
    const res = await fetch(
      `${META_GRAPH_BASE_URL}/${wabaId}?fields=id,name,currency,timezone_id,payment_method_status,primary_funding_id`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const data = await res.json();

    if (!res.ok) {
      return { cardMissing: true, paymentStatus: 'unknown' };
    }

    const hasFunding = Boolean(data.primary_funding_id);
    const status = data.payment_method_status || (hasFunding ? 'VALID' : 'NO_PAYMENT_METHOD');
    const isMissing = !hasFunding && status !== 'VALID';

    return {
      cardMissing: isMissing,
      paymentStatus: status,
    };
  } catch {
    return { cardMissing: true, paymentStatus: 'unknown' };
  }
}

/**
 * Subscribes the StyleFlo application to the client's WABA for webhook events.
 */
export async function subscribeAppToWaba({
  wabaId,
  accessToken,
}: {
  wabaId: string;
  accessToken: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${META_GRAPH_BASE_URL}/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();

    if (!res.ok || data.success !== true) {
      return { success: false, error: data?.error?.message || 'Failed to subscribe app to WABA' };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error subscribing app to WABA' };
  }
}

/**
 * Registers the WhatsApp phone number with Meta using a 6-digit PIN.
 */
export async function registerPhoneNumber({
  phoneNumberId,
  pin,
  accessToken,
}: {
  phoneNumberId: string;
  pin: string;
  accessToken: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${META_GRAPH_BASE_URL}/${phoneNumberId}/register`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        pin,
      }),
    });
    const data = await res.json();

    if (!res.ok || data.success !== true) {
      return { success: false, error: data?.error?.message || 'Failed to register phone number' };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error registering phone number' };
  }
}

/**
 * Starter en_GB Message Templates for Salon Booking & Followups
 */
export const STARTER_TEMPLATES_EN_GB = [
  {
    name: 'appointment_reminder',
    category: 'UTILITY',
    language: 'en_GB',
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, reminder of your appointment with {{2}} on {{3}} at {{4}}. Reply YES to confirm or reply to reschedule.',
      },
    ],
  },
  {
    name: 'booking_link',
    category: 'UTILITY',
    language: 'en_GB',
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, thanks for reaching out to {{2}}! You can view our services and book online anytime here: {{3}}',
      },
    ],
  },
  {
    name: 'missed_call_followup',
    category: 'UTILITY',
    language: 'en_GB',
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, sorry we missed your call at {{2}}! How can we help you today?',
      },
    ],
  },
];

/**
 * Submits the three en_GB starter templates to Meta for approval under the tenant's WABA.
 */
export async function submitStarterTemplates({
  wabaId,
  accessToken,
}: {
  wabaId: string;
  accessToken: string;
}): Promise<Array<{ name: string; success: boolean; error?: string }>> {
  const results = [];

  for (const tpl of STARTER_TEMPLATES_EN_GB) {
    try {
      const res = await fetch(`${META_GRAPH_BASE_URL}/${wabaId}/message_templates`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tpl),
      });
      const data = await res.json();

      if (res.ok && data.id) {
        results.push({ name: tpl.name, success: true });
      } else {
        // May already exist or be in review
        const isDuplicate = data?.error?.error_user_title?.includes('duplicate') || data?.error?.message?.includes('already exists');
        results.push({
          name: tpl.name,
          success: isDuplicate ? true : false,
          error: isDuplicate ? undefined : data?.error?.message,
        });
      }
    } catch (err: any) {
      results.push({ name: tpl.name, success: false, error: err.message });
    }
  }

  return results;
}

export interface SendWhatsAppTemplateParams {
  phoneNumberId: string;
  to: string;
  templateName: string;
  languageCode?: string;
  components?: any[];
  accessToken: string;
}

/**
 * Sends an approved WhatsApp Template message (required for messages outside the 24h customer-service window).
 */
export async function sendWhatsAppTemplateMessage({
  phoneNumberId,
  to,
  templateName,
  languageCode = 'en_GB',
  components = [],
  accessToken,
}: SendWhatsAppTemplateParams): Promise<{ success: boolean; data?: any; error?: string }> {
  const cleanTo = to.replace(/[^\d]/g, '');
  if (!phoneNumberId || !cleanTo || !accessToken) {
    return { success: false, error: 'Missing required parameters' };
  }

  const url = `${META_GRAPH_BASE_URL}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanTo,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      return { success: false, error: data?.error?.message || 'Meta API error', data };
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error' };
  }
}
