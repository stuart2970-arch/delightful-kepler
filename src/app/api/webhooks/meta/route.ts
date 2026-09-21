import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateText, embed } from 'ai';
import { google } from '@ai-sdk/google';
import {
  DEFAULT_META_VERIFY_TOKEN,
  sendWhatsAppMessage,
  markWhatsAppMessageAsRead,
  sendMessengerMessage,
  sendInstagramMessage,
  validateMetaSignature,
} from '@/lib/meta';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'https://tkoasyjvrgaglofpzduq.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role environment variables are missing');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * GET: Meta Webhook Verification Handshake
 * Meta sends hub.mode=subscribe, hub.verify_token, and hub.challenge
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get('hub.mode');
  const verifyToken = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  console.log(`[Meta Webhook Handshake] mode: "${mode}", token: "${verifyToken}"`);

  if (mode === 'subscribe') {
    // Check against global env or default verify token
    const expectedToken = process.env.META_VERIFY_TOKEN || DEFAULT_META_VERIFY_TOKEN;

    if (verifyToken === expectedToken) {
      console.log('[Meta Webhook Handshake] Verification successful!');
      return new NextResponse(challenge || 'challenge_accepted', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Also check if any chatbot has a custom verify token matching this
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { data: matchedBot } = await supabaseAdmin
        .from('chatbots')
        .select('id')
        .eq('meta_verify_token', verifyToken)
        .limit(1)
        .maybeSingle();

      if (matchedBot) {
        console.log(`[Meta Webhook Handshake] Verified via chatbot ${matchedBot.id}`);
        return new NextResponse(challenge || 'challenge_accepted', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    } catch (err) {
      console.warn('[Meta Webhook Handshake] Database verify token check failed:', err);
    }

    console.warn('[Meta Webhook Handshake] Verification token mismatch');
    return new NextResponse('Verification token mismatch', { status: 403 });
  }

  return new NextResponse('Invalid webhook verification mode', { status: 400 });
}

/**
 * POST: Inbound Messages from WhatsApp Cloud API, Instagram Messaging & Facebook Messenger
 */
export async function POST(request: NextRequest) {
  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-hub-signature-256');

    // Optional signature check if secret configured
    if (process.env.META_APP_SECRET && signature) {
      const isValid = validateMetaSignature(rawBody, signature, process.env.META_APP_SECRET);
      if (!isValid) {
        console.warn('[Meta Webhook] Signature validation failed');
        // Still proceed in development if needed, or return 401
      }
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // -------------------------------------------------------------
    // 1. WHATSAPP CLOUD API PARSING
    // -------------------------------------------------------------
    if (payload.entry && Array.isArray(payload.entry)) {
      for (const entry of payload.entry) {
        // Check WhatsApp changes
        if (entry.changes && Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            if (change.field === 'messages' && change.value) {
              const value = change.value;

              // Ignore delivery/read status updates
              if (value.statuses && !value.messages) {
                return NextResponse.json({ status: 'status_acknowledged' }, { status: 200 });
              }

              if (value.messages && Array.isArray(value.messages)) {
                for (const msg of value.messages) {
                  const phoneNumberId = value.metadata?.phone_number_id;
                  const displayPhone = value.metadata?.display_phone_number;
                  const senderPhone = msg.from; // Customer's phone number
                  const messageId = msg.id;
                  const contactName = value.contacts?.[0]?.profile?.name || 'Customer';

                  let incomingText = '';
                  if (msg.type === 'text') {
                    incomingText = msg.text?.body || '';
                  } else if (msg.type === 'button') {
                    incomingText = msg.button?.text || '';
                  } else if (msg.type === 'interactive') {
                    incomingText =
                      msg.interactive?.button_reply?.title ||
                      msg.interactive?.list_reply?.title ||
                      '';
                  }

                  if (!incomingText) continue;

                  console.log(
                    `[Meta WhatsApp Inbound] From ${senderPhone} to phoneId ${phoneNumberId}: "${incomingText}"`
                  );

                  await processMessageJourney({
                    supabaseAdmin,
                    channel: 'whatsapp',
                    userSessionId: `wa_${senderPhone}`,
                    senderId: senderPhone,
                    senderName: contactName,
                    phoneNumberId,
                    displayPhone,
                    incomingText,
                    messageId,
                  });
                }
              }
            }
          }
        }

        // -------------------------------------------------------------
        // 2. FACEBOOK MESSENGER & INSTAGRAM MESSAGING PARSING
        // -------------------------------------------------------------
        if (entry.messaging && Array.isArray(entry.messaging)) {
          const isInstagram = payload.object === 'instagram';
          const channel = isInstagram ? 'instagram' : 'messenger';

          for (const event of entry.messaging) {
            // Ignore delivery / read echoes
            if (event.delivery || event.read || event.message?.is_echo) {
              continue;
            }

            const senderId = event.sender?.id;
            const recipientId = event.recipient?.id;
            const incomingText = event.message?.text || event.postback?.title || '';
            const messageId = event.message?.mid;

            if (!incomingText || !senderId) continue;

            console.log(
              `[Meta ${channel.toUpperCase()} Inbound] From ${senderId} to ${recipientId}: "${incomingText}"`
            );

            await processMessageJourney({
              supabaseAdmin,
              channel,
              userSessionId: `${channel}_${senderId}`,
              senderId,
              senderName: isInstagram ? 'Instagram User' : 'Facebook User',
              recipientId,
              incomingText,
              messageId,
            });
          }
        }
      }
    }

    return NextResponse.json({ success: true, processed: true }, { status: 200 });
  } catch (error: any) {
    console.error('[Meta Webhook API] Error handling webhook:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * Core Conversational Journey Engine
 * Resolves Chatbot -> Retrieves RAG Chunks -> Generates Gemini Response -> Dispatches Outbound Message
 */
async function processMessageJourney(params: {
  supabaseAdmin: any;
  channel: 'whatsapp' | 'instagram' | 'messenger';
  userSessionId: string;
  senderId: string;
  senderName: string;
  phoneNumberId?: string;
  displayPhone?: string;
  recipientId?: string;
  incomingText: string;
  messageId?: string;
}) {
  const {
    supabaseAdmin,
    channel,
    userSessionId,
    senderId,
    senderName,
    phoneNumberId,
    displayPhone,
    recipientId,
    incomingText,
    messageId,
  } = params;

  // 1. Resolve Tenant & Chatbot
  let chatbot: any = null;
  let tenant: any = null;

  if (channel === 'whatsapp') {
    // Try lookup by whatsapp_phone_number_id
    if (phoneNumberId) {
      const { data: bot } = await supabaseAdmin
        .from('chatbots')
        .select('*, tenants(*)')
        .eq('whatsapp_phone_number_id', phoneNumberId)
        .limit(1)
        .maybeSingle();

      if (bot) {
        chatbot = bot;
        tenant = bot.tenants;
      } else {
        const { data: jsonBot } = await supabaseAdmin
          .from('chatbots')
          .select('*, tenants(*)')
          .eq('configuration_json->>whatsapp_phone_number_id', phoneNumberId)
          .limit(1)
          .maybeSingle();

        if (jsonBot) {
          chatbot = jsonBot;
          tenant = jsonBot.tenants;
        }
      }
    }

    // Fallback: match by phone number or mobile number
    if (!chatbot && displayPhone) {
      const cleanDisplay = displayPhone.replace(/[^\d]/g, '');
      const { data: tenantFound } = await supabaseAdmin
        .from('tenants')
        .select('*')
        .or(`twilio_mobile_number.ilike.%${cleanDisplay}%,twilio_shadow_number.ilike.%${cleanDisplay}%`)
        .limit(1)
        .maybeSingle();

      if (tenantFound) {
        tenant = tenantFound;
        const { data: bot } = await supabaseAdmin
          .from('chatbots')
          .select('*')
          .eq('tenant_id', tenantFound.id)
          .limit(1)
          .maybeSingle();
        chatbot = bot;
      }
    }
  } else if (channel === 'instagram') {
    if (recipientId) {
      const { data: bot } = await supabaseAdmin
        .from('chatbots')
        .select('*, tenants(*)')
        .eq('instagram_account_id', recipientId)
        .limit(1)
        .maybeSingle();
      if (bot) {
        chatbot = bot;
        tenant = bot.tenants;
      } else {
        const { data: jsonBot } = await supabaseAdmin
          .from('chatbots')
          .select('*, tenants(*)')
          .eq('configuration_json->>instagram_account_id', recipientId)
          .limit(1)
          .maybeSingle();
        if (jsonBot) {
          chatbot = jsonBot;
          tenant = jsonBot.tenants;
        }
      }
    }
  } else if (channel === 'messenger') {
    if (recipientId) {
      const { data: bot } = await supabaseAdmin
        .from('chatbots')
        .select('*, tenants(*)')
        .eq('messenger_page_id', recipientId)
        .limit(1)
        .maybeSingle();
      if (bot) {
        chatbot = bot;
        tenant = bot.tenants;
      } else {
        const { data: jsonBot } = await supabaseAdmin
          .from('chatbots')
          .select('*, tenants(*)')
          .eq('configuration_json->>messenger_page_id', recipientId)
          .limit(1)
          .maybeSingle();
        if (jsonBot) {
          chatbot = jsonBot;
          tenant = jsonBot.tenants;
        }
      }
    }
  }

  // Universal Fallback: Resolve primary active chatbot & tenant to guarantee response
  if (!chatbot) {
    const { data: fallbackBot } = await supabaseAdmin
      .from('chatbots')
      .select('*, tenants(*)')
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fallbackBot) {
      chatbot = fallbackBot;
      tenant = fallbackBot.tenants;
    }
  }

  const tenantId = tenant?.id || chatbot?.tenant_id;
  const chatbotId = chatbot?.id;
  const botName = chatbot?.name || tenant?.company_name || 'StyleFlo Assistant';

  // Resolve Meta Access Token (chatbot override -> tenant override -> environment variable)
  const metaAccessToken =
    chatbot?.meta_access_token ||
    tenant?.meta_access_token ||
    process.env.META_ACCESS_TOKEN ||
    process.env.META_WHATSAPP_TOKEN;

  // 2. Mark incoming WhatsApp message as read (blue double ticks)
  if (channel === 'whatsapp' && phoneNumberId && messageId && metaAccessToken) {
    markWhatsAppMessageAsRead(phoneNumberId, messageId, metaAccessToken).catch(() => {});
  }

  // 3. Find or Create Conversation Record
  let conversationId: string | null = null;
  if (tenantId && chatbotId) {
    const { data: existingConv } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('chatbot_id', chatbotId)
      .eq('tenant_id', tenantId)
      .eq('user_session_id', userSessionId)
      .maybeSingle();

    if (existingConv) {
      conversationId = existingConv.id;
    } else {
      const { data: newConv } = await supabaseAdmin
        .from('conversations')
        .insert({
          chatbot_id: chatbotId,
          tenant_id: tenantId,
          user_session_id: userSessionId,
        })
        .select('id')
        .single();

      if (newConv) {
        conversationId = newConv.id;
      }
    }

    // Insert user incoming message
    if (conversationId) {
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversationId,
        tenant_id: tenantId,
        sender_type: 'user',
        text_content: incomingText,
      });
    }
  }

  // 4. Retrieve Vector Knowledge Base Context (RAG)
  let contextText = '';
  if (chatbotId && tenantId) {
    try {
      const { embedding } = await embed({
        model: google.textEmbeddingModel('text-embedding-004'),
        value: incomingText,
      });

      const { data: chunks } = await supabaseAdmin.rpc('match_documents', {
        query_embedding: embedding,
        match_threshold: 0.35,
        match_count: 4,
        targeting_tenant_id: tenantId,
        targeting_chatbot_id: chatbotId,
      });

      if (chunks && chunks.length > 0) {
        contextText = chunks.map((c: any) => c.content).join('\n');
      }
    } catch (err: any) {
      console.warn('[Meta Webhook] Vector RAG embedding fallback:', err.message);
      const { data: fallbackChunks } = await supabaseAdmin
        .from('document_chunks')
        .select('content')
        .eq('chatbot_id', chatbotId)
        .limit(4);

      if (fallbackChunks) {
        contextText = fallbackChunks.map((c: any) => c.content).join('\n');
      }
    }
  }

  // 5. Fetch recent chat history
  let historyPrompt = '';
  if (conversationId) {
    const { data: history } = await supabaseAdmin
      .from('messages')
      .select('sender_type, text_content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(6);

    if (history) {
      historyPrompt = history
        .slice()
        .reverse()
        .map((h: any) => `${h.sender_type === 'user' ? 'Customer' : 'Assistant'}: ${h.text_content}`)
        .join('\n');
    }
  }

  // 6. Generate Response using Gemini
  const channelDisplay =
    channel === 'whatsapp'
      ? 'WhatsApp'
      : channel === 'instagram'
      ? 'Instagram DM'
      : 'Facebook Messenger';

  const systemInstruction = `
You are the official 24/7 AI Assistant for ${botName}.
You are interacting with a client via ${channelDisplay}.
Customer Name: ${senderName}.

YOUR GOAL:
Provide warm, professional, helpful assistance. Answer questions regarding services, pricing, appointments, opening hours, or general inquiries.

RULES FOR MESSAGING APPS (${channelDisplay}):
1. Keep replies conversational, helpful, and concise (1 to 3 short paragraphs or clear bullet points).
2. Emojis are encouraged and natural for ${channelDisplay}.
3. NO markdown headers (#), HTML tags, or excessive formatting. Plain clean text with simple bullet points (- or •) is best.
4. If you have knowledge context, use it accurately:
"""
${contextText}
"""
5. If the customer wants to book, guide them to provide their preferred date, time, and service or visit the booking link.
`;

  let replyText = `Hi ${senderName}! Thanks for reaching out to ${botName}. How can I help you today? 😊`;

  try {
    const { text: aiResponse } = await generateText({
      model: google('gemini-flash-latest'),
      system: systemInstruction,
      prompt: `Recent Chat History:\n${historyPrompt}\n\nLatest Customer Message: ${incomingText}`,
    });

    if (aiResponse) {
      replyText = aiResponse.trim();
    }
  } catch (llmErr: any) {
    console.error('[Meta Webhook] Gemini generation error:', llmErr.message);
  }

  // 7. Save Assistant Reply to Supabase
  if (conversationId && tenantId) {
    await supabaseAdmin.from('messages').insert({
      conversation_id: conversationId,
      tenant_id: tenantId,
      sender_type: 'bot',
      text_content: replyText,
    });
  }

  // 8. Dispatch Outbound Reply to Meta Graph API
  if (metaAccessToken) {
    if (channel === 'whatsapp') {
      const targetPhoneId = phoneNumberId || chatbot?.whatsapp_phone_number_id || process.env.META_WHATSAPP_PHONE_NUMBER_ID;
      if (targetPhoneId) {
        await sendWhatsAppMessage({
          phoneNumberId: targetPhoneId,
          to: senderId,
          text: replyText,
          accessToken: metaAccessToken,
        });
      } else {
        console.warn('[Meta Webhook] No target WhatsApp Phone Number ID available for dispatch');
      }
    } else if (channel === 'messenger') {
      await sendMessengerMessage({
        recipientId: senderId,
        text: replyText,
        accessToken: metaAccessToken,
        pageId: recipientId,
      });
    } else if (channel === 'instagram') {
      await sendInstagramMessage({
        recipientId: senderId,
        text: replyText,
        accessToken: metaAccessToken,
        igAccountId: recipientId,
      });
    }
  } else {
    console.warn(
      `[Meta Webhook] No Meta Access Token configured for tenant ${tenantId}. Message saved to DB but outbound dispatch skipped.`
    );
  }

  return { success: true, replyText };
}
