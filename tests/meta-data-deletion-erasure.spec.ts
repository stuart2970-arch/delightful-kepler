import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { GET, POST } from '../src/app/api/data-deletion/route';

const SECRET = 'test_meta_app_secret_123';
const USER_ID = 'asid-ZZ218471';
const OTHER_ID = 'asid-KEEPME';
const ACME = '10000000-0000-0000-0000-000000000001';
const GLOBEX = '10000000-0000-0000-0000-000000000002';
const ACME_BOT = 'e0000000-0000-0000-0000-000000000001';
const GLOBEX_BOT = 'e0000000-0000-0000-0000-000000000002';

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signPayload(payload: Record<string, unknown>, secret: string): string {
  const encoded = base64Url(JSON.stringify(payload));
  const signature = base64Url(crypto.createHmac('sha256', secret).update(encoded).digest());
  return `${signature}.${encoded}`;
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('local supabase env missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

test.describe('Meta data-deletion callback erases the user across salons', () => {
  test('a verified request deletes that user in every salon and the status URL hides the user id', async () => {
    const supabase = admin();
    const acmeConversation = crypto.randomUUID();
    const globexConversation = crypto.randomUUID();
    const keepConversation = crypto.randomUUID();
    const acmeContact = crypto.randomUUID();
    const keepContact = crypto.randomUUID();
    const marker = `erase-marker-${Date.now()}`;

    const { error: convError } = await supabase.from('conversations').insert([
      { id: acmeConversation, tenant_id: ACME, chatbot_id: ACME_BOT, user_session_id: `messenger_${USER_ID}` },
      { id: globexConversation, tenant_id: GLOBEX, chatbot_id: GLOBEX_BOT, user_session_id: `instagram_${USER_ID}` },
      { id: keepConversation, tenant_id: ACME, chatbot_id: ACME_BOT, user_session_id: `messenger_${OTHER_ID}` },
    ]);
    expect(convError).toBeNull();

    const { error: messageError } = await supabase.from('messages').insert([
      { tenant_id: ACME, conversation_id: acmeConversation, sender_type: 'user', text_content: marker },
      { tenant_id: GLOBEX, conversation_id: globexConversation, sender_type: 'bot', text_content: marker },
      { tenant_id: ACME, conversation_id: keepConversation, sender_type: 'user', text_content: 'keep-me' },
    ]);
    expect(messageError).toBeNull();

    const { error: contactError } = await supabase.from('whatsapp_contacts').insert([
      { id: acmeContact, tenant_id: ACME, wa_id: USER_ID, profile_name: 'Erase Me' },
      { id: keepContact, tenant_id: GLOBEX, wa_id: OTHER_ID, profile_name: 'Keep Me' },
    ]);
    expect(contactError).toBeNull();

    const { error: waMessageError } = await supabase.from('whatsapp_messages').insert([
      {
        tenant_id: ACME,
        contact_id: acmeContact,
        wa_message_id: `wamid.${marker}`,
        direction: 'inbound',
        type: 'text',
        status: 'received',
        body: marker,
      },
      {
        tenant_id: GLOBEX,
        contact_id: keepContact,
        wa_message_id: `wamid.keep.${marker}`,
        direction: 'inbound',
        type: 'text',
        status: 'received',
        body: 'keep-me',
      },
    ]);
    expect(waMessageError).toBeNull();

    const previous = process.env.META_APP_SECRET;
    process.env.META_APP_SECRET = SECRET;
    try {
      const signed = signPayload({ algorithm: 'HMAC-SHA256', user_id: USER_ID }, SECRET);
      const res = await POST(
        new NextRequest('http://localhost:3001/api/data-deletion', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ signed_request: signed, user_id: 'spoofed-user' }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.confirmation_code).toMatch(/^del_[0-9a-f]+$/);
      expect(JSON.stringify(body)).not.toContain(USER_ID);
      expect(body.url).toContain(`/api/data-deletion?code=${body.confirmation_code}`);

      const status = await GET(
        new NextRequest(`http://localhost:3001/api/data-deletion?code=${body.confirmation_code}`),
      );
      expect(status.status).toBe(200);
      const statusBody = await status.json();
      expect(statusBody).toEqual({ confirmation_code: body.confirmation_code, status: 'completed' });
      expect(JSON.stringify(statusBody)).not.toContain(USER_ID);

      const { data: remainingConversations } = await supabase
        .from('conversations')
        .select('id, user_session_id')
        .in('id', [acmeConversation, globexConversation, keepConversation]);
      expect(remainingConversations?.map((row) => row.id).sort()).toEqual([keepConversation]);

      const { data: remainingMessages } = await supabase
        .from('messages')
        .select('conversation_id, text_content')
        .in('conversation_id', [acmeConversation, globexConversation, keepConversation]);
      expect(remainingMessages).toEqual([
        expect.objectContaining({ conversation_id: keepConversation, text_content: 'keep-me' }),
      ]);

      const { data: remainingContacts } = await supabase
        .from('whatsapp_contacts')
        .select('id')
        .in('id', [acmeContact, keepContact]);
      expect(remainingContacts?.map((row) => row.id)).toEqual([keepContact]);

      const { data: remainingWa } = await supabase
        .from('whatsapp_messages')
        .select('wa_message_id')
        .in('wa_message_id', [`wamid.${marker}`, `wamid.keep.${marker}`]);
      expect(remainingWa?.map((row) => row.wa_message_id)).toEqual([`wamid.keep.${marker}`]);

      const anon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: leaked, error: anonError } = await anon
        .from('meta_data_deletion_requests')
        .select('confirmation_code, status')
        .eq('confirmation_code', body.confirmation_code);
      expect(anonError).not.toBeNull();
      expect(leaked ?? []).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.META_APP_SECRET;
      else process.env.META_APP_SECRET = previous;
      await supabase.from('whatsapp_messages').delete().in('wa_message_id', [`wamid.${marker}`, `wamid.keep.${marker}`]);
      await supabase.from('whatsapp_contacts').delete().in('id', [acmeContact, keepContact]);
      await supabase.from('messages').delete().in('conversation_id', [acmeConversation, globexConversation, keepConversation]);
      await supabase.from('conversations').delete().in('id', [acmeConversation, globexConversation, keepConversation]);
    }
  });
});
