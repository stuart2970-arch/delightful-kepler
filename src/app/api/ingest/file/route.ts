import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { checkFeatureEntitlement } from '@/lib/entitlements';
import { batchEmbedTexts } from '@/lib/embeddings';
import { extractTextFromFile } from '@/lib/file-parser';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function createSupabaseClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are missing');
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {}
      },
    },
  });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  console.log(`[Ingest File][${requestId}] Processing file ingestion request...`);

  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  try {
    const supabase = await createSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const chatbotId = formData.get('chatbotId') as string;

    if (!file || !chatbotId) {
      return NextResponse.json({ error: 'Missing file or chatbotId' }, { status: 400 });
    }

    // Feature-flag to disable onboarding FloBot
    const disableOnboarding = process.env.DISABLE_ONBOARDING_BOT === 'true';
    if (disableOnboarding && chatbotId === 'styleflo-onboarding-flobot') {
      console.warn('[Ingest] Onboarding bot is disabled via feature flag.');
      return NextResponse.json({ error: 'Onboarding bot is disabled.' }, { status: 404 });
    }

    const isFloBot = chatbotId === 'styleflo-onboarding-flobot';
    if (!isFloBot && !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(chatbotId)) {
      return NextResponse.json({ error: 'Invalid chatbot ID format' }, { status: 400 });
    }

    let tenantId: string;
    let dbClient = supabase;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase admin environment variables are missing');
    }

    if (isFloBot) {
      tenantId = '00000000-0000-0000-0000-000000000000';
      dbClient = createClient(supabaseUrl, serviceRoleKey);
    } else if (authError || !user) {
      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      dbClient = adminClient;
      
      const { data: chatbot, error } = await dbClient.from('chatbots').select('tenant_id').eq('id', chatbotId).single();
      if (error || !chatbot) return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
      tenantId = chatbot.tenant_id;
    } else {
      const { data: profile } = await supabase.from('profiles').select('tenant_id, is_super_admin').eq('id', user.id).single();

      if (profile?.is_super_admin) {
        const adminClient = createClient(supabaseUrl, serviceRoleKey);
        dbClient = adminClient;

        const { data: chatbot, error } = await adminClient.from('chatbots').select('tenant_id').eq('id', chatbotId).single();
        if (error || !chatbot) return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
        tenantId = chatbot.tenant_id;
      } else if (profile?.tenant_id) {
        tenantId = profile.tenant_id;
        const { data: chatbot } = await supabase.from('chatbots').select('id').eq('id', chatbotId).eq('tenant_id', tenantId).single();
        if (!chatbot) return NextResponse.json({ error: 'Chatbot not found or unauthorized' }, { status: 404 });
      } else {
        const adminClient = createClient(supabaseUrl, serviceRoleKey);
        dbClient = adminClient;
        const { data: chatbot, error } = await adminClient.from('chatbots').select('tenant_id').eq('id', chatbotId).single();
        if (error || !chatbot) return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
        tenantId = chatbot.tenant_id;
      }
    }

    // Process file through universal multi-format file parser
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    console.log(`[Ingest File][${requestId}] Parsing file "${file.name}" (size: ${buffer.length} bytes)...`);
    const textContent = await extractTextFromFile(buffer, file.name, file.type);

    if (!textContent || textContent.length < 10) {
      return NextResponse.json({
        error: `Extracted text from "${file.name}" is empty or unreadable. If this is a scanned image, please copy and paste the text as TXT or Markdown.`
      }, { status: 400 });
    }

    console.log(`[Ingest File][${requestId}] Extracted ${textContent.length} characters of clean text.`);

    // Check entitlements
    const estimatedIncomingChunks = Math.ceil(textContent.length / 1000);
    const entitlementCheck = await checkFeatureEntitlement(dbClient, tenantId, 'knowledge_data_chunks', estimatedIncomingChunks);

    if (!entitlementCheck.allowed) {
      return NextResponse.json({ error: entitlementCheck.error }, { status: 403 });
    }

    // Split text
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
    const docOutputs = await splitter.createDocuments([textContent]);
    const chunks = docOutputs.map((doc) => doc.pageContent);

    if (chunks.length === 0) {
      return NextResponse.json({ error: 'Text splitting generated zero chunks' }, { status: 400 });
    }

    console.log(`[Ingest File][${requestId}] Generating vector embeddings for ${chunks.length} chunks via multi-tier engine...`);
    const embeddings = await batchEmbedTexts(chunks);

    if (!embeddings || embeddings.length === 0) {
      return NextResponse.json({ error: 'Failed to generate embeddings for file chunks.' }, { status: 502 });
    }

    const metadata = { source_type: 'file', title: file.name };

    const recordsToInsert = chunks.slice(0, embeddings.length).map((chunkText, idx) => ({
      tenant_id: tenantId,
      chatbot_id: chatbotId,
      content: chunkText,
      embedding: embeddings[idx],
      source_url: file.name,
      metadata: metadata,
    }));

    const { error: dbInsertError } = await dbClient.from('document_chunks').insert(recordsToInsert);

    if (dbInsertError) {
      console.error(`[Ingest File][${requestId}] Supabase INSERT failed:`, dbInsertError);
      return NextResponse.json({ error: `Failed to save chunks: ${dbInsertError.message}` }, { status: 500 });
    }

    console.log(`[Ingest File][${requestId}] Successfully ingested ${recordsToInsert.length} chunks from ${file.name}`);
    return NextResponse.json({
      success: true,
      chunksCount: recordsToInsert.length,
      message: `Successfully ingested ${recordsToInsert.length} chunks from "${file.name}".`,
    });
  } catch (error: any) {
    console.error(`[Ingest File][${requestId}] Unhandled error:`, error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
