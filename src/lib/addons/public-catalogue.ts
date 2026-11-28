import disabledAddonsList from './disabled-addons.json';

export const EXPECTED_DISABLED_ADDON_IDS: readonly string[] = disabledAddonsList;

/** One-off voice/SMS slider packs are retired from customer purchase surfaces (STYL-367). */
export const HIDDEN_PURCHASE_CATEGORIES = new Set(['voice_pack', 'sms_pack']);

/**
 * Shared filter for "publicly sellable" add-ons.
 * Applies .eq('is_active', true).neq('id', 'whatsapp_primary') to the given query.
 */
export function applyPublicAddonFilter<T extends { eq: (column: string, value: any) => T; neq: (column: string, value: any) => T }>(
  query: T
): T {
  return query.eq('is_active', true).neq('id', 'whatsapp_primary');
}

/**
 * Determines whether a given add-on record is publicly sellable.
 */
export function isAddonSellable(
  addon: { id?: string | null; is_active?: boolean | null; category?: string | null } | null | undefined,
): boolean {
  if (!addon) return false;
  if (addon.is_active === false) return false;
  if (addon.id === 'whatsapp_primary') return false;
  if (addon.category && HIDDEN_PURCHASE_CATEGORIES.has(addon.category)) return false;
  if (addon.id && (EXPECTED_DISABLED_ADDON_IDS as readonly string[]).includes(addon.id)) {
    if (addon.is_active !== true) return false;
  }
  return true;
}
