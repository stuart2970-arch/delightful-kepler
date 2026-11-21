export const PLAN_VOICE_PREFIX = 'plan_voice:';

export function planVoiceCheckoutSectorTag(sessionId: string): string {
  return `${PLAN_VOICE_PREFIX}checkout:${sessionId}`;
}

export function planVoiceInvoiceSectorTag(invoiceId: string): string {
  return `${PLAN_VOICE_PREFIX}${invoiceId}`;
}

export function invoiceAddonGrantSectorTag(
  invoiceId: string,
  addonCatalogId: string,
  featureId: string,
): string {
  return `invoice_addon:${invoiceId}:${addonCatalogId}:${featureId}`;
}

export function oneOffGrantSectorTag(sessionId: string, featureId: string): string {
  return `one_off:${sessionId}:${featureId}`;
}

export const CHAT_CONVERSATION_PREFIX = 'chat_conversation:';

export function chatConversationSectorTag(conversationId: string): string {
  return `${CHAT_CONVERSATION_PREFIX}${conversationId}`;
}