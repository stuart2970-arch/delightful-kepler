import type { SupabaseClient } from '@supabase/supabase-js';

const SESSION_PREFIXES = ['', 'wa_', 'whatsapp_', 'instagram_', 'messenger_'] as const;

/** Exact session ids stored for a Meta app-scoped user. No prefix wildcards. */
export function metaUserSessionIds(userId: string): string[] {
  return SESSION_PREFIXES.map((prefix) => `${prefix}${userId}`);
}

function chunks<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

async function collectIds(
  load: (from: number, to: number) => Promise<{ data: { id: string }[] | null; error: { message: string } | null }>,
): Promise<string[]> {
  const ids: string[] = [];
  const pageSize = 500;
  let from = 0;
  for (;;) {
    const { data, error } = await load(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    ids.push(...rows.map((row) => row.id));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return ids;
}

/**
 * Deletes this Meta user's chat and WhatsApp message rows in every salon.
 * Matches exact session ids and WhatsApp wa_id only.
 */
export async function eraseMetaUserAcrossSalons(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ conversations: number; messages: number; whatsappMessages: number; contacts: number }> {
  const sessionIds = metaUserSessionIds(userId);
  const conversationIds = await collectIds((from, to) =>
    supabase.from('conversations').select('id').in('user_session_id', sessionIds).range(from, to),
  );

  let messages = 0;
  for (const group of chunks(conversationIds, 100)) {
    const { data, error } = await supabase.from('messages').delete().in('conversation_id', group).select('id');
    if (error) throw new Error(error.message);
    messages += data?.length ?? 0;
  }

  let conversations = 0;
  for (const group of chunks(conversationIds, 100)) {
    const { data, error } = await supabase.from('conversations').delete().in('id', group).select('id');
    if (error) throw new Error(error.message);
    conversations += data?.length ?? 0;
  }

  const contactIds = await collectIds((from, to) =>
    supabase.from('whatsapp_contacts').select('id').eq('wa_id', userId).range(from, to),
  );

  let whatsappMessages = 0;
  for (const group of chunks(contactIds, 100)) {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .delete()
      .in('contact_id', group)
      .select('id');
    if (error) throw new Error(error.message);
    whatsappMessages += data?.length ?? 0;
  }

  let contacts = 0;
  if (contactIds.length > 0) {
    const { data, error } = await supabase.from('whatsapp_contacts').delete().eq('wa_id', userId).select('id');
    if (error) throw new Error(error.message);
    contacts = data?.length ?? 0;
  }

  return { conversations, messages, whatsappMessages, contacts };
}
