export interface AddonCatalogItem {
  id?: string;
  category?: string;
  name?: string;
  description?: string | null;
  is_sliding?: boolean | null;
  monthly_price_pence?: number | null;
  max_price_pence?: number | null;
  price_step_pence?: number | null;
  included_voice_minutes?: number | null;
  max_voice_minutes?: number | null;
  included_sms?: number | null;
  max_sms?: number | null;
  included_data_chunks?: number | null;
  included_messages?: number | null;
  is_active?: boolean | null;
  display_order?: number | null;
  [key: string]: any;
}

/**
 * Formats the allowance range from actual superadmin numerical values.
 * Does NOT hard-code numbers.
 * Examples: "30–130 voice minutes", "100–550 texts", "500 knowledge items".
 */
export function formatAllowanceRange(addon: AddonCatalogItem): string {
  if (!addon) return '';
  const category = addon.category || '';
  const isSliding = Boolean(addon.is_sliding);

  if (category === 'voice_pack' || addon.id?.startsWith('voice_pack')) {
    const minM = addon.included_voice_minutes ?? 0;
    const maxM = addon.max_voice_minutes ?? minM;
    if (isSliding && maxM > minM) {
      return `${minM}–${maxM} voice minutes`;
    }
    return `${minM} voice minutes`;
  }

  if (category === 'sms_pack' || addon.id?.startsWith('sms_pack')) {
    const minS = addon.included_sms ?? 0;
    const maxS = addon.max_sms ?? minS;
    if (isSliding && maxS > minS) {
      return `${minS}–${maxS} texts`;
    }
    return `${minS} texts`;
  }

  if (category === 'landline' || addon.id === 'landline_addon') {
    const minM = addon.included_voice_minutes ?? 0;
    const maxM = addon.max_voice_minutes ?? minM;
    if (isSliding && maxM > minM) {
      return `${minM}–${maxM} voice minutes`;
    }
    return `${minM} voice minutes`;
  }

  if (category === 'mobile' || addon.id === 'mobile_addon') {
    const minS = addon.included_sms ?? 0;
    const maxS = addon.max_sms ?? minS;
    if (isSliding && maxS > minS) {
      return `${minS}–${maxS} texts`;
    }
    return `${minS} texts`;
  }

  if (category === 'data_pack' || addon.id?.startsWith('data_pack')) {
    const chunks = addon.included_data_chunks ?? 500;
    return `${chunks} knowledge items`;
  }

  if (category === 'whatsapp' || addon.id?.startsWith('whatsapp')) {
    const msgs = addon.included_messages ?? 500;
    return `${msgs} WhatsApp messages`;
  }

  if (category === 'google_calendar' || category === 'microsoft_calendar') {
    return '1 calendar integration';
  }

  return '';
}

/**
 * Builds the customer-facing line description for Stripe checkout.
 * Enforces British English ("texts", not "SMS messages"),
 * zero £ amounts, zero VAT mentions, and clear 3-month one-off expiration for packs.
 */
export function buildCheckoutLineDescription(
  addon: AddonCatalogItem,
  opts: { voiceMinutes?: number | null; sms?: number | null } = {}
): string {
  if (!addon) return '';
  const category = addon.category || '';
  const isOneOff = 
    category === 'sms_pack' ||
    category === 'voice_pack' ||
    addon.id?.startsWith('sms_pack') ||
    addon.id?.startsWith('voice_pack');

  const voiceMinutes = opts.voiceMinutes !== undefined && opts.voiceMinutes !== null
    ? opts.voiceMinutes
    : (addon.included_voice_minutes ?? 0);

  const sms = opts.sms !== undefined && opts.sms !== null
    ? opts.sms
    : (addon.included_sms ?? 0);

  if (category === 'voice_pack' || addon.id?.startsWith('voice_pack')) {
    return `One-off pack of ${voiceMinutes} voice minutes. Expires 3 months after purchase.`;
  }

  if (category === 'sms_pack' || addon.id?.startsWith('sms_pack')) {
    return `One-off pack of ${sms} texts. Expires 3 months after purchase.`;
  }

  if (category === 'mobile' || addon.id === 'mobile_addon') {
    return `Includes dedicated UK mobile number (07) for WhatsApp and ${sms} texts.`;
  }

  if (category === 'landline' || addon.id === 'landline_addon') {
    return `Includes dedicated local landline number and ${voiceMinutes} shared voice minutes a month.`;
  }

  if (category === 'data_pack' || addon.id?.startsWith('data_pack')) {
    return 'Extra knowledge items for your AI agent.';
  }

  if (category === 'whatsapp' || addon.id?.startsWith('whatsapp')) {
    return 'WhatsApp Business AI integration.';
  }

  if (voiceMinutes > 0 && sms > 0) {
    return `Includes ${voiceMinutes} shared voice minutes and ${sms} texts a month.`;
  }

  if (voiceMinutes > 0) {
    return `Includes ${voiceMinutes} shared voice minutes a month.`;
  }

  if (sms > 0) {
    return isOneOff
      ? `One-off pack of ${sms} texts. Expires 3 months after purchase.`
      : `Includes ${sms} texts a month.`;
  }

  return addon.description || addon.name || '';
}

/**
 * Validates customer-facing addon name and description.
 * Rejects:
 * - Names < 3 or > 60 chars
 * - Descriptions > 300 chars
 * - HTML tags (< or >)
 * - Control characters
 * - "£" followed by digits (e.g. "£12", "£ 9.99")
 * - Word "VAT" (case-insensitive)
 */
export function validateAddonText(data: { name?: string; description?: string | null }): {
  valid: boolean;
  error?: string;
} {
  if (data.name !== undefined) {
    const name = data.name.trim();
    if (name.length < 3 || name.length > 60) {
      return { valid: false, error: 'Name must be between 3 and 60 characters.' };
    }
    if (/[<>]/.test(name)) {
      return { valid: false, error: 'HTML tags are not permitted in name.' };
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1F\x7F]/.test(name)) {
      return { valid: false, error: 'Control characters are not permitted in name.' };
    }
    if (/[£]\s*\d/.test(name)) {
      return {
        valid: false,
        error: "Prices come from the price fields, so please don't type £ amounts in the name or description.",
      };
    }
    if (/\bvat\b/i.test(name)) {
      return { valid: false, error: 'VAT wording is not permitted in name or description.' };
    }
  }

  if (data.description !== undefined && data.description !== null) {
    const desc = data.description.trim();
    if (desc.length > 300) {
      return { valid: false, error: 'Description must not exceed 300 characters.' };
    }
    if (/[<>]/.test(desc)) {
      return { valid: false, error: 'HTML tags are not permitted in description.' };
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1F\x7F]/.test(desc)) {
      return { valid: false, error: 'Control characters are not permitted in description.' };
    }
    if (/[£]\s*\d/.test(desc)) {
      return {
        valid: false,
        error: "Prices come from the price fields, so please don't type £ amounts in the name or description.",
      };
    }
    if (/\bvat\b/i.test(desc)) {
      return { valid: false, error: 'VAT wording is not permitted in name or description.' };
    }
  }

  return { valid: true };
}
