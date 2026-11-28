/** Bolt-ons that may have multiple simultaneous active subscription rows per tenant. */
export const REPEATABLE_ADDON_CATALOG_IDS = new Set(['data_pack_500']);

export const isRepeatableAddonCatalogId = (addonCatalogId: string | null | undefined): boolean =>
  Boolean(addonCatalogId && REPEATABLE_ADDON_CATALOG_IDS.has(addonCatalogId));