import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateText, embed } from 'ai';
import { google } from '@ai-sdk/google';
import twilio from 'twilio';
import { sendConsolidatedLeadEmail } from '@/lib/lead-notifier';
import { getActiveGeminiModel } from '@/lib/gemini-config';

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
 * Insert message strictly matching Supabase messages table schema (sender_type IN ('user', 'bot') and text_content)
 */
async function insertMessage(supabaseAdmin: any, payload: { conversation_id: string; tenant_id: string; role: 'user' | 'assistant'; text: string }) {
  const { conversation_id, tenant_id, role, text } = payload;
  const senderType = role === 'user' ? 'user' : 'bot';

  try {
    const { error } = await supabaseAdmin.from('messages').insert({
      conversation_id,
      tenant_id,
      sender_type: senderType,
      text_content: text,
    });

    if (error) {
      console.error('[Twilio SMS] Message insert error:', error.message);
    }
  } catch (err: any) {
    console.warn('[Twilio SMS] Message insert non-fatal exception:', err?.message);
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  try {
    // 1. Parse Twilio payload (searchParams, formData, or raw URLSearchParams)
    let fromNumber = '';
    let toNumber = '';
    let messageBody = '';

    const { searchParams } = new URL(request.url);
    fromNumber = searchParams.get('From') || searchParams.get('from') || '';
    toNumber = searchParams.get('To') || searchParams.get('to') || '';
    messageBody = searchParams.get('Body') || searchParams.get('body') || '';

    if (!fromNumber || !messageBody) {
      try {
        const formData = await request.formData();
        fromNumber = (formData.get('From') as string) || (formData.get('from') as string) || fromNumber;
        toNumber = (formData.get('To') as string) || (formData.get('to') as string) || toNumber;
        messageBody = (formData.get('Body') as string) || (formData.get('body') as string) || messageBody;
      } catch (e1) {
        try {
          const bodyText = await request.text();
          const parsed = new URLSearchParams(bodyText);
          fromNumber = parsed.get('From') || parsed.get('from') || fromNumber;
          toNumber = parsed.get('To') || parsed.get('to') || toNumber;
          messageBody = parsed.get('Body') || parsed.get('body') || messageBody;
        } catch (e2) {
          // ignore parsing error
        }
      }
    }

    if (!fromNumber || !messageBody) {
      console.warn('[Twilio SMS Webhook] Missing From or Body parameter');
      return twimlResponse('Thank you for reaching out. Please send a valid text message.');
    }

    console.log(`[Twilio SMS Webhook] Inbound SMS from ${fromNumber} to ${toNumber}: "${messageBody}"`);

    const supabaseAdmin = getSupabaseAdmin();

    // 2. Resolve target Tenant and Chatbot
    const digitsTo = toNumber.replace(/[^\d]/g, '');
    let tenant: any = null;
    let chatbot: any = null;

    if (digitsTo) {
      const { data: matchedTenants } = await supabaseAdmin
        .from('tenants')
        .select('*');

      if (matchedTenants && matchedTenants.length > 0) {
        tenant = matchedTenants.find((t: any) => {
          const mob = (t.twilio_mobile_number || '').replace(/[^\d]/g, '');
          const shad = (t.twilio_shadow_number || '').replace(/[^\d]/g, '');
          const trad = (t.trading_address_phone || '').replace(/[^\d]/g, '');
          
          const tailTo = digitsTo.slice(-9);
          if (!tailTo) return false;

          return (mob && mob.endsWith(tailTo)) || 
                 (shad && shad.endsWith(tailTo)) || 
                 (trad && trad.endsWith(tailTo));
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
        .select('*')
        .neq('id', '00000000-0000-0000-0000-000000000000')
        .limit(1)
        .maybeSingle();

      if (fallbackBot) {
        chatbot = fallbackBot;
        if (!tenant) {
          const { data: fallbackTenant } = await supabaseAdmin
            .from('tenants')
            .select('*')
            .eq('id', fallbackBot.tenant_id)
            .maybeSingle();
          tenant = fallbackTenant;
        }
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

    // 4. Fetch Services, Staff, and Semantic Vector RAG Search
    const [servicesRes, staffRes] = await Promise.all([
      supabaseAdmin
        .from('services')
        .select('name, description, duration_minutes, price')
        .eq('tenant_id', tenantId),
      supabaseAdmin
        .from('staff')
        .select('name, bio')
        .eq('tenant_id', tenantId),
    ]);

    let servicesText = '';
    if (servicesRes.data && servicesRes.data.length > 0) {
      servicesText = servicesRes.data
        .map((s: any) => `- ${s.name}: ${s.description || 'Service available'} (${s.duration_minutes || 30} mins, £${s.price || 0})`)
        .join('\n');
    }

    let staffText = '';
    if (staffRes.data && staffRes.data.length > 0) {
      staffText = staffRes.data
        .map((st: any) => `- ${st.name}${st.bio ? `: ${st.bio}` : ''}`)
        .join('\n');
    }

    let docChunksText = '';
    try {
      const { embedding } = await embed({
        model: google.textEmbeddingModel('gemini-embedding-001'),
        value: messageBody,
      });

      const { data: chunks } = await supabaseAdmin.rpc('match_documents', {
        query_embedding: embedding,
        match_threshold: 0.25,
        match_count: 6,
        targeting_tenant_id: tenantId,
        targeting_chatbot_id: chatbotId,
      });

      if (chunks && chunks.length > 0) {
        docChunksText = chunks.map((c: any) => c.content).join('\n');
      }
    } catch (embedErr: any) {
      console.warn('[Twilio SMS Webhook] RAG search fallback:', embedErr?.message || embedErr);
      const { data: fallbackChunks } = await supabaseAdmin
        .from('document_chunks')
        .select('content')
        .eq('chatbot_id', chatbotId)
        .limit(6);

      if (fallbackChunks) {
        docChunksText = fallbackChunks.map((c: any) => c.content).join('\n');
      }
    }

    const contextText = `
SERVICES & PRICING:
${servicesText || 'No specific services table entries.'}

STAFF / TEAM MEMBERS:
${staffText || 'No specific staff table entries.'}

ADDITIONAL KNOWLEDGE BASE CONTENT:
${docChunksText || 'No additional file chunks.'}
`.trim();

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
      const activeModel = await getActiveGeminiModel().catch(() => 'gemini-3.6-flash');
      const { text: aiResponse } = await generateText({
        model: google(activeModel),
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
