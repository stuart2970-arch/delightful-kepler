import { verifyChatSessionToken, checkRateLimit, type ChatSessionPayload } from '@/lib/chat-session';
import { logMeteredUsage, checkFeatureEntitlement } from '@/lib/entitlements';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { streamText, embed, tool } from 'ai';
import { createGoogleGenerativeAI, google } from '@ai-sdk/google';
import { z } from 'zod';
import formData from 'form-data';
import * as cheerio from 'cheerio';
import {
  getAvailabilityData,
  bookMeeting,
  lookupAppointments,
} from './calendar';
import { calendarFallbackMessage, directAvailabilitySpeech } from '@/lib/calendar/fallback-message';
import {
  parseTruncatedAvailabilityTag,
  resolveByIdPrefix,
  splitAtToolTag,
  visibleLength,
} from '@/lib/calendar/tool-tags';
import {
  formatQuickDaysTag,
  formatQuickTimesTag,
  formatQuickServicesTag,
  getSlotsForDay,
  utcToLocalParts,
  stripCalendarTags,
} from '@/lib/calendar/availability';
import { sendConsolidatedLeadEmail } from '@/lib/lead-notifier';

import { getActiveGeminiModel } from '@/lib/gemini-config';
import { generateEmbedding } from '@/lib/embeddings';
import { getFirstName } from '@/lib/greeting';

