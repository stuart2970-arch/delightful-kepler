import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateText, embed } from 'ai';
import { google } from '@ai-sdk/google';
import twilio from 'twilio';
import { sendConsolidatedLeadEmail } from '@/lib/lead-notifier';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://tkoasyjvrgaglofpzduq.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase environment variables are missing');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Format string response as valid TwiML XML for Twilio Inbound Webhook
 */
function twimlResponse(messageText: string) {
  const cleanText = messageText.replace(/[*#`_-]/g, '').trim();
  const VoiceResponse = twilio.twiml.MessagingResponse;
  const twiml = new VoiceResponse();
  twiml.message(cleanText);

  return new NextResponse(twiml.toString(), {
    status: 200,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
    },
  });
}

/**
 * Safely insert message supporting both database schema versions
 * (sender_type/text_content vs sender_role/content)
 */
async function insertMessage(supabaseAdmin: any, payload: { conversation_id: string; tenant_id: string; role: 'user' | 'assistant'; text: string }) {
  const { conversation_id, tenant_id, role, text } = payload;

  const insertData: Record<string, any> = {
    conversation_id,
    tenant_id,
    sender_type: role,
    text_content: text,
    sender_role: role,
    content: text,
  };

  try {
    // Primary attempt: sender_type & text_content
    const { error: err1 } = await supabaseAdmin.from('messages').insert({
      conversation_id,
      tenant_id,
      sender_type: role,
      text_content: text,
    });

    if (!err1) return;

    // Secondary fallback: sender_role & content
    await supabaseAdmin.from('messages').insert({
      conversation_id,
      tenant_id,
      sender_role: role,
      content: text,
    });
  } catch (err: any) {
    console.warn('[Twilio SMS] Message insert non-fatal warning:', err?.message);
  }
}

export async function POST(request: NextRequest) {
  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  try {
    // 1. Parse Twilio form-encoded payload (application/x-www-form-urlencoded)
    const formData = await request.formData();
    const fromNumber = (formData.get('From') as string) || '';
    const toNumber = (formData.get('To') as string) || '';
    const messageBody = (formData.get('Body') as string) || '';

    if (!fromNumber || !messageBody) {
      console.warn('[Twilio SMS Webhook] Missing From or Body parameter');
      return twimlResponse('Thank you for reaching out. Please send a valid text message.');
    }

    console.log(`[Twilio SMS Webhook] Inbound SMS from ${fromNumber} to ${toNumber}: "${messageBody}"`);

    const supabaseAdmin = getSupabaseAdmin();

    // 2. Resolve target Tenant and Chatbot
    // Clean raw digits for resilient matching
    const digitsTo = toNumber.replace(/[^\d]/g, '');
    let tenant: any = null;
    let chatbot: any = null;

    if (digitsTo) {
      // Find matching tenant by twilio_mobile_number, twilio_shadow_number, or trading_address_phone
      const { data: matchedTenants } = await supabaseAdmin
        .from('tenants')
        .select('*');

      if (matchedTenants && matchedTenants.length > 0) {
        tenant = matchedTenants.find((t: any) => {
          const mob = (t.twilio_mobile_number || '').replace(/[^\d]/g, '');
          const shad = (t.twilio_shadow_number || '').replace(/[^\d]/g, '');
          const trad = (t.trading_address_phone || '').replace(/[^\d]/g, '');
          return (mob && digitsTo.endsWith(mob)) || (shad && digitsTo.endsWith(shad)) || (trad && digitsTo.endsWith(trad)) || mob === digitsTo || shad === digitsTo;
        });
      }
    }

    // If tenant found, load its active chatbot
    if (tenant) {
      const { data: tenantBot } = await supabaseAdmin
        .from('chatbots')
        .select('*')
        .eq('tenant_id', tenant.id)
        .neq('id', '00000000-0000-0000-0000-000000000000')
        .limit(1)
        .maybeSingle();

      if (tenantBot) chatbot = tenantBot;
    }

    // Fallback: Pick primary active business chatbot if exact number matching didn't yield a result
    if (!chatbot) {
      const { data: fallbackBot } = await supabaseAdmin
        .from('chatbots')
        .select('*, tenant:tenants(*)')
        .neq('id', '00000000-0000-0000-0000-000000000000')
        .limit(1)
        .maybeSingle();

      if (fallbackBot) {
        chatbot = fallbackBot;
        if (!tenant) tenant = fallbackBot.tenant;
      }
    }

    if (!chatbot || !tenant) {
      return twimlResponse('Thank you for contacting us. This number is currently initializing. Please try again shortly.');
    }

    const tenantId = tenant.id;
    const chatbotId = chatbot.id;
    const botName = chatbot.name || tenant.company_name || 'StyleFlo Assistant';
    const sessionKey = `twilio_sms_${fromNumber.replace(/[^\d+]/g, '')}`;

    // 3. Resolve or Create Conversation session
    let { data: conversation } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .eq('chatbot_id', chatbotId)
      .eq('tenant_id', tenantId)
      .eq('user_session_id', sessionKey)
      .maybeSingle();

    if (!conversation) {
      const { data: newConv, error: createError } = await supabaseAdmin
        .from('conversations')
        .insert({
          chatbot_id: chatbotId,
          tenant_id: tenantId,
          user_session_id: sessionKey,
        })
        .select()
        .single();

      if (createError) throw createError;
      conversation = newConv;
    }

    // Save Customer's Incoming Message
    await insertMessage(supabaseAdmin, {
      conversation_id: conversation.id,
      tenant_id: tenantId,
      role: 'user',
      text: messageBody,
    });

    // 4. Semantic Vector RAG Search using Gemini Embedding
    let contextText = '';
    try {
      const { embedding } = await embed({
        model: google.textEmbeddingModel('gemini-embedding-001'),
        value: messageBody,
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
    } catch (embedErr: any) {
      console.warn('[Twilio SMS Webhook] RAG search fallback:', embedErr?.message || embedErr);
      const { data: fallbackChunks } = await supabaseAdmin
        .from('document_chunks')
        .select('content')
        .eq('chatbot_id', chatbotId)
        .limit(4);

      if (fallbackChunks) {
        contextText = fallbackChunks.map((c: any) => c.content).join('\n');
      }
    }

    // Load Last 10 conversation messages for historical context
    const { data: history } = await supabaseAdmin
      .from('messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const historyPrompt = history
      ? history
          .slice()
          .reverse()
          .map((h: any) => {
            const role = (h.sender_type || h.sender_role) === 'user' ? 'Customer' : 'Assistant';
            const text = h.text_content || h.content || '';
            return `${role}: ${text}`;
          })
          .join('\n')
      : '';

    // 5. Invoke Gemini LLM with plain text SMS constraints
    const systemInstruction = `
You are the official AI Assistant for ${botName}.
You are responding via direct 2-way SMS text message to a customer (${fromNumber}).
Assist customers with appointment scheduling, service questions, staff information, and booking support.

STRICT SMS FORMATTING RULES:
1. Speak in plain text ONLY.
2. DO NOT use markdown, asterisks for bolding, bullet points, hashtags, backticks, or special characters. They will break SMS message delivery.
3. Keep responses highly concise, helpful, and under 160 words when possible.
4. Strictly answer using ONLY this business context:
"${contextText}"
5. If you do not know the answer based on the context, politely state that you cannot locate that information.
`;

    let cleanAiResponse = `Hi! Thanks for contacting ${botName}. How can we help you today?`;

    try {
      const { text: aiResponse } = await generateText({
        model: google('gemini-3.6-flash'),
        system: systemInstruction,
        prompt: `Conversation History:\n${historyPrompt}\n\nCustomer SMS: ${messageBody}`,
      });

      if (aiResponse) {
        cleanAiResponse = aiResponse.replace(/[*#`_-]/g, '').trim();
      }
    } catch (llmErr: any) {
      console.error('[Twilio SMS Webhook] Gemini generation error:', llmErr?.message || llmErr);
    }

    // Log Assistant Response to Supabase DB
    await insertMessage(supabaseAdmin, {
      conversation_id: conversation.id,
      tenant_id: tenantId,
      role: 'assistant',
      text: cleanAiResponse,
    });

    // Send Consolidated Lead Email Notification if customer shared contact details
    const emailMatch = messageBody.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i);
    const phoneMatch = messageBody.match(/(?:(?:\+|00)\d{1,3}[\s-]*)?(?:0|\(\d+\))?[\s-]*\d{3,4}[\s-]*\d{3,4,5}/);
    if (emailMatch || phoneMatch) {
      try {
        await sendConsolidatedLeadEmail({
          tenantId,
          chatbotId,
          conversationId: conversation.id,
          newContactInfo: messageBody,
          channelType: 'chat',
        });
      } catch (leadErr) {
        console.error('[Twilio SMS Webhook] Lead notification error:', leadErr);
      }
    }

    // 6. Return TwiML XML Response directly to Twilio
    return twimlResponse(cleanAiResponse);
  } catch (error: any) {
    console.error('Twilio SMS Webhook Error:', error);
    return twimlResponse('Thank you for contacting us. We have received your message and will get back to you shortly.');
  }
}
