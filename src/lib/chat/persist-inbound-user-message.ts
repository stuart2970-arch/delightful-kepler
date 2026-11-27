import type { SupabaseClient } from '@supabase/supabase-js';

const NIL_CONVERSATION_ID = '00000000-0000-0000-0000-000000000000';

export type PersistInboundUserMessageInput = {
  supabaseAdmin: SupabaseClient;
  tenantId: string;
  conversationId: string | null | undefined;
  message: string;
  requestId?: string;
  createdAt?: string;
};

/**
 * Persists the customer's inbound chat turn before the model stream runs so a
 * stream/API failure cannot drop the user message (STYL-425).
 */
export async function persistInboundUserMessage(
  input: PersistInboundUserMessageInput,
): Promise<boolean> {
  const { conversationId, message, tenantId, supabaseAdmin, requestId } = input;
  if (!conversationId || conversationId === NIL_CONVERSATION_ID) return false;
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return false;

  const userTime = input.createdAt ?? new Date(Date.now() - 1000).toISOString();
  const { error } = await supabaseAdmin.from('messages').insert({
    tenant_id: tenantId,
    conversation_id: conversationId,
    sender_type: 'user',
    text_content: message,
    created_at: userTime,
  });

  if (error) {
    console.error(
      `[Chat Stream]${requestId ? `[${requestId}]` : ''} Failed to persist inbound user message:`,
      error,
    );
    return false;
  }

  return true;
}