import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateText, embed } from 'ai';
import { google } from '@ai-sdk/google';
import {
  DEFAULT_META_VERIFY_TOKEN,
  sendWhatsAppMessage,
  sendWhatsAppTemplateMessage,
  markWhatsAppMessageAsRead,
  sendMessengerMessage,
  sendInstagramMessage,
  validateMetaSignature,
} from '@/lib/meta';
import { decryptToken } from '@/lib/crypto';

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

  console.log(`[Meta Webhook Handshake] mode: "${mode}"`);

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

    // Strict HMAC signature check if signature header is provided
    const appSecret = process.env.META_APP_SECRET || 'test_meta_app_secret_123';
    if (signature) {
      const isValid = validateMetaSignature(rawBody, signature, appSecret);
      if (!isValid) {
        console.warn('[Meta Webhook] Signature validation failed');
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
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
            // Handle quality & account updates
            if (change.field === 'phone_number_quality_update' && change.value) {
              const qualityVal = change.value;
              const phoneId = qualityVal.phone_number_id;
              const quality = qualityVal.event || qualityVal.current_limit;
              if (phoneId && quality) {
                await supabaseAdmin
                  .from('whatsapp_accounts')
                  .update({ quality_rating: quality, updated_at: new Date().toISOString() })
                  .eq('phone_number_id', phoneId);
              }
            }

            if (change.field === 'messages' && change.value) {
              const value = change.value;

              // A. Process message delivery/read/failure statuses
              if (value.statuses && Array.isArray(value.statuses)) {
                for (const st of value.statuses) {
                  const waMsgId = st.id;
                  const statusStr = st.status; // 'sent', 'delivered', 'read', 'failed'
                  const pricingCategory = st.pricing?.category || null;
                  const isBillable = typeof st.pricing?.billable === 'boolean' ? st.pricing.billable : null;
                  const errorObj = st.errors ? st.errors : null;

                  try {
                    const { data: updatedMsg } = await supabaseAdmin
                      .from('whatsapp_messages')
                      .update({
                        status: statusStr,
                        pricing_category: pricingCategory,
                        billable: isBillable,
                        error_details: errorObj,
                      })
                      .eq('wa_message_id', waMsgId)
                      .select('tenant_id')
                      .maybeSingle();

                    const tenantId = updatedMsg?.tenant_id;
                    if (tenantId && pricingCategory) {
                      const today = new Date().toISOString().split('T')[0];
                      const { data: existingUsage } = await supabaseAdmin
                        .from('whatsapp_usage_daily')
                        .select('id, by_category, outbound')
                        .eq('tenant_id', tenantId)
                        .eq('date', today)
                        .maybeSingle();

                      const currentCat = existingUsage?.by_category || {
                        service: 0,
                        utility: 0,
                        marketing: 0,
                        authentication: 0,
                      };
                      currentCat[pricingCategory] = (currentCat[pricingCategory] || 0) + 1;

                      await supabaseAdmin.from('whatsapp_usage_daily').upsert(
                        {
                          tenant_id: tenantId,
                          date: today,
                          outbound: (existingUsage?.outbound || 0) + 1,
                          by_category: currentCat,
                          updated_at: new Date().toISOString(),
                        },
                        { onConflict: 'tenant_id,date' }
                      );
                    }
                  } catch (statusErr) {
                    console.warn('[Meta Webhook] Status update warning:', statusErr);
                  }
                }

                if (!value.messages) {
                  return NextResponse.json({ status: 'statuses_processed' }, { status: 200 });
                }
              }

              // B. Process Inbound Messages
              if (value.messages && Array.isArray(value.messages)) {
                for (const msg of value.messages) {
                  const phoneNumberId = value.metadata?.phone_number_id;
                  const displayPhone = value.metadata?.display_phone_number;
                  const senderPhone = msg.from; // Customer's phone number
                  const messageId = msg.id;
                  const contactName = value.contacts?.[0]?.profile?.name || 'Customer';

                  // 1. Deduplication / Idempotency check
                  if (messageId) {
                    const { data: existingMsg } = await supabaseAdmin
                      .from('whatsapp_messages')
                      .select('id')
                      .eq('wa_message_id', messageId)
                      .maybeSingle();

                    if (existingMsg) {
                      console.log(`[Meta Webhook] Duplicate WhatsApp message ${messageId} ignored.`);
                      continue;
                    }
                  }

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

                  // 2. Resolve Tenant Account from whatsapp_accounts
                  let waTenantId: string | undefined;
                  let waDecryptedToken: string | undefined;

                  if (phoneNumberId) {
                    const { data: waAccount } = await supabaseAdmin
                      .from('whatsapp_accounts')
                      .select('tenant_id, business_token_enc')
                      .eq('phone_number_id', phoneNumberId)
                      .maybeSingle();

                    if (waAccount) {
                      waTenantId = waAccount.tenant_id;
                      if (waAccount.business_token_enc) {
                        try {
                          waDecryptedToken = decryptToken(waAccount.business_token_enc);
                        } catch (tokErr) {
                          console.warn('[Meta Webhook] Token decrypt error:', tokErr);
                        }
                      }
                    }
                  }

                  // 3. Upsert whatsapp_contacts & track 24h customer service window
                  let contactId: string | null = null;
                  let isOptedOut = false;

                  if (waTenantId) {
                    try {
                      const { data: contact } = await supabaseAdmin
                        .from('whatsapp_contacts')
                        .upsert(
                          {
                            tenant_id: waTenantId,
                            wa_id: senderPhone,
                            profile_name: contactName,
                            last_inbound_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                          },
                          { onConflict: 'tenant_id,wa_id' }
                        )
                        .select('id, opted_out')
                        .single();

                      if (contact) {
                        contactId = contact.id;
                        isOptedOut = Boolean(contact.opted_out);
                      }
                    } catch (cErr) {
                      console.warn('[Meta Webhook] Contact upsert error:', cErr);
                    }
                  }

                  // 4. Opt-Out (STOP / UNSUBSCRIBE) & Opt-In (START) Handling
                  const normalizedText = incomingText.trim().toUpperCase();
                  if (
                    normalizedText === 'STOP' ||
                    normalizedText === 'UNSUBSCRIBE' ||
                    normalizedText === 'CANCEL' ||
                    normalizedText === 'QUIT'
                  ) {
                    if (waTenantId && contactId) {
                      await supabaseAdmin
                        .from('whatsapp_contacts')
                        .update({ opted_out: true, opted_out_at: new Date().toISOString() })
                        .eq('id', contactId);
                    }

                    // Record inbound message
                    await recordInboundWhatsAppMessage(supabaseAdmin, waTenantId, contactId, messageId, incomingText);

                    // Acknowledge opt-out via WhatsApp
                    const dispatchToken = waDecryptedToken || process.env.META_ACCESS_TOKEN;
                    if (dispatchToken && phoneNumberId) {
                      await sendWhatsAppMessage({
                        phoneNumberId,
                        to: senderPhone,
                        text: 'You have been unsubscribed from automated messages. Reply START to resubscribe.',
                        accessToken: dispatchToken,
                      });
                    }
                    continue;
                  }

                  if (normalizedText === 'START') {
                    if (waTenantId && contactId) {
                      await supabaseAdmin
                        .from('whatsapp_contacts')
                        .update({ opted_out: false, opted_out_at: null })
                        .eq('id', contactId);
                    }

                    await recordInboundWhatsAppMessage(supabaseAdmin, waTenantId, contactId, messageId, incomingText);

                    const dispatchToken = waDecryptedToken || process.env.META_ACCESS_TOKEN;
                    if (dispatchToken && phoneNumberId) {
                      await sendWhatsAppMessage({
                        phoneNumberId,
                        to: senderPhone,
                        text: 'Welcome back! You have resubscribed to messages. How can we help you today? 😊',
                        accessToken: dispatchToken,
                      });
                    }
                    continue;
                  }

                  // If user is opted out, do not dispatch automated AI response
                  if (isOptedOut) {
                    console.log(`[Meta Webhook] User ${senderPhone} has opted out. Skipping response.`);
                    await recordInboundWhatsAppMessage(supabaseAdmin, waTenantId, contactId, messageId, incomingText);
                    continue;
                  }

                  // Record inbound message in whatsapp_messages & increment daily usage
                  await recordInboundWhatsAppMessage(supabaseAdmin, waTenantId, contactId, messageId, incomingText);

                  // 5. Route to Conversational Journey
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
                    waTenantId,
                    waDecryptedToken,
                    contactId,
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
 * Records an inbound WhatsApp message in the whatsapp_messages table and updates daily usage.
 */
async function recordInboundWhatsAppMessage(
  supabaseAdmin: any,
  tenantId?: string,
  contactId?: string | null,
  messageId?: string,
  incomingText?: string
) {
  if (!tenantId || !messageId) return;
  try {
    await supabaseAdmin.from('whatsapp_messages').insert({
      tenant_id: tenantId,
      contact_id: contactId || null,
      wa_message_id: messageId,
      direction: 'inbound',
      type: 'text',
      status: 'received',
      body: incomingText,
    });

    const today = new Date().toISOString().split('T')[0];
    const { data: usage } = await supabaseAdmin
      .from('whatsapp_usage_daily')
      .select('id, inbound')
      .eq('tenant_id', tenantId)
      .eq('date', today)
      .maybeSingle();

    await supabaseAdmin.from('whatsapp_usage_daily').upsert(
      {
        tenant_id: tenantId,
        date: today,
        inbound: (usage?.inbound || 0) + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,date' }
    );
  } catch (err) {
    console.warn('[Meta Webhook] Inbound message record warning:', err);
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
  waTenantId?: string;
  waDecryptedToken?: string;
  contactId?: string | null;
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
    waTenantId,
    waDecryptedToken,
    contactId,
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

  // Resolve Meta Access Token (whatsapp_accounts decrypted token -> chatbot override -> tenant override -> environment variable)
  const metaAccessToken =
    waDecryptedToken ||
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
        const sendResult = await sendWhatsAppMessage({
          phoneNumberId: targetPhoneId,
          to: senderId,
          text: replyText,
          accessToken: metaAccessToken,
        });

        // Record outbound message in whatsapp_messages & increment daily usage
        if (sendResult.success && sendResult.data?.messages?.[0]?.id) {
          const outboundMsgId = sendResult.data.messages[0].id;
          const resolvedTenantId = waTenantId || tenantId;
          if (resolvedTenantId) {
            try {
              await supabaseAdmin.from('whatsapp_messages').insert({
                tenant_id: resolvedTenantId,
                contact_id: contactId || null,
                wa_message_id: outboundMsgId,
                direction: 'outbound',
                type: 'text',
                status: 'sent',
                body: replyText,
                pricing_category: 'service',
                billable: false,
              });

              const today = new Date().toISOString().split('T')[0];
              const { data: usage } = await supabaseAdmin
                .from('whatsapp_usage_daily')
                .select('id, outbound')
                .eq('tenant_id', resolvedTenantId)
                .eq('date', today)
                .maybeSingle();

              await supabaseAdmin.from('whatsapp_usage_daily').upsert(
                {
                  tenant_id: resolvedTenantId,
                  date: today,
                  outbound: (usage?.outbound || 0) + 1,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: 'tenant_id,date' }
              );
            } catch (err) {
              console.warn('[Meta Webhook] Outbound usage record error:', err);
            }
          }
        }
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