async function scrapeWebsiteContent(targetUrl: string): Promise<string> {
  try {
    let fullUrl = targetUrl.trim();
    if (!/^https?:\/\//i.test(fullUrl)) {
      fullUrl = `https://${fullUrl}`;
    }
    const response = await fetch(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return '';
    const html = await response.text();
    const $ = cheerio.load(html);
    $('script, style, noscript, svg, iframe, footer, nav').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    return text.slice(0, 3500);
  } catch (err) {
    console.warn(`[FloBot] Website scrape error/timeout for ${targetUrl}:`, err);
    return '';
  }
}

async function saveScrapedWebsiteDataToTenant(params: {
  email: string;
  targetUrl: string;
  scrapedText: string;
}) {
  const { email, targetUrl, scrapedText } = params;
  if (!email || !scrapedText) return;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const cleanUrl = targetUrl.trim();

    // 1. Find or Create Tenant for User
    let { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, name, domain, trading_address_street')
      .or(`email.eq.${email},owner_email.eq.${email}`)
      .limit(1)
      .maybeSingle();

    let tenantId = tenant?.id;

    // Derive business name from URL domain
    let domainName = cleanUrl.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
    let businessName = domainName.split('.')[0];
    businessName = businessName.charAt(0).toUpperCase() + businessName.slice(1);

    // Extract address heuristic from scraped text (look for street, road, avenue, city, postcode)
    const addressMatch = scrapedText.match(/(\d+[\s\w,]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln-[#\w]+|Way|Boulevard|Blvd|Suite|Unit|Building|Floor)[\s\w,]+[A-Z]{1,2}\d[A-Z0-9]?\s?\d[A-Z]{2})/i)
      || scrapedText.match(/(?:Location|Address|Find us|Visit us)[:\s]+([^.]+?\b[A-Z]{1,2}\d[A-Z0-9]?\s?\d[A-Z]{2}\b)/i)
      || scrapedText.match(/(?:Address|Location)[:\s]+([^.\n]{10,120})/i);

    const extractedAddress = addressMatch ? addressMatch[1].trim() : '';

    if (!tenantId) {
      console.log(`[FloBot Auto-Save] Creating new tenant for ${email}...`);
      const { data: newTenant, error: createError } = await supabaseAdmin
        .from('tenants')
        .insert({
          name: `${businessName} Lounge`,
          email: email,
          owner_email: email,
          domain: cleanUrl,
          trading_address_street: extractedAddress || 'Main Street',
          business_address: extractedAddress || 'Main Street',
        })
        .select('id')
        .single();

      if (createError) {
        console.warn('[FloBot Auto-Save] Tenant creation error:', createError.message);
      } else {
        tenantId = newTenant?.id;
      }
    } else {
      console.log(`[FloBot Auto-Save] Updating existing tenant ${tenantId} with website info...`);
      await supabaseAdmin
        .from('tenants')
        .update({
          domain: cleanUrl,
          ...(extractedAddress ? { trading_address_street: extractedAddress, business_address: extractedAddress } : {}),
        })
        .eq('id', tenantId);
    }

    if (!tenantId) return;

    // 2. Ingest scraped website text into knowledge_chunks
    const textContent = scrapedText.replace(/\s+/g, ' ').trim();
    if (textContent.length > 50) {
      console.log(`[FloBot Auto-Save] Ingesting knowledge chunks for tenant ${tenantId}...`);
      
      const chunks: string[] = [];
      for (let i = 0; i < textContent.length; i += 750) {
        chunks.push(textContent.slice(i, i + 800));
      }

      const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      if (geminiApiKey) {
        const recordsToInsert: any[] = [];
        for (const chunk of chunks.slice(0, 5)) {
          try {
            const { embedding } = await embed({
              model: google.textEmbeddingModel('text-embedding-004'),
              value: chunk,
              providerOptions: { google: { outputDimensionality: 768 } },
            });
            recordsToInsert.push({
              tenant_id: tenantId,
              content: chunk,
              source_url: cleanUrl,
              metadata: { source_type: 'url_crawl', title: cleanUrl },
              embedding: embedding,
            });
          } catch (embedErr) {
            console.warn('[FloBot Auto-Save] Embedding error:', embedErr);
            recordsToInsert.push({
              tenant_id: tenantId,
              content: chunk,
              source_url: cleanUrl,
              metadata: { source_type: 'url_crawl', title: cleanUrl },
            });
          }
        }

        if (recordsToInsert.length > 0) {
          const { error: chunkErr } = await supabaseAdmin.from('knowledge_chunks').insert(recordsToInsert);
          if (chunkErr) console.warn('[FloBot Auto-Save] knowledge_chunks insert error:', chunkErr.message);
          else console.log(`[FloBot Auto-Save] Successfully saved ${recordsToInsert.length} knowledge chunks to KB!`);
        }
      }
    }

    // 3. Extract and Save Services into services table
    const { data: existingServices } = await supabaseAdmin
      .from('services')
      .select('id')
      .eq('tenant_id', tenantId)
      .limit(1);

    if (!existingServices || existingServices.length === 0) {
      console.log(`[FloBot Auto-Save] Extracting and inserting services for tenant ${tenantId}...`);
      
      const defaultServices = [
        { name: 'Initial Consultation', description: 'Comprehensive consultation and assessment', duration_minutes: 30, price: 35 },
        { name: 'Full Service & Styling', description: 'Complete personalized service and treatment', duration_minutes: 60, price: 75 },
        { name: 'Express Treatment', description: 'Quick touch-up and maintenance session', duration_minutes: 30, price: 45 },
      ];

      const servicesToInsert = defaultServices.map(s => ({
        tenant_id: tenantId,
        name: s.name,
        description: s.description,
        duration_minutes: s.duration_minutes,
        price: s.price,
      }));

      const { error: serviceErr } = await supabaseAdmin.from('services').insert(servicesToInsert);
      if (serviceErr) console.warn('[FloBot Auto-Save] Services insert error:', serviceErr.message);
      else console.log(`[FloBot Auto-Save] Successfully inserted ${servicesToInsert.length} default services!`);
    }

  } catch (err) {
    console.error('[FloBot Auto-Save] Error saving scraped website data to tenant:', err);
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-session-token, x-turnstile-token, authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

// Input validation schema
const ChatRequestSchema = z.object({
  message: z.string().min(1, { message: 'Message cannot be empty' }),
  chatbotId: z.string().min(1, { message: 'Chatbot ID cannot be empty' }),
  sessionId: z.string().min(1, { message: 'Session ID cannot be empty' }),
  clientName: z.string().optional().nullable(),
  clientEmail: z.string().optional().nullable(),
});

// Initialize Supabase Admin Client using service role key (bypasses RLS for service logic)
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  console.log(`[Chat Stream][${requestId}] Inbound chat request...`);

  // Map GEMINI_API_KEY to GOOGLE_GENERATIVE_AI_API_KEY for the @ai-sdk/google provider
  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 0. Extract & Validate Headers & Request Body
    const authHeader = request.headers.get('authorization');
    const sessionToken = request.headers.get('x-session-token');

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400, headers: corsHeaders });
    }

    const validation = ChatRequestSchema.safeParse(body);
    if (!validation.success) {
      const errorMsg = validation.error.issues.map((issue) => issue.message).join(', ');
      console.warn(`[Chat Stream][${requestId}] Validation failed: ${errorMsg}`);
      return NextResponse.json({ error: `Validation error: ${errorMsg}` }, { status: 400, headers: corsHeaders });
    }

    const { message, chatbotId, sessionId, clientName } = validation.data;

    // Cryptographic Session Verification & Claim Matching
    let sessionPayload: ChatSessionPayload | null = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
      const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
      if (userError || !userData?.user) {
        return NextResponse.json({ error: 'Unauthorized. Invalid authentication token.' }, { status: 401, headers: corsHeaders });
      }
    } else if (sessionToken) {
      const verification = verifyChatSessionToken(sessionToken);
      if (!verification.valid || !verification.payload) {
        return NextResponse.json(
          { error: `Unauthorized. ${verification.error || 'Invalid session token signature.'}` },
          { status: 401, headers: corsHeaders }
        );
      }
      if (verification.payload.chatbotId !== chatbotId || verification.payload.sessionId !== sessionId) {
        return NextResponse.json(
          { error: 'Unauthorized. Session token does not match requested chatbotId or sessionId.' },
          { status: 401, headers: corsHeaders }
        );
      }
      sessionPayload = verification.payload;
    } else {
      return NextResponse.json(
        { error: 'Unauthorized. Valid signed session token or JWT required to access chat stream.' },
        { status: 401, headers: corsHeaders }
      );
    }

    // Abuse Prevention: Message length cap (2,000 characters)
    if (message.length > 2000) {
      return NextResponse.json(
        { error: 'Message exceeds maximum length of 2,000 characters.' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Abuse Prevention: Sanitize & cap client history array (max 20 items, max 2000 chars each)
    const rawClientMessages = Array.isArray(body.messages) ? body.messages : Array.isArray(body.history) ? body.history : [];
    const clientMessages = rawClientMessages.slice(-20).map((m: any) => {
      if (typeof m === 'string') return m.slice(0, 2000);
      if (m && typeof m === 'object' && typeof m.content === 'string') {
        return { ...m, content: m.content.slice(0, 2000) };
      }
      return m;
    });

    // Abuse Prevention: Rate limits (Session, IP, Chatbot)
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';

    const sessionMin = await checkRateLimit(`rate:sess:min:${sessionId}`, 10, 60);
    if (!sessionMin.allowed) {
      return NextResponse.json(
        { error: 'Session rate limit exceeded (10 messages per minute). Please slow down.' },
        { status: 429, headers: corsHeaders }
      );
    }

    const sessionDay = await checkRateLimit(`rate:sess:day:${sessionId}`, 100, 86400);
    if (!sessionDay.allowed) {
      return NextResponse.json(
        { error: 'Daily session message limit reached (100 messages). Please try again tomorrow.' },
        { status: 429, headers: corsHeaders }
      );
    }

    const ipMin = await checkRateLimit(`rate:ip:min:${clientIp}`, 30, 60);
    if (!ipMin.allowed) {
      return NextResponse.json(
        { error: 'IP rate limit exceeded (30 messages per minute). Please slow down.' },
        { status: 429, headers: corsHeaders }
      );
    }

    const botDay = await checkRateLimit(`rate:bot:day:${chatbotId}`, 2000, 86400);
    if (!botDay.allowed) {
      return NextResponse.json(
        { error: 'Chatbot daily conversation capacity reached (2,000 messages).' },
        { status: 429, headers: corsHeaders }
      );
    }

    // 1. Check Gemini configuration
    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!geminiApiKey) {
      console.error(`[Chat Stream][${requestId}] GEMINI_API_KEY environment variable is missing`);
      return NextResponse.json({ error: 'Gemini integration misconfigured: missing API key' }, { status: 500, headers: corsHeaders });
    }

    const google = createGoogleGenerativeAI({
      apiKey: geminiApiKey,
    });

    console.log(`[Chat Stream][${requestId}] Chatbot ID: ${chatbotId}, Session ID: ${sessionId}, Client: ${clientName || 'Unknown'}`);

    // 3. Resolve tenant_id & configuration
    let tenantId = '00000000-0000-0000-0000-000000000000';
    let configData: Record<string, unknown> = {};

    let chatbotRecord: { id?: string; name?: string; tenant_id?: string; configuration_json?: any } | null = null;

    // Feature-flag to disable onboarding FloBot
    const disableOnboarding = process.env.DISABLE_ONBOARDING_BOT === 'true';
    if (disableOnboarding && chatbotId === 'styleflo-onboarding-flobot') {
      console.warn(`[Chat Stream][${requestId}] Onboarding bot is disabled via feature flag.`);
      return NextResponse.json({ error: 'Onboarding bot is disabled.' }, { status: 404, headers: corsHeaders });
    }
    if (chatbotId === 'styleflo-onboarding-flobot') {
      configData = {
        agent_name: 'Flo',
        agent_role: 'StyleFlo AI Receptionist Builder',
        welcome_message: "Hi, I'm Flo! I'm your StyleFlo AI assistant builder. Let's create your account and get your AI receptionist ready in under 60 seconds!",
        system_instruction: `You are Flo, the official AI onboarding assistant for StyleFlo.ai. 
Your goal is to guide new business owners through a fast, friendly 60-second conversational onboarding journey.
Help them specify:
1. Business/Salon Name & Location
2. Website URL / Sitemap or PDF Price List
3. Booking Operational Mode`,
      };
    } else {
      const { data: chatbot, error: chatbotError } = await supabaseAdmin
        .from('chatbots')
        .select('id, name, tenant_id, configuration_json')
        .eq('id', chatbotId)
        .single();

      if (chatbotError || !chatbot) {
        if (chatbotId === '9825855e-d478-443f-b75c-6c0d77039ca6') {
          chatbotRecord = {
            id: '9825855e-d478-443f-b75c-6c0d77039ca6',
            name: 'StyleFlo Homepage Assistant',
            tenant_id: '10000000-0000-0000-0000-000000000002',
            configuration_json: {
              require_client_name: true,
              terms_version: '1.0',
              welcome_message: "Hi, you're through to FloChat! How can I help you today?",
            },
          };
          tenantId = '10000000-0000-0000-0000-000000000002';
          configData = chatbotRecord.configuration_json;
        } else {
          console.warn(`[Chat Stream][${requestId}] Chatbot validation failed or not found:`, chatbotError);
          return NextResponse.json({ error: `Chatbot not found: ${chatbotError?.message || 'Not found'}` }, { status: 404, headers: corsHeaders });
        }
      } else {
        chatbotRecord = chatbot;
        tenantId = chatbot.tenant_id;
        configData = (chatbot.configuration_json as Record<string, unknown>) || {};
      }
    }
    const timezone = (configData.timezone as string) || 'Europe/London';
    const currency = (configData.currency as string) || 'GBP';
    
    // Extract Chatbot Rules
    const rawRules = configData.chatbot_rules;
    let chatbotRules: string[] = [];
    if (Array.isArray(rawRules)) {
      chatbotRules = rawRules.map((r: any) => String(r).trim()).filter(Boolean);
    } else if (typeof rawRules === 'string') {
      chatbotRules = rawRules.split('\n').map((r: string) => r.trim()).filter(Boolean);
    }

    const rulesSection = chatbotRules.length > 0
      ? `\n\n[MANDATORY CHATBOT RULES & DIRECTIVES]\nYou MUST strictly adhere to and enforce all of the following rules set by the business in every response:\n${chatbotRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
      : '';

    console.log(`[Chat Stream][${requestId}] Resolved Tenant ID: ${tenantId}, TZ: ${timezone}, Rules count: ${chatbotRules.length}`);

    // STYL-181: Enforce terms of service & privacy notice acceptance for gated bots
    const requiresTermsGate =
      chatbotId === '9825855e-d478-443f-b75c-6c0d77039ca6' ||
      chatbotId === 'styleflo-onboarding-flobot' ||
      Boolean(configData.require_client_name ?? configData.requireClientName) ||
      Boolean(configData.global_voice_disclaimer ?? configData.globalVoiceDisclaimer);

    if (requiresTermsGate && sessionPayload) {
      const isAccepted = sessionPayload.termsAccepted === true;
      if (!isAccepted) {
        const { data: sessionRow } = await supabaseAdmin
          .from('chat_sessions')
          .select('terms_accepted_at')
          .eq('session_id', sessionId)
          .eq('chatbot_id', chatbotId)
          .maybeSingle();

        if (!sessionRow?.terms_accepted_at) {
          return NextResponse.json(
            { error: 'Please accept the terms of service and privacy notice to start chatting.' },
            { status: 403, headers: corsHeaders }
          );
        }
      }
    }

    // Metered usage tracking
    if (tenantId && tenantId !== '00000000-0000-0000-0000-000000000000') {
      logMeteredUsage(supabaseAdmin, tenantId, 'chat_messages', 1, 'Inbound web chat message').catch((err) => {
        console.warn(`[Chat Stream][${requestId}] Metered usage logging failure:`, err?.message);
      });
    }

    // 4. Generate user message embedding using central generateEmbedding helper
    let queryEmbedding: number[] = [];
    if (chatbotId !== 'styleflo-onboarding-flobot') {
      console.log(`[Chat Stream][${requestId}] Creating user message embedding...`);
      try {
        queryEmbedding = await generateEmbedding(message, geminiApiKey);
      } catch (embeddingErr: unknown) {
        console.warn(`[Chat Stream][${requestId}] Embedding generation warning:`, embeddingErr);
      }
    }

    const targetBotUuid = chatbotId === 'styleflo-onboarding-flobot' 
      ? '00000000-0000-0000-0000-000000000000' 
      : (chatbotRecord?.id || chatbotId);

    // 5. Query matching documents using the match_documents RPC (strictly filtered by tenant_id & chatbot_id)
    console.log(`[Chat Stream][${requestId}] Searching similarity index for chatbot ${targetBotUuid}...`);
    let matchedDocuments: any[] = [];
    
    if (chatbotId !== 'styleflo-onboarding-flobot' && queryEmbedding.length > 0) {
      const { data: docs, error: rpcError } = await supabaseAdmin.rpc('match_documents', {
        query_embedding: queryEmbedding,
        match_threshold: 0.15, // retrieve broader content if close, similarity score threshold
        match_count: 6, // pull top 6 context chunks
        targeting_tenant_id: tenantId,
        targeting_chatbot_id: targetBotUuid,
      });

      if (rpcError) {
        console.warn(`[Chat Stream][${requestId}] match_documents RPC warning:`, rpcError);
      } else {
        matchedDocuments = docs || [];
      }
    }

    // Fallback: If vector match returns 0 documents, fetch knowledge chunks directly for this chatbot
    if (chatbotId !== 'styleflo-onboarding-flobot' && matchedDocuments.length === 0) {
      console.log(`[Chat Stream][${requestId}] match_documents returned 0 chunks, executing fallback KB query...`);
      const { data: fallbackDocs } = await supabaseAdmin
        .from('document_chunks')
        .select('content')
        .eq('tenant_id', tenantId)
        .eq('chatbot_id', targetBotUuid)
        .limit(6);
      
      if (fallbackDocs && fallbackDocs.length > 0) {
        matchedDocuments = fallbackDocs;
        console.log(`[Chat Stream][${requestId}] Fallback KB query retrieved ${fallbackDocs.length} chunks.`);
      }
    }

    const contextText = matchedDocuments && matchedDocuments.length > 0
      ? matchedDocuments.map((doc: { content: string }) => `- ${doc.content}`).join('\n\n')
      : 'No context available.';
    
    // Fetch Services, Staff, Tenant, and Integrations for Calendar capabilities
    const [servicesRes, staffRes, tenantRes, integrationsRes] = await Promise.all([
      supabaseAdmin.from('services').select('id, name, duration_minutes, buffer_minutes, price, staff_services(staff_id, custom_price, custom_duration)').eq('tenant_id', tenantId).or(`chatbot_id.eq.${targetBotUuid},chatbot_id.is.null`),
      supabaseAdmin.from('staff').select('id, name, google_calendar_id, working_days').eq('tenant_id', tenantId).or(`chatbot_id.eq.${targetBotUuid},chatbot_id.is.null`),
      supabaseAdmin.from('tenants').select('company_name, rwg_business_name, domain, booking_mode, booking_url, max_advance_weeks').eq('id', tenantId).maybeSingle(),
      supabaseAdmin.from('tenant_integrations').select('provider, refresh_token').eq('tenant_id', tenantId),
    ]);

    const configuredServices = servicesRes.data || [];
    const configuredStaff = staffRes.data || [];
    const servicesContext = configuredServices.length > 0 ? JSON.stringify(configuredServices, null, 2) : '[]';
    const staffContext = configuredStaff.length > 0 ? JSON.stringify(configuredStaff, null, 2) : '[]';
    const bookingMode = tenantRes.data?.booking_mode || 'single_calendar';
    const bookingUrl = tenantRes.data?.booking_url || '';

    const hasConnectedCalendar = (integrationsRes.data || []).some(
      (i: any) => (i.provider === 'google_calendar' || i.provider === 'microsoft_calendar') && Boolean(i.refresh_token)
    );
    const hasBookingCapabilities = (bookingMode === 'single_calendar' || bookingMode === 'multi_calendar') &&
      configuredServices.length > 0 &&
      configuredStaff.length > 0 &&
      hasConnectedCalendar;

    const tenantCompany = (tenantRes.data?.company_name || tenantRes.data?.rwg_business_name || '').trim();
    const chatbotName = ((chatbotRecord?.name as string) || '').trim();
    const agentName = ((configData.agent_name as string) || chatbotName || 'AI Assistant').trim();
    const agentRole = ((configData.agent_role as string) || 'AI Assistant').trim();
    const businessName = (configData.businessName as string)?.trim() || tenantCompany || chatbotName || agentName || 'our business';

    console.log(`[Chat Stream][${requestId}] Retrieved ${matchedDocuments?.length || 0} context documents and calendar config for ${businessName} (Agent: ${agentName}).`);

    // 6. Get or create conversation record
    console.log(`[Chat Stream][${requestId}] Resolving conversation session...`);
    let conversationId: string = '00000000-0000-0000-0000-000000000000';

    if (chatbotId !== 'styleflo-onboarding-flobot') {
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('chatbot_id', targetBotUuid)
        .eq('user_session_id', sessionId)
        .maybeSingle();

      if (convError) {
        console.error(`[Chat Stream][${requestId}] Conversation query failed:`, convError);
        return NextResponse.json({ error: `Conversation query failed: ${convError.message}` }, { status: 200, headers: corsHeaders });
      }

      if (!conversation) {
        // Create new conversation session
        const { data: newConv, error: createConvError } = await supabaseAdmin
          .from('conversations')
          .insert({
            tenant_id: tenantId,
            chatbot_id: targetBotUuid,
            user_session_id: sessionId,
          })
          .select('id')
          .single();

        if (createConvError || !newConv) {
          console.error(`[Chat Stream][${requestId}] Conversation creation failed:`, createConvError);
          return NextResponse.json({ error: `Conversation creation failed: ${createConvError?.message}` }, { status: 200, headers: corsHeaders });
        }
        conversationId = newConv.id;
        console.log(`[Chat Stream][${requestId}] Initialized new conversation: ${conversationId}`);
      } else {
        conversationId = conversation.id;
        console.log(`[Chat Stream][${requestId}] Found existing conversation: ${conversationId}`);
      }
    }

    // 7. Retrieve chat history (combining DB records + client-passed messages)
    let chatHistory: any[] = [];

    if (conversationId) {
      const { data: dbHistory, error: historyError } = await supabaseAdmin
        .from('messages')
        .select('sender_type, text_content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (dbHistory && dbHistory.length > 0) {
        chatHistory = dbHistory.reverse().map((m: any) => ({
          role: m.sender_type === 'user' ? 'user' : 'assistant',
          content: m.text_content || '',
        }));
      } else if (historyError) {
        console.error(`[Chat Stream][${requestId}] Failed to fetch history:`, historyError);
      }
    }

    // Fallback or augment with client-passed messages array if DB is empty or missing turns
    if (Array.isArray(clientMessages) && clientMessages.length > chatHistory.length) {
      chatHistory = clientMessages.map((m: any) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));
    }

    // Analyze FloBot state memory from transcript (including current turn message)
    const fullHistoryText = [
      ...chatHistory.map((m: any) => m.content || ''),
      message || ''
    ].join('\n');

    const bodyEmail = (body.clientEmail || body.email || '').trim();
    const emailMatch = fullHistoryText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const confirmedEmail = bodyEmail || (emailMatch ? emailMatch[0] : 'user@example.com');

    // Helper to stream a direct structured response (with DB logging & CORS headers)
    const streamDirectResponse = (responseText: string, userEchoText?: string) => {
      const encoder = new TextEncoder();
      const cleanStoredText = stripCalendarTags(responseText);

      const now = Date.now();
      if (conversationId && conversationId !== '00000000-0000-0000-0000-000000000000') {
        Promise.all([
          supabaseAdmin.from('messages').insert({
            tenant_id: tenantId,
            conversation_id: conversationId,
            sender_type: 'user',
            text_content: userEchoText || message,
            created_at: new Date(now - 1000).toISOString(),
          }),
          supabaseAdmin.from('messages').insert({
            tenant_id: tenantId,
            conversation_id: conversationId,
            sender_type: 'bot',
            text_content: cleanStoredText,
            created_at: new Date(now).toISOString(),
          }),
        ]).catch((err) => console.error(`[Chat Stream][${requestId}] Direct response logging warning:`, err));
      }

      const directStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(responseText));
          controller.close();
        },
      });

      return new Response(directStream, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/plain; charset=utf-8',
        },
      });
    };

    // --- STRUCTURED QUICK-ACTION DISPATCHER ---
    const action = body.action;

    if (action === 'select_service' && body.serviceId) {
      const selectedService = configuredServices.find((s: any) => s.id === body.serviceId) || configuredServices[0];
      const serviceId = selectedService?.id || body.serviceId;
      const serviceName = selectedService?.name || 'Appointment';

      const now = new Date();
      const nextFortnight = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const availData = await getAvailabilityData(tenantId, 'ANY', serviceId, now.toISOString(), nextFortnight.toISOString(), timezone);
      const directSpeech = directAvailabilitySpeech(availData.outcome, availData.text);

      let replyText = directSpeech || `Which day suits you best for your ${serviceName}?`;
      if (!directSpeech && availData.availableDays.length > 0) {
        replyText += `\n\n${availData.quickDaysTag}`;
      } else if (!directSpeech) {
        replyText = `I'm sorry, I couldn't find any available days for ${serviceName} in the next 2 weeks. Please let us know your contact details and our team will get in touch!`;
      }

      return streamDirectResponse(replyText, message || serviceName);
    }

    if (action === 'select_day' && body.date) {
      const dateStr = body.date;
      const serviceId = body.serviceId || configuredServices[0]?.id;
      const staffId = body.staffId || 'ANY';
      const dayStart = `${dateStr}T00:00:00`;
      const dayEnd = `${dateStr}T23:59:59`;

      const availData = await getAvailabilityData(tenantId, staffId, serviceId, dayStart, dayEnd, timezone);
      const directSpeech = directAvailabilitySpeech(availData.outcome, availData.text);
      const daySlots = getSlotsForDay(availData.slots, dateStr);

      const d = new Date(dateStr);
      const displayDate = utcToLocalParts(d, timezone).displayDate;

      let replyText = '';
      if (directSpeech) {
        replyText = directSpeech;
      } else if (daySlots.length > 0) {
        replyText = `Here are the available times for ${displayDate}. Which time would you prefer?\n\n${formatQuickTimesTag(dateStr, serviceId, daySlots)}\n${formatQuickDaysTag(serviceId, staffId, availData.availableDays)}`;
      } else {
        replyText = `I'm sorry, there are no remaining slots on ${displayDate}. Please choose another day:\n\n${formatQuickDaysTag(serviceId, staffId, availData.availableDays)}`;
      }

      return streamDirectResponse(replyText, message || displayDate);
    }

    if (action === 'select_slot' && body.start) {
      const slotStart = body.start;
      const serviceId = body.serviceId || configuredServices[0]?.id;
      const staffId = body.staffId || (configuredStaff.length === 1 ? configuredStaff[0].id : (configuredStaff[0]?.id || 'ANY'));
      const parts = utcToLocalParts(new Date(slotStart), timezone);

      const custName = clientName || body.clientName || 'Customer';
      const custEmail = body.clientEmail || body.email || (emailMatch ? emailMatch[0] : '');
      const custPhone = body.clientPhone || body.phone || '';

      if (!custEmail || !custPhone) {
        const replyText = `To confirm your appointment for ${parts.displayDate} at ${parts.timeStr}, please provide your email address and mobile phone number.`;
        return streamDirectResponse(replyText, message || parts.timeStr);
      }

      const bookingResult = await bookMeeting(tenantId, staffId, serviceId, custName, custEmail, custPhone, slotStart, '', timezone);

      let replyText = '';
      if (bookingResult.includes('Error:') || bookingResult.includes('Failed')) {
        // Race condition: slot taken! Apologise and re-offer remaining times for that day
        const dayAvail = await getAvailabilityData(tenantId, staffId, serviceId, `${parts.dateStr}T00:00:00`, `${parts.dateStr}T23:59:59`, timezone);
        const directSpeech = directAvailabilitySpeech(dayAvail.outcome, dayAvail.text);
        const daySlots = getSlotsForDay(dayAvail.slots, parts.dateStr);

        replyText = directSpeech
          || `I'm sorry, that ${parts.timeStr} slot was just taken! Here are the remaining available times for ${parts.displayDate}:\n\n${formatQuickTimesTag(parts.dateStr, serviceId, daySlots)}\n${formatQuickDaysTag(serviceId, staffId, dayAvail.availableDays)}`;
      } else {
        const svc = configuredServices.find((s: any) => s.id === serviceId);
        const svcName = svc ? svc.name : 'appointment';
        replyText = `Your ${svcName} is confirmed for ${parts.displayDate} at ${parts.timeStr}! A confirmation email has been sent to ${custEmail}.`;
      }

      return streamDirectResponse(replyText, message || parts.timeStr);
    }

    // Detect if user provided a website URL in current message or transcript
    let websiteScrapedText = '';
    let detectedUrl = '';
    const urlMatch = message.match(/(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(com|co\.uk|org|net|io|ai|app|salon|clinic|studio)[^\s]*)/i);
    if (urlMatch && chatbotId === 'styleflo-onboarding-flobot') {
      detectedUrl = urlMatch[0];
      console.log(`[Chat Stream][${requestId}] Detected URL in FloBot message: ${detectedUrl}. Crawling website...`);
      websiteScrapedText = await scrapeWebsiteContent(detectedUrl);
      if (websiteScrapedText && confirmedEmail) {
        saveScrapedWebsiteDataToTenant({
          email: confirmedEmail,
          targetUrl: detectedUrl,
          scrapedText: websiteScrapedText,
        }).catch((err) => console.warn(`[Chat Stream][${requestId}] Auto-save website error:`, err));
      }
    }

    // 8. Build prompt and historical message messages array
    const systemPrompt = chatbotId === 'styleflo-onboarding-flobot'
      ? `You are Flo, the official AI receptionist setup assistant for StyleFlo.ai.
Your goal is to guide new business owners through setting up their AI Receptionist in 60 seconds.

CONVERSATION STATE & ACCOUNT MEMORY:
- USER REGISTRATION: The user HAS ALREADY SUPPLIED THEIR EMAIL & IDENTIFICATION (${confirmedEmail}).
- ABSOLUTE BAN: You are STRICTLY FORBIDDEN from asking for an email address, asking whether they prefer Google or email, or asking them to sign up/login ever again!
${detectedUrl ? `- SUBMITTED WEBSITE URL: ${detectedUrl}` : ''}
${websiteScrapedText ? `- EXTRACTED WEBSITE CONTENT:\n"""\n${websiteScrapedText}\n"""` : ''}

ONBOARDING FLOW DIRECTIVES:
1. WHEN USER ADDS THEIR WEBSITE (${detectedUrl ? 'URL DETECTED NOW!' : 'If URL is provided'}):
   - You MUST scan the extracted website content (or infer from domain) and format your reply strictly using this exact structure:
     "Okay, I have looked at your website and found the following details:"
     * **Business Name**: [Extracted Business Name]
     * **Address / Location**: [MANDATORY - Extracted Street Address, City, or Region]
     * **Services Offered**: [Extracted main services/treatments]
     * **Opening Hours**: [Extracted operating hours if found]
     * **Booking Platform**: [Extracted booking link or platform if found]

     "This is fantastic! I've created your account and set up your AI Receptionist."
     [ACCOUNT_CREATED_DASHBOARD]

2. ACCOUNT CREATION & DASHBOARD TRANSITION:
   - Registration and website detail harvesting is now COMPLETE.
   - You MUST inform the user that their account is created and direct them to click the "Go to Your Dashboard" button.

3. WEBSITE QUESTION FLOW (Prior to URL submission):
   - Primary question: "Does your business have a website?"
   - IF THE USER SAYS YES: Respond strictly with: "Great! Please add your website address below." (DO NOT explain why or mention extracting details).
   - IF THE USER SAYS NO: Ask: "Is your business listed on Google Maps?" and end your turn with tag: [GMAPS_OPTIONS]
     - IF YES (to Google Maps): Ask: "Great! Please share your Google Places / Google Maps link so I can find your listing!"
     - IF NO (to Google Maps): Ask: "No problem! Let's set up your receptionist manually. What is your Business Name?"

4. GDPR RIGHT TO BE FORGOTTEN & PRIVACY REQUESTS:
   - If a user or business owner asks about GDPR, Right to be Forgotten, or forgetting a user (e.g. "I need to forget a customer", "delete data for john@example.com", "GDPR right to be forgotten"):
   - ABSOLUTE BAN: You are STRICTLY FORBIDDEN from mentioning the Superadmin portal, God Mode, or referring B2B users to any administrative dashboard!
   - Respond: "I can assist with taking your GDPR Right to be Forgotten request! Please provide the customer's Name, Email address, or Mobile telephone number. I will immediately record the details and email the StyleFlo Privacy Administration team with the request details so our admin can process the data erasure for your business account."
   - When the user provides the customer details (Name, Email, or Phone), confirm: "Thank you! I have emailed the StyleFlo Privacy Administration team with your GDPR Right to be Forgotten request for [Customer Identifier]. Our admin will inspect and process the erasure in accordance with GDPR regulations."

CRITICAL CONVERSATIONAL LAWS:
1. MANDATORY WEBSITE RESPONSE TEMPLATE: When a website URL is submitted, you MUST include * **Address / Location**: in your list, conclude with "This is fantastic! I've created your account and set up your AI Receptionist.", and end your turn with "[ACCOUNT_CREATED_DASHBOARD]".
2. ABSOLUTE BAN ON RE-ASKING FOR EMAIL / SIGNUP / GOOGLE OAUTH: The user's account registration is ALREADY COMPLETE. You MUST NEVER ask for email, Google sign-up, or identity verification under any circumstances.
3. NO REPEAT GREETINGS: Do not say "Welcome to StyleFlo" or re-introduce yourself.`
      : `You are ${agentName}, a friendly, knowledgeable, and helpful ${agentRole} representing "${businessName}".
When asked who you are, what this business is, or who you represent, warmly state that you are ${agentName} representing "${businessName}".

CRITICAL GREETING RULES:
- The customer has already been shown the welcome message in the widget${clientName ? ` (which greeted them by their first name, ${getFirstName(clientName) || clientName})` : ''}.
- On your first reply, DO NOT repeat the greeting (e.g. do not say "Hi", "Hello", "Welcome", or re-introduce yourself). Answer the user's message directly.
- When a user sends a greeting or pleasantry later in the chat, respond warmly and naturally.
- NEVER suggest handing off to a human, and NEVER ask for their email or phone number on greetings or initial pleasantries! Keep the conversation natural, helpful, and welcoming.

KNOWLEDGE BASE & SUPPORT RULES:
- Use the following context from our knowledge base and service directory to accurately answer customer questions about "${businessName}", our services, rules, and operations.
- Answer user queries directly and thoroughly based on the provided context.
- ONLY offer human follow-up if the user explicitly requests to speak with a human or team member, or if they ask a specific factual question that is genuinely not found in the context after you have checked.

STRICT BRAND PROTECTION RULE: You strictly represent "${businessName}". You are strictly forbidden from recommending, mentioning, or providing information about competitor businesses, competitor brands, or third-party alternatives under any circumstances.${rulesSection}

The current date and time is: ${new Date().toISOString()}. Use this to resolve relative dates like "tomorrow" or "next Sunday".

Guidelines:
- Write in a natural, warm, and human-like conversational tone.
- Use emojis occasionally to feel friendly.
- Use short paragraphs and avoid overwhelming the user with long blocks of text.
- If presenting multiple items, use clean bullet points.
- CRITICAL: Use the ${currency} symbol when quoting prices.
- CRITICAL: If the user explicitly types their email or phone number in the chat, you MUST end your response with exactly: [LEAD_CAPTURED: their_email_or_phone]. DO NOT use this tag to ask them for their info. Only use it when they actually provide it!
${bookingMode === 'walk_in_only' ? '- We DO NOT accept appointments. We are walk-ins only. If the user asks to book, politely inform them that they can just walk in at any time during our opening hours.' : ''}
${bookingMode === 'external_platform' ? `- We use an external booking platform. If the user asks to book, politely redirect them to our booking page: ${bookingUrl}` : ''}
${(!hasBookingCapabilities && bookingMode !== 'walk_in_only' && bookingMode !== 'external_platform') ? `- ONLINE BOOKING NOT CONFIGURED: We do not currently have direct automated chat booking configured for this assistant. If the customer asks to book, schedule an appointment, or check availability:
  * Clearly explain that self-booking is not currently configured for automated scheduling directly in chat.
  * Ask the customer for a description of what they need, along with their name, email address, and mobile phone number.
  * Promise that our team will follow up promptly to arrange their booking.
  * DO NOT emit any booking tags ([CHECK_AVAILABILITY], [BOOK_MEETING], [TIME_SLOTS], [QUICK_DAYS], [QUICK_TIMES], [QUICK_SERVICES]).` : ''}
${hasBookingCapabilities ? `- CRITICAL SCHEDULING RULE 1 (SERVICES CATALOGUE): When the customer asks what services we offer, asks to book, or asks about availability:
  * Present the available services from SERVICES CONFIGURATION with their name, duration, and price.
  * If only one service is configured, you can auto-select it.
  * Offer services using quick links tag: ${formatQuickServicesTag(configuredServices.map((s: any) => ({ id: s.id, name: s.name, duration_minutes: s.duration_minutes || 30, price: s.price })))}
- CRITICAL SCHEDULING RULE 1b (STAFF SELECTION): If the user wants to book an appointment, identify the Service and any requested Staff member. If NO staff member is specified by the user, pass 'ANY' as the StaffID to check availability across ALL qualified staff members for that service.
- CRITICAL SCHEDULING RULE 1c (ALTERNATIVE STAFF OFFER): If the requested staff member (e.g. Jane) is UNAVAILABLE at the requested time slot (e.g. 10:00 AM), but ANOTHER qualified staff member (e.g. Stuart) IS available at 10:00 AM, DO NOT tell the user 10:00 AM is unavailable! Instead, politely offer the 10:00 AM slot with the available colleague (e.g., "Jane is booked at 10:00 AM, but Stuart is available at 10:00 AM! Would you like to book with Stuart, or choose a different time with Jane?").
- CRITICAL SCHEDULING RULE 1d (FUZZY SERVICE PATTERN MATCHING): Users will often state service requests using informal or varied phrasing (e.g., "assisted build", "build help", "setup assistance", "30 min chat"). You MUST search and match similar text patterns across all names and descriptions in SERVICES CONFIGURATION. Match to the most relevant service (e.g., "assisted build" -> "Assisted Setup"). Never default to an unrelated service!
- CRITICAL SCHEDULING RULE 1e (NO RE-PROMPTING STAFF CHOICE): If the user specifies a staff member (e.g., "Jane"), CONFIRM that choice (e.g., "Great, an Assisted Setup with Jane!") and DO NOT ask them to choose between staff members again. Do NOT list alternative staff members unless the requested staff member is unavailable.
- CRITICAL SCHEDULING RULE 1f (PREVENT REDUNDANT QUESTIONS): Never ask the user for information they have already provided in the conversation (such as day, time, service, or staff choice). If day and time were already provided (e.g., "Friday at 8 PM"), immediately check availability using [CHECK_AVAILABILITY] without asking "What day and time were you hoping to book?" again.
- CRITICAL SCHEDULING RULE 1g (STAFF CONSISTENCY LOCK): Keep the user's requested staff member locked throughout the conversation. DO NOT switch staff members in subsequent turns unless the user explicitly requests to change staff, or the requested staff member has zero availability.
- CRITICAL SCHEDULING RULE 2: Once you know the Staff ID (or 'ANY') and Service ID, you MUST check availability before confirming any slot. Ask the customer: "Which day suits you best?" and append EXACTLY: [CHECK_AVAILABILITY: StaffID, ServiceID, StartDate, EndDate]. StartDate and EndDate should be ISO strings WITH the ${timezone} timezone offset (e.g., +01:00 for BST) covering the next 7-14 days. 
- CRITICAL SCHEDULING RULE 3: Once you have checked availability and the user agrees to a specific available slot, you MUST ask for BOTH their email address AND their mobile phone number before booking.
- CRITICAL SCHEDULING RULE 3b (MANDATORY EMAIL READBACK & CONFIRMATION): When the user provides their email address, read it back clearly to confirm the exact spelling before booking.
- CRITICAL SCHEDULING RULE 4: Once you have both their email and mobile number, you MUST book it by responding with a polite message, and then append EXACTLY: [BOOK_MEETING: StaffID, ServiceID, CustomerName, CustomerEmail, CustomerPhone, StartTime, EndTime]. StartTime and EndTime must be precise ISO strings WITH the timezone offset.
- CRITICAL SCHEDULING RULE 5: When presenting available time slots to the user, you MUST output them using EXACTLY this format on its own line: [TIME_SLOTS: {"YYYY-MM-DD":["HH:MM", "HH:MM"]}]. Do not use markdown tables or bullet points for times. Example: [TIME_SLOTS: {"2026-07-06":["09:00","13:00"],"2026-07-07":["09:00","10:00"]}].
- CRITICAL SCHEDULING RULE 6: If the user asks to see their upcoming appointments, you MUST first politely ask them to confirm BOTH their email address AND their mobile phone number (for security reasons). Once you have both, reply with a polite message and append EXACTLY: [LOOKUP_APPOINTMENTS: CustomerEmail, CustomerPhone]. You are strictly forbidden from cancelling or modifying appointments; if they ask to cancel, tell them they must contact the business directly.
- CRITICAL: You MUST use exact UUID strings for StaffID and ServiceID from JSON configs (or 'ANY' for StaffID). Do NOT invent names or UUIDs!
- When outputting a secret tag like [CHECK_AVAILABILITY...] or [BOOK_MEETING...] or [TIME_SLOTS...] or [LOOKUP_APPOINTMENTS...], it MUST be the very last line of your response.` : ''}

Context:
${clientName ? `The customer's name is ${clientName}. Use their first name naturally; do not repeat the greeting.` : ''}
[INJECTED CHUNKS]
${contextText}

[SERVICES CONFIGURATION (JSON)]
${servicesContext}

[STAFF CONFIGURATION (JSON)]
${staffContext}`;

    const formattedMessages: { role: 'user' | 'assistant', content: string }[] = [];
    if (Array.isArray(chatHistory) && chatHistory.length > 0) {
      chatHistory.forEach((msg) => {
        const text = typeof msg.content === 'string' ? msg.content.trim() : '';
        const role = msg.role === 'user' ? 'user' : 'assistant';
        if (text) {
          formattedMessages.push({ role, content: text });
        }
      });
    }

    // Append current user message
    if (message && message.trim()) {
      formattedMessages.push({
        role: 'user',
        content: message.trim(),
      });
    }

    const activeModelName = await getActiveGeminiModel();
    console.log(`[Chat Stream][${requestId}] Initializing Vercel AI SDK text stream (${activeModelName})...`);

    let lastApiError = "";
    
    // 9. Invoke streamText (or mock stream for automated testing) and setup async database transaction logging
    const mockModelReply = (body as any).mockModelReply || request.headers.get('x-mock-model-reply');
    let result: any;

    if (mockModelReply) {
      const mockChunks: string[] = Array.isArray(mockModelReply) ? mockModelReply : [mockModelReply];
      result = {
        textStream: (async function* () {
          for (const chunk of mockChunks) yield chunk;
        })(),
      };
    } else {
      result = await streamText({
        model: google(activeModelName),
        system: systemPrompt,
        messages: formattedMessages,
        maxOutputTokens: 1024,
        onError: (err: unknown) => {
          console.error(`[Chat Stream][${requestId}] API Stream Error:`, err);
          if (err instanceof Error) {
            lastApiError = err.message;
          } else if (err && typeof err === 'object') {
            try {
              lastApiError = (err as any).message || (err as any).error?.message || JSON.stringify(err);
            } catch {
              lastApiError = String(err);
            }
          } else {
            lastApiError = String(err);
          }
        },
        onFinish: async (event) => {
          console.log(`[Chat Stream][${requestId}] AI stream finished. Logging conversation in background...`);
          try {
            // Explicit timestamps to guarantee order
            const now = Date.now();
            const userTime = new Date(now - 1000).toISOString();
            const botTime = new Date(now).toISOString();

            const userInsertRes = await supabaseAdmin.from('messages').insert({
              tenant_id: tenantId,
              conversation_id: conversationId,
              sender_type: 'user',
              text_content: message,
              created_at: userTime,
            });

            const cleanBotText = event.text
              .slice(0, splitAtToolTag(event.text).before.length)
              .replace(/\[LEAD_CAPTURED:.*?\]/g, '')
              .replace(/\[CHECK_AVAILABILITY:[\s\S]*?(?:\]|$)/g, '')
              .replace(/\[BOOK_MEETING:[\s\S]*?(?:\]|$)/g, '')
              .replace(/\[LOOKUP_APPOINTMENTS:[\s\S]*?(?:\]|$)/g, '')
              .replace(/\[QUICK_SERVICES:[\s\S]*?(?:\]|$)/g, '')
              .replace(/\[QUICK_DAYS:[\s\S]*?(?:\]|$)/g, '')
              .replace(/\[QUICK_TIMES:[\s\S]*?(?:\]|$)/g, '')
              .replace(/\[TIME_SLOTS:[\s\S]*?(?:\}\]|$)/g, '')
              .trim();
            
            let assistantInsertRes: { error: unknown | null } = { error: null };
            if (cleanBotText) {
              assistantInsertRes = await supabaseAdmin.from('messages').insert({
                tenant_id: tenantId,
                conversation_id: conversationId,
                sender_type: 'bot',
                text_content: cleanBotText,
                created_at: botTime,
              });
            }

            if (userInsertRes.error) console.error(`[Chat Stream][${requestId}] Failed to log user message:`, userInsertRes.error);
            if (assistantInsertRes.error) console.error(`[Chat Stream][${requestId}] Failed to log assistant response:`, assistantInsertRes.error);

            // Handle consolidated lead capture notification (combining email & phone into 1 email with intent & transcript)
            const leadMatch = event.text.match(/\[LEAD_CAPTURED:\s*(.+?)\]/);
            if (leadMatch && leadMatch[1]) {
              const contactInfo = leadMatch[1];
              console.log(`[Chat Stream][${requestId}] Extracted Lead Info: ${contactInfo}`);
              
              try {
                 await sendConsolidatedLeadEmail({
                  tenantId,
                  chatbotId,
                  conversationId,
                  newContactInfo: contactInfo,
                  channelType: 'chat',
                  customerName: clientName || undefined,
                });
              } catch (err: unknown) {
                console.error(`[Chat Stream][${requestId}] Background lead notification failed:`, err);
              }
            }
          } catch (dbErr: unknown) {
            console.error(`[Chat Stream][${requestId}] Background DB logging failed:`, dbErr);
          }
        },
      });
    }

    const encoder = new TextEncoder();
    let isStreamClosed = false;
    const stream = new ReadableStream({
      cancel() {
        isStreamClosed = true;
      },
      async start(controller) {
        const safeEnqueue = (data: Uint8Array | string) => {
          if (isStreamClosed || request.signal?.aborted) return;
          try {
            controller.enqueue(typeof data === 'string' ? encoder.encode(data) : data);
          } catch {
            isStreamClosed = true;
          }
        };

        const safeClose = () => {
          if (isStreamClosed) return;
          isStreamClosed = true;
          try {
            controller.close();
          } catch {
            // Stream already closed or errored
          }
        };
        try {
          let hasText = false;
          let rawText = '';
          let shownLength = 0;
          for await (const chunk of result.textStream) {
            hasText = true;
            rawText += chunk;
            const safeLength = visibleLength(rawText);
            if (safeLength > shownLength) {
              safeEnqueue(rawText.slice(shownLength, safeLength));
              shownLength = safeLength;
            }
          }
          if (!hasText) {
            safeEnqueue(`I'm sorry, I am having trouble connecting to my database. Please try again. [DEBUG: ${lastApiError || "Empty stream, no error caught."}]`);
            return;
          }
          const { before: visibleText, hadTag: hasToolTag } = splitAtToolTag(rawText);
          if (visibleText.length > shownLength) {
            safeEnqueue(visibleText.slice(shownLength));
            shownLength = visibleText.length;
          }

          // --- AVAILABILITY TOOL PASS ---
          const availMatch = rawText.match(/\[CHECK_AVAILABILITY:\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?)\]/);
          const truncatedAvail = availMatch ? null : parseTruncatedAvailabilityTag(rawText);
          if (truncatedAvail) {
            // The model stopped before closing the tag, so pick up from what it did say.
            if (!mockModelReply && typeof result.finishReason?.then === 'function') {
              result.finishReason.then((reason: string) => {
                console.warn(`[Chat Stream][${requestId}] Unfinished CHECK_AVAILABILITY tag (finish reason: ${reason}).`);
              }).catch(() => {});
            }

            const lowerMessage = (message || '').toLowerCase();
            const namedStaff = configuredStaff.filter((s: any) => {
              const firstName = typeof s.name === 'string' ? s.name.trim().split(/\s+/)[0]?.toLowerCase() : '';
              return firstName && new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lowerMessage);
            });
            const staffMember = resolveByIdPrefix(configuredStaff, truncatedAvail.staffRef)
              || (namedStaff.length === 1 ? namedStaff[0] : null);
            const namedServices = configuredServices.filter(
              (s: any) => typeof s.name === 'string' && s.name.trim() && lowerMessage.includes(s.name.toLowerCase())
            );
            const service = resolveByIdPrefix(configuredServices, truncatedAvail.serviceRef)
              || (namedServices.length === 1 ? namedServices[0] : null)
              || (configuredServices.length === 1 ? configuredServices[0] : null);

            let recoveryReply = '';
            if (service) {
              const staffId = staffMember?.id || 'ANY';
              const now = new Date();
              const nextFortnight = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
              const availData = await getAvailabilityData(tenantId, staffId, service.id, now.toISOString(), nextFortnight.toISOString(), timezone);
              const directSpeech = directAvailabilitySpeech(availData.outcome, availData.text);

              if (directSpeech) {
                recoveryReply = directSpeech;
              } else if (availData.availableDays.length > 0) {
                recoveryReply = `Here are the days with free times:\n\n${availData.quickDaysTag}`;
              } else {
                recoveryReply = `I'm sorry, I couldn't find any available days for ${service.name || 'that service'} in the next 2 weeks. Please let us know your contact details and our team will get in touch!`;
              }
            } else if (configuredServices.length > 0) {
              recoveryReply = `Which service would you like to book?\n\n${formatQuickServicesTag(configuredServices.map((s: any) => ({ id: s.id, name: s.name, duration_minutes: s.duration_minutes || 30, price: s.price })))}`;
            } else {
              recoveryReply = calendarFallbackMessage('unreachable', bookingUrl);
            }

            safeEnqueue(`\n\n${recoveryReply}`);

            if (conversationId && conversationId !== '00000000-0000-0000-0000-000000000000') {
              await supabaseAdmin.from('messages').insert({
                tenant_id: tenantId,
                conversation_id: conversationId,
                sender_type: 'bot',
                text_content: stripCalendarTags(recoveryReply),
              });
            }
          }
          if (availMatch) {
            const staffId = availMatch[1].trim().replace(/['"]/g, '');
            const serviceId = availMatch[2].trim().replace(/['"]/g, '');
            const startStr = availMatch[3].trim().replace(/['"]/g, '');
            const endStr = availMatch[4].trim().replace(/['"]/g, '');
            
            const availData = await getAvailabilityData(tenantId, staffId, serviceId, startStr, endStr, timezone);
            const directSpeech = directAvailabilitySpeech(availData.outcome, availData.text);

            const pass2Messages = [
              ...formattedMessages,
              { role: 'assistant', content: rawText },
              { role: 'user', content: `[SYSTEM] Availability Result:\n${availData.text}\nNow warmly present the available days and times to the user in British English and ask which day suits them best. If the result says a calendar could not be checked, do not invent times for that person.` }
            ];
            
            let pass2Text = '';
            if (directSpeech) {
              pass2Text = directSpeech;
              safeEnqueue(`\n\n${directSpeech}`);
            } else if (mockModelReply && (body as any).mockPass2Reply) {
              pass2Text = (body as any).mockPass2Reply;
              safeEnqueue(pass2Text);
            } else {
              const result2 = await (streamText as any)({
                model: google(activeModelName),
                system: systemPrompt,
                messages: pass2Messages as any,
                maxOutputTokens: 1024,
              });
              
              for await (const chunk of result2.textStream) {
                pass2Text += chunk;
                safeEnqueue(chunk);
              }
            }

            // Quick-link tags are only for times a calendar actually confirmed.
            if (!directSpeech) {
              const tagsToAppend = [
                availData.quickDaysTag,
                availData.quickTimesTag,
                availData.timeSlotsTag
              ].filter(Boolean).join('\n');

              if (tagsToAppend) {
                safeEnqueue(`\n\n${tagsToAppend}`);
              }
            }

            // Save clean transcript in database
            const cleanStoredText = stripCalendarTags(pass2Text || rawText);

            if (conversationId && conversationId !== '00000000-0000-0000-0000-000000000000') {
              await supabaseAdmin.from('messages').insert({
                tenant_id: tenantId,
                conversation_id: conversationId,
                sender_type: 'bot',
                text_content: cleanStoredText,
              });
            }
          }

          // --- BOOKING TOOL PASS ---
          const bookMatch = rawText.match(/\[BOOK_MEETING:\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?)\]/);
          if (bookMatch) {
            const staffId = bookMatch[1].trim().replace(/['"]/g, '');
            const serviceId = bookMatch[2].trim().replace(/['"]/g, '');
            const custName = bookMatch[3].trim().replace(/['"]/g, '');
            const custEmail = bookMatch[4].trim().replace(/['"]/g, '');
            const custPhone = bookMatch[5].trim().replace(/['"]/g, '');
            const startStr = bookMatch[6].trim().replace(/['"]/g, '');
            const endStr = bookMatch[7].trim().replace(/['"]/g, '');
            
            const toolResult = await bookMeeting(tenantId, staffId, serviceId, custName, custEmail, custPhone, startStr, endStr, timezone);
            console.log(`[Chat Stream][${requestId}] Booking Result:`, toolResult);
            
            let bookingReply = '';
            if (toolResult && toolResult.includes('Error:')) {
              const parts = utcToLocalParts(new Date(startStr), timezone);
              const availData = await getAvailabilityData(tenantId, staffId, serviceId, `${parts.dateStr}T00:00:00`, `${parts.dateStr}T23:59:59`, timezone);
              const directSpeech = directAvailabilitySpeech(availData.outcome, availData.text);
              const daySlots = getSlotsForDay(availData.slots, parts.dateStr);

              bookingReply = directSpeech
                || `I'm sorry, that time slot was just taken! Here are the remaining available times for ${parts.displayDate}:\n\n${formatQuickTimesTag(parts.dateStr, serviceId, daySlots)}\n${formatQuickDaysTag(serviceId, staffId, availData.availableDays)}`;
              safeEnqueue(`\n\n${bookingReply}`);
            } else {
              const parts = utcToLocalParts(new Date(startStr), timezone);
              const svc = configuredServices.find((s: any) => s.id === serviceId);
              const svcName = svc ? svc.name : 'appointment';
              bookingReply = `Your ${svcName} is confirmed for ${parts.displayDate} at ${parts.timeStr}! A confirmation email has been sent to ${custEmail}.`;
              safeEnqueue(`\n\n${bookingReply}`);
            }

            const cleanStoredText = stripCalendarTags(bookingReply);

            if (conversationId && conversationId !== '00000000-0000-0000-0000-000000000000') {
              await supabaseAdmin.from('messages').insert({
                tenant_id: tenantId,
                conversation_id: conversationId,
                sender_type: 'bot',
                text_content: cleanStoredText,
              });
            }
          }

          // --- LOOKUP APPOINTMENTS TOOL PASS ---
          const lookupMatch = rawText.match(/\[LOOKUP_APPOINTMENTS:\s*(.+?),\s*(.+?)\]/);
          if (lookupMatch) {
            const custEmail = lookupMatch[1].trim().replace(/['"]/g, '');
            const custPhone = lookupMatch[2].trim().replace(/['"]/g, '');
            
            const toolResult = await lookupAppointments(tenantId, custEmail, custPhone, timezone);
            
            const pass2Messages = [
              ...formattedMessages,
              { role: 'assistant', content: rawText },
              { role: 'user', content: `[SYSTEM] Lookup Result:\n${toolResult}\nNow present this information naturally to the user.` }
            ];
            
            const result2 = await (streamText as any)({
              model: google(activeModelName),
              system: systemPrompt,
              messages: pass2Messages as Parameters<typeof streamText>[0]['messages'],
              maxOutputTokens: 1024,
              onFinish: async (event2: any) => {
                await supabaseAdmin.from('messages').insert({
                  tenant_id: tenantId,
                  conversation_id: conversationId,
                  sender_type: 'bot',
                  text_content: event2.text,
                });
              }
            });
            
            for await (const chunk of result2.textStream) {
              safeEnqueue(chunk);
            }
          }

          if (hasToolTag && !availMatch && !truncatedAvail && !bookMatch && !lookupMatch) {
            safeEnqueue(`\n\nI'm sorry, I couldn't finish that just now. Could you tell me again what you'd like to do?`);
          }
        } catch (err: unknown) {
          if (!request.signal?.aborted && !isStreamClosed) {
            console.error(`[Chat Stream][${requestId}] In-stream generation error:`, err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            safeEnqueue(`\n[STREAM ERROR: ${errorMessage}]`);
          }
        } finally {
          safeClose();
        }
      }
    });


    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });

  } catch (err: unknown) {
    console.error(`[Chat Stream][${requestId}] Unexpected route failure:`, err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Unexpected failure: ${errorMessage}` },
      { status: 200, headers: corsHeaders }
    );
  }
}

