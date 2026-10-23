/**
 * The chat-window StyleFlo footer. An empty branding string still shows the
 * default line. Only the explicit hide flag removes the footer and its tracking link.
 */

export const REMOVE_STYLEFLO_BRANDING_ADDON_ID = 'remove_styleflo_branding';

export const DEFAULT_STYLEFLO_BRANDING_HTML =
  '<span style="opacity: 0.6; font-size: 11px;">⚡ Powered by <strong>StyleFlo</strong></span>';

export function resolveChatFooter(config: {
  hideStyleFloBranding?: boolean | null;
  brandingHtml?: string | null;
}): { hide: boolean; html: string } {
  const supplied = typeof config.brandingHtml === 'string' ? config.brandingHtml.trim() : '';
  return {
    hide: config.hideStyleFloBranding === true,
    html: supplied || DEFAULT_STYLEFLO_BRANDING_HTML,
  };
}

export function tenantHidesStyleFloBranding(input: {
  purchases: { addon_catalog_id: string | null; is_active: boolean }[];
  inclusions: { addon_catalog_id: string | null; included: boolean }[];
}): boolean {
  const purchased = input.purchases.some(
    (row) => row.addon_catalog_id === REMOVE_STYLEFLO_BRANDING_ADDON_ID && row.is_active
  );
  const included = input.inclusions.some(
    (row) => row.addon_catalog_id === REMOVE_STYLEFLO_BRANDING_ADDON_ID && row.included
  );
  return purchased || included;
}
