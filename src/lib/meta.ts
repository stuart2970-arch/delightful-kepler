import crypto from 'crypto';

export const DEFAULT_META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'styleflo_meta_verify_2026';
export const META_GRAPH_VERSION = 'v21.0';
export const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

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
