import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { google } from '@ai-sdk/google';
import { embed, embedMany } from 'ai';
import { checkFeatureEntitlement } from '@/lib/entitlements';
import { PDFParse } from 'pdf-parse';
import path from 'path';
import { pathToFileURL } from 'url';

async function createSupabaseClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://tkoasyjvrgaglofpzduq.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrb2FzeWp2cmdhZ2xvZnB6ZHVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1OTU3MDUsImV4cCI6MjA5NzE3MTcwNX0.C9tspXZGG59xO9WAN12zU5twpDpHFP95Z9udKe06_JM';

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

    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(chatbotId)) {
      return NextResponse.json({ error: 'Invalid chatbot ID format' }, { status: 400 });
    }

    let tenantId: string;
    let dbClient = supabase;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://tkoasyjvrgaglofpzduq.supabase.co';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrb2FzeWp2cmdhZ2xvZnB6ZHVxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU5NTcwNSwiZXhwIjoyMDk3MTcxNzA1fQ.VyWIQX2CFUUsAyDakbIEX805sz35TxHnjcAxBPWxliw';

    if (authError || !user) {
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

    // Process file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    let textContent = '';

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isTxt = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');

    if (isPdf) {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        textContent = result.text;
      } finally {
        await parser.destroy();
      }
    } else if (isTxt) {
      textContent = buffer.toString('utf-8');
    } else {
      return NextResponse.json({ error: 'Unsupported file type. Only PDF and TXT are supported.' }, { status: 400 });
    }

    textContent = textContent.replace(/\s+/g, ' ').trim();
    if (textContent.length < 10) {
      return NextResponse.json({ error: 'Extracted text is too short or empty' }, { status: 400 });
    }

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

    if (chunks.length === 0) return NextResponse.json({ error: 'Text splitting generated zero chunks' }, { status: 400 });

    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!geminiApiKey) return NextResponse.json({ error: 'Gemini integration misconfigured: missing API key' }, { status: 500 });

    const chunkData = chunks.map(chunk => ({ content: chunk, source_url: file.name }));
    const embeddingPromises = chunkData.map(async (chunk) => {
      try {
        const { embedding } = await embed({
          model: google.textEmbeddingModel('gemini-embedding-001'),
          value: chunk.content,
          providerOptions: { google: { outputDimensionality: 768 } },
        });
        return { content: chunk.content, source_url: chunk.source_url, embedding };
      } catch (err) {
        console.warn(`[Ingest File][${requestId}] Failed to embed chunk:`, err);
        return null;
      }
    });

    const results = await Promise.all(embeddingPromises);
    const validResults = results.filter((r): r is { content: string; source_url: string; embedding: number[] } => r !== null);

    if (validResults.length === 0) return NextResponse.json({ error: 'Failed to generate embeddings' }, { status: 502 });

    const metadata = { source_type: 'file', title: file.name };

    const recordsToInsert = validResults.map((result) => ({
      tenant_id: tenantId,
      chatbot_id: chatbotId,
      content: result.content,
      embedding: result.embedding,
      source_url: result.source_url,
      metadata: metadata,
    }));

    const { error: dbInsertError } = await dbClient.from('document_chunks').insert(recordsToInsert);

    if (dbInsertError) return NextResponse.json({ error: `Failed to save chunks: ${dbInsertError.message}` }, { status: 500 });

    return NextResponse.json({ success: true, chunksCount: recordsToInsert.length, message: `Successfully ingested ${recordsToInsert.length} chunks from ${file.name}.` });
  } catch (error: any) {
    console.error(`[Ingest File][${requestId}] Unhandled error:`, error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
