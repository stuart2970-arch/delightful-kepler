export type BoltOnMetadata = Record<string, string | boolean | undefined>;

export type BoltOnCheckoutMetaInput = {
  tenantId: string;
  addonCatalogId: string;
  category: string;
  isSliding: boolean;
  pricePence: number;
  voiceMinutes: number;
  sms: number;
  isOneOff: boolean;
  autoTopup?: boolean;
  autoTopupThreshold?: number;
};

export function isBoltOnMetadata(metadata: BoltOnMetadata | null | undefined): boolean {
  if (!metadata) return false;
  if (metadata.is_addon === 'true' || metadata.is_addon === true) return true;
  if (!metadata.addon_catalog_id) return false;
  if (metadata.plan_tier || metadata.selected_addons) return false;
  return true;
}

export function buildBoltOnCheckoutMetadata(input: BoltOnCheckoutMetaInput): Record<string, string> {
  const metadata: Record<string, string> = {
    tenant_id: input.tenantId,
    addon_catalog_id: input.addonCatalogId,
    category: input.category,
    is_addon: 'true',
    is_sliding: input.isSliding ? 'true' : 'false',
    price_pence: String(input.pricePence),
    custom_price_pence: String(input.pricePence),
    voice_minutes: String(input.voiceMinutes),
    custom_voice_minutes: String(input.voiceMinutes),
    sms: String(input.sms),
    custom_sms: String(input.sms),
    is_one_off: input.isOneOff ? 'true' : 'false',
  };

  if (input.autoTopup !== undefined) {
    metadata.auto_topup = String(Boolean(input.autoTopup));
    metadata.auto_topup_threshold = String(input.autoTopupThreshold || 10);
  }

  return metadata;
}

export function mapAddonCategoryToFeatureId(category: string): string {
  switch (category) {
    case 'landline':
      return 'telephone_number';
    case 'mobile':
      return 'mobile_number';
    case 'whatsapp':
      return 'whatsapp_omni';
    case 'voice_pack':
      return 'voice_minutes';
    case 'sms_pack':
      return 'sms_messages';
    case 'data_pack':
      return 'data_chunks_addon';
    case 'google_calendar':
      return 'google_calendar';
    case 'microsoft_calendar':
      return 'microsoft_calendar';
    case 'remove_branding':
      return 'remove_branding';
    default:
      return category;
  }
}

const PENDING_ACTIVATION = 'Payment received. Your bolt-on will switch on in a moment.';

export function resolveCheckoutSuccessBanner(input: {
  addonId?: string | null;
  tab?: string | null;
}): string {
  const addon = input.addonId || '';
  const tab = input.tab || '';

  if (addon === 'microsoft_calendar_addon') {
    return `${PENDING_ACTIVATION} Microsoft Calendar integration will be available shortly.`;
  }
  if (addon === 'google_calendar_addon' || tab === 'scheduling') {
    return `${PENDING_ACTIVATION} Google Calendar integration will be available shortly.`;
  }
  if (addon === 'data_pack_500' || tab === 'knowledge' || tab === 'crawler') {
    return `${PENDING_ACTIVATION} Extra knowledge items will be added to your workspace.`;
  }
  if (
    addon === 'landline_addon' ||
    addon === 'mobile_addon' ||
    addon === 'sms_pack_100' ||
    addon === 'voice_pack_20' ||
    tab === 'telephony'
  ) {
    return `${PENDING_ACTIVATION} Your telephone channel will be ready shortly. Search and select your preferred number below.`;
  }
  return PENDING_ACTIVATION;
}
