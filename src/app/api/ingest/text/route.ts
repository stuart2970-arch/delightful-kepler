import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { google } from '@ai-sdk/google';
import { embed, embedMany } from 'ai';
import { z } from 'zod';
import { checkFeatureEntitlement } from '@/lib/entitlements';

const IngestTextSchema = z.object({
  text: z.string().min(10, { message: 'Text is too short' }),
  sourceName: z.string().min(1, { message: 'Source name is required' }),
  chatbotId: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, { message: 'Invalid chatbot ID format' }),
});

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
  console.log(`[Ingest Text][${requestId}] Processing text ingestion request...`);

  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  try {
    const supabase = await createSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    const body = await request.json();
    const validation = IngestTextSchema.safeParse(body);

    if (!validation.success) {
      const errorMsg = validation.error.issues.map((i) => i.message).join(', ');
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }

    const { text, sourceName, chatbotId } = validation.data;
    let tenantId: string;
    let dbClient = supabase;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

    if (authError || !user) {
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceRoleKey) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      
      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      dbClient = adminClient;
      
      const { data: chatbot, error } = await dbClient.from('chatbots').select('tenant_id').eq('id', chatbotId).single();
      if (error || !chatbot) return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
      tenantId = chatbot.tenant_id;
    } else {
      const { data: profile } = await supabase.from('profiles').select('tenant_id, is_super_admin').eq('id', user.id).single();
      if (!profile) return NextResponse.json({ error: 'User tenant profile not found' }, { status: 403 });

      if (profile.is_super_admin) {
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!serviceRoleKey) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        const adminClient = createClient(supabaseUrl, serviceRoleKey);
        dbClient = adminClient;

        const { data: chatbot, error } = await adminClient.from('chatbots').select('tenant_id').eq('id', chatbotId).single();
        if (error || !chatbot) return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
        tenantId = chatbot.tenant_id;
      } else {
        tenantId = profile.tenant_id;
        const { data: chatbot } = await supabase.from('chatbots').select('id').eq('id', chatbotId).eq('tenant_id', tenantId).single();
        if (!chatbot) return NextResponse.json({ error: 'Chatbot not found or unauthorized' }, { status: 404 });
      }
    }

    // Clean text
    const textContent = text.replace(/\s+/g, ' ').trim();

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

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) return NextResponse.json({ error: 'Gemini integration misconfigured' }, { status: 500 });

    const chunkData = chunks.map(chunk => ({ content: chunk, source_url: sourceName }));
    const embeddingPromises = chunkData.map(async (chunk) => {
      try {
        const { embedding } = await embed({
          model: google.textEmbeddingModel('gemini-embedding-001'),
          value: chunk.content,
          providerOptions: { google: { outputDimensionality: 768 } },
        });
        return { content: chunk.content, source_url: chunk.source_url, embedding };
      } catch (err) {
        console.warn(`[Ingest Text][${requestId}] Failed to embed chunk:`, err);
        return null;
      }
    });

    const results = await Promise.all(embeddingPromises);
    const validResults = results.filter((r): r is { content: string; source_url: string; embedding: number[] } => r !== null);

    if (validResults.length === 0) return NextResponse.json({ error: 'Failed to generate embeddings' }, { status: 502 });

    const metadata = { source_type: 'raw_text', title: sourceName };

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

    return NextResponse.json({ success: true, chunksCount: recordsToInsert.length, message: `Successfully ingested ${recordsToInsert.length} chunks.` });
  } catch (error: any) {
    console.error(`[Ingest Text][${requestId}] Unhandled error:`, error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
