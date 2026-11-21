export const META_MESSAGING_COMING_SOON_LABEL = 'Coming soon' as const

export type MetaMessagingSurfaceChannel = 'whatsapp' | 'instagram' | 'messenger'

export type WhatsAppConnectionState = 'connected' | 'verifying' | 'disabled'

/**
 * Customer-facing badge label for Meta messaging channels (WhatsApp, Instagram, Messenger).
 * Disabled channels must never show "Available" while integrations are not generally available.
 */
export function metaMessagingChannelBadgeLabel(
  channel: MetaMessagingSurfaceChannel,
  whatsappState: WhatsAppConnectionState = 'disabled',
): string {
  if (channel === 'whatsapp') {
    if (whatsappState === 'connected') return 'Connected'
    if (whatsappState === 'verifying') return 'Verifying'
    return META_MESSAGING_COMING_SOON_LABEL
  }
  return META_MESSAGING_COMING_SOON_LABEL
}

export function resolveWhatsAppConnectionState(input: {
  isConnected?: boolean
  isVerifying?: boolean
}): WhatsAppConnectionState {
  if (input.isConnected) return 'connected'
  if (input.isVerifying) return 'verifying'
  return 'disabled'
}