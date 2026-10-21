import disabledAddonsList from './disabled-addons.json';

export const EXPECTED_DISABLED_ADDON_IDS: readonly string[] = disabledAddonsList;

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
export function isAddonSellable(addon: { id?: string | null; is_active?: boolean | null } | null | undefined): boolean {
  if (!addon) return false;
  return addon.is_active === true && addon.id !== 'whatsapp_primary';
}
