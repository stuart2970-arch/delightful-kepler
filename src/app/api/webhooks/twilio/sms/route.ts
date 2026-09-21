import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateText, embed } from 'ai';
import { google } from '@ai-sdk/google';
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
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>${cleanText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message>
</Response>`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
    },
  });
}

export async function POST(request: NextRequest) {
  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  try {
    // 1. Parse Twilio form-encoded payload (application/x-www-form-urlencoded)
    const formData = await request.formData();
    const fromNumber = formData.get('From')?.toString() || '';
    const toNumber = formData.get('To')?.toString() || '';
    const messageBody = formData.get('Body')?.toString() || '';

    if (!fromNumber || !messageBody) {
      return twimlResponse('Thank you for reaching out. Please send a valid text message.');
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 2. Resolve target Chatbot and Tenant boundary
    // Match To number against chatbots.sms_phone_number or tenant twilio numbers
    let chatbot: any = null;

    if (toNumber) {
      const { data: matchedBot } = await supabaseAdmin
        .from('chatbots')
        .select('*, tenant:tenants(*)')
        .eq('sms_phone_number', toNumber)
        .maybeSingle();

      if (matchedBot) {
        chatbot = matchedBot;
      } else {
        // Match against tenants table
        const { data: matchedTenant } = await supabaseAdmin
          .from('tenants')
          .select('id')
          .or(`twilio_shadow_number.eq.${toNumber},twilio_mobile_number.eq.${toNumber},trading_address_phone.eq.${toNumber}`)
          .maybeSingle();

        if (matchedTenant) {
          const { data: tenantBot } = await supabaseAdmin
            .from('chatbots')
            .select('*, tenant:tenants(*)')
            .eq('tenant_id', matchedTenant.id)
            .limit(1)
            .maybeSingle();

          if (tenantBot) chatbot = tenantBot;
        }
      }
    }

    // Fallback: Pick the first available active chatbot if exact number match fails
    if (!chatbot) {
      const { data: fallbackBot } = await supabaseAdmin
        .from('chatbots')
        .select('*, tenant:tenants(*)')
        .limit(1)
        .single();

      if (!fallbackBot) {
        return twimlResponse('Hello! Our messaging service is currently initializing. Please try again shortly.');
      }
      chatbot = fallbackBot;
    }

    const tenantId = chatbot.tenant_id;
    const chatbotId = chatbot.id;
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
    await supabaseAdmin.from('messages').insert({
      conversation_id: conversation.id,
      tenant_id: tenantId,
      sender_role: 'user',
      content: messageBody,
    });

    // 4. Semantic Vector RAG Search using Gemini Embedding
    let contextText = '';
    try {
      const { embedding } = await embed({
        model: google.textEmbeddingModel('text-embedding-004'),
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
    } catch (embedErr) {
      console.warn('[Twilio SMS Webhook] Embedding search fallback:', embedErr);
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
      .select('sender_role, content')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const historyPrompt = history
      ? history
          .slice()
          .reverse()
          .map((h: any) => `${h.sender_role === 'user' ? 'Customer' : 'Assistant'}: ${h.content}`)
          .join('\n')
      : '';

    // 5. Invoke Gemini LLM with plain text SMS constraints
    const systemInstruction = `
You are the official AI Assistant for ${chatbot.name || 'our business'}.
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

    const { text: aiResponse } = await generateText({
      model: google('gemini-3.6-flash'),
      system: systemInstruction,
      prompt: `Conversation History:\n${historyPrompt}\n\nCustomer SMS: ${messageBody}`,
    });

    const cleanAiResponse = aiResponse.replace(/[*#`_-]/g, '').trim();

    // Log Assistant Response to Supabase DB
    await supabaseAdmin.from('messages').insert({
      conversation_id: conversation.id,
      tenant_id: tenantId,
      sender_role: 'assistant',
      content: cleanAiResponse,
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
    return twimlResponse('Sorry, we encountered a temporary issue processing your message. Please try again shortly.');
  }
}
