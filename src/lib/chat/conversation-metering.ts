import { chatConversationSectorTag } from '@/lib/billing/credit-grant-keys';
import { CHAT_MESSAGE_FEATURE_ID, logMeteredUsage } from '@/lib/entitlements';

/** A conversation ends after 30 minutes without messages. */
export const CHAT_CONVERSATION_IDLE_MS = 30 * 60 * 1000;

/** Fair use: after this many assistant replies, offer contact details or the booking link. */
export const CHAT_FAIR_USE_ASSISTANT_REPLIES = 30;

export const CHAT_CONVERSATION_CLOSING_REPLY =
  'I want to make sure you get the help you need. If you would like to continue, please share your contact details or use our booking link, and someone from the team will follow up.';

export function parseActivityTimestamp(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function isConversationIdle(lastActivityIso: string | null | undefined, nowMs: number = Date.now()): boolean {
  const lastMs = parseActivityTimestamp(lastActivityIso);
  if (lastMs == null) return false;
  return nowMs - lastMs > CHAT_CONVERSATION_IDLE_MS;
}

export function shouldStartNewConversationSession(
  lastActivityIso: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  return isConversationIdle(lastActivityIso, nowMs);
}

export function assistantReplyCountAtFairUseLimit(currentBotReplies: number): boolean {
  return currentBotReplies >= CHAT_FAIR_USE_ASSISTANT_REPLIES;
}

export function conversationAllowanceWouldExceed(
  currentUsage: number,
  limit: number | null | undefined,
  requestedVolume = 1,
): boolean {
  if (limit == null) return false;
  return currentUsage + requestedVolume > limit;
}

export async function hasConversationUsageRow(
  dbClient: { from: (table: string) => unknown },
  tenantId: string,
  conversationId: string,
): Promise<boolean> {
  const sectorTag = chatConversationSectorTag(conversationId);
  const { data, error } = await (dbClient as any)
    .from('usage_ledger')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('sector_tag', sectorTag)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.id);
}

export async function meterWebChatConversationOnce(
  dbClient: Parameters<typeof logMeteredUsage>[0],
  tenantId: string,
  conversationId: string,
): Promise<{ logged: boolean; alreadyMetered: boolean }> {
  const already = await hasConversationUsageRow(dbClient, tenantId, conversationId);
  if (already) {
    return { logged: false, alreadyMetered: true };
  }
  const logged = await logMeteredUsage(
    dbClient,
    tenantId,
    CHAT_MESSAGE_FEATURE_ID,
    1,
    'Web chat conversation',
    { sectorTag: chatConversationSectorTag(conversationId) },
  );
  return { logged, alreadyMetered: false };
}