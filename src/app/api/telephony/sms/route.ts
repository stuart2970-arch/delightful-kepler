import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateText, embed } from 'ai';
import { google } from '@ai-sdk/google';
import twilio from 'twilio';

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

function createTwimlSmsResponse(text: string): NextResponse {
  const VoiceResponse = twilio.twiml.MessagingResponse;
  const twiml = new VoiceResponse();
  twiml.message(text);

  return new NextResponse(twiml.toString(), {
    status: 200,
    headers: {
      'Content-Type': 'text/xml',
    },
  });
}

export async function POST(request: NextRequest) {
  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const formData = await request.formData();
    const from = (formData.get('From') as string) || '';
    const to = (formData.get('To') as string) || '';
    const body = (formData.get('Body') as string) || '';

    if (!to || !body) {
      console.warn('[Telephony SMS] Inbound SMS missing required To or Body');
      return createTwimlSmsResponse('Message received.');
    }

    console.log(`[Telephony SMS] Inbound text from ${from} to ${to}: "${body}"`);

    // 1. Locate the tenant associated with this mobile/landline number
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('id, company_name')
      .or(`twilio_mobile_number.eq.${to},twilio_shadow_number.eq.${to}`)
      .limit(1)
      .maybeSingle();

    if (tenantError || !tenant) {
      console.warn(`[Telephony SMS] No tenant associated with number: ${to}`);
      return createTwimlSmsResponse('Thank you for your message. This number is not currently linked to an active business.');
    }

    const tenantId = tenant.id;

    // 2. Fetch the tenant's primary chatbot configuration
    const { data: chatbot } = await supabaseAdmin
      .from('chatbots')
      .select('*')
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle();

    const chatbotId = chatbot?.id;
    const botName = chatbot?.name || tenant.company_name || 'StyleFlo Assistant';

    // 3. Resolve or create the conversation session in Supabase
    const sessionKey = `styleflo_sms_${from}`;
    let conversationId: string | null = null;

    if (chatbotId) {
      const { data: existingConv } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('chatbot_id', chatbotId)
        .eq('tenant_id', tenantId)
        .eq('user_session_id', sessionKey)
        .maybeSingle();

      if (existingConv) {
        conversationId = existingConv.id;
      } else {
        const { data: newConv } = await supabaseAdmin
          .from('conversations')
          .insert({
            chatbot_id: chatbotId,
            tenant_id: tenantId,
            user_session_id: sessionKey,
          })
          .select('id')
          .single();

        if (newConv) {
          conversationId = newConv.id;
        }
      }

      // Record incoming customer SMS
      if (conversationId) {
        await supabaseAdmin.from('messages').insert({
          conversation_id: conversationId,
          tenant_id: tenantId,
          sender_type: 'user',
          text_content: body,
        });
      }
    }

    // 4. Retrieve RAG context if chatbot exists
    let contextText = '';
    if (chatbotId) {
      try {
        const { embedding } = await embed({
          model: google.textEmbeddingModel('text-embedding-004'),
          value: body,
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
        console.warn('[Telephony SMS] RAG embedding fallback:', err.message);
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

    // 5. Fetch recent message history for conversational continuity
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

    // 6. Generate concise SMS response with Gemini
    const systemInstruction = `
You are the official AI SMS Assistant for ${botName}.
You are communicating with a customer via SMS text messaging.
Keep responses concise, friendly, and under 160 characters when possible (max 2 sentences).

CRITICAL RULES:
1. Use plain text ONLY. Absolutely NO markdown, asterisks, bullet points, hashtags, or formatting.
2. If business context is available, use it:
"${contextText}"
3. Help with appointments, inquiries, opening hours, or booking.
`;

    let replyText = `Hi! Thanks for contacting ${botName}. How can we help you today?`;

    try {
      const { text: aiResponse } = await generateText({
        model: google('gemini-flash-latest'),
        system: systemInstruction,
        prompt: `Conversation History:\n${historyPrompt}\n\nCustomer Text: ${body}`,
      });

      if (aiResponse) {
        replyText = aiResponse.replace(/[*#`_~]/g, '').trim();
      }
    } catch (llmErr: any) {
      console.error('[Telephony SMS] Gemini generation error:', llmErr.message);
    }

    // Record outbound Assistant SMS
    if (conversationId) {
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversationId,
        tenant_id: tenantId,
        sender_type: 'assistant',
        text_content: replyText,
      });
    }

    // Return TwiML Messaging XML
    return createTwimlSmsResponse(replyText);

  } catch (error: any) {
    console.error('[Telephony SMS API] Unexpected error:', error);
    return createTwimlSmsResponse('Thank you for contacting us. We have received your message and will get back to you shortly.');
  }
}
