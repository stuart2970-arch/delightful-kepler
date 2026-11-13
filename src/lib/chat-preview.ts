export interface PreviewProfile {
  tenant_id?: string | null;
  role?: string | null;
  is_super_admin?: boolean | null;
}

/** Dashboard preview is limited to the salon's owner or admin, or a superadmin. */
export function canUseReceptionistPreview(profile: PreviewProfile | null | undefined, chatbotTenantId: string): boolean {
  if (!profile || !chatbotTenantId) return false;
  if (profile.is_super_admin) return true;
  if (!profile.tenant_id || profile.tenant_id !== chatbotTenantId) return false;
  return profile.role === 'owner' || profile.role === 'admin';
}

export function previewBlocksBooking(isPreview: boolean): boolean {
  return isPreview;
}

export function previewBlocksCustomerNotifications(isPreview: boolean): boolean {
  return isPreview;
}

export const PREVIEW_BOOKING_DISABLED_MESSAGE =
  'Booking is turned off in this preview. No appointment was created, and no email, text, or WhatsApp was sent.';

/** Stable session id so a preview thread is not a customer conversation. */
export function previewSessionId(userId: string, requested: string): string {
  const trimmed = (requested || '').trim();
  if (trimmed.startsWith(`preview-${userId}-`)) return trimmed.slice(0, 120);
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'session';
  return `preview-${userId}-${safe}`;
}
