import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import * as cheerio from 'cheerio';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { google } from '@ai-sdk/google';
import { embedMany } from 'ai';
import { z } from 'zod';

// Input validation schema
const IngestRequestSchema = z.object({
  url: z.string().url({ message: 'Invalid URL format' }),
  chatbotId: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, { message: 'Invalid chatbot ID format' }),
});

// Helper function to initialize Supabase client with request/cookie context
async function createSupabaseClient() {
  const cookieStore = await cookies();
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are missing');
  }

  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Safe to ignore if called from a read-only environment
          }
        },
      },
    }
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  console.log(`[Ingest Route][${requestId}] Processing crawling request...`);

  // Map GEMINI_API_KEY to GOOGLE_GENERATIVE_AI_API_KEY for the @ai-sdk/google provider
  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  // Detect if required environment keys are missing for mock mode fallback
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const isMockMode = !supabaseUrl || !supabaseAnonKey || !geminiApiKey;

  if (isMockMode) {
    console.warn(`[Ingest Route][${requestId}] Running in MOCK Mode (missing environment variables).`);
    try {
      const body = await request.json();
      const validation = IngestRequestSchema.safeParse(body);
      if (!validation.success) {
        const errorMsg = validation.error.issues.map((i) => i.message).join(', ');
        return NextResponse.json({ error: errorMsg }, { status: 400 });
      }
      const { url, chatbotId } = validation.data;
      
      // Simulate pipeline delay
      await new Promise((resolve) => setTimeout(resolve, 2500));
      
      return NextResponse.json({
        success: true,
        requestId,
        chunksCount: 8,
        message: `[MOCK MODE] Successfully crawled ${url} and ingested 8 chunks for chatbot ${chatbotId}.`,
      });
    } catch (parseErr) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
  }

  try {
    // 1. Authenticate user session
    const supabase = await createSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    // 2. Validate request body
    const body = await request.json();
    console.log(`[Ingest Route][${requestId}] Raw request body:`, JSON.stringify(body));
    const validation = IngestRequestSchema.safeParse(body);

    if (!validation.success) {
      const errorMsg = validation.error.issues.map((issue) => issue.message).join(', ');
      console.warn(`[Ingest Route][${requestId}] Validation failed: ${errorMsg}`);
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }

    const { url, chatbotId } = validation.data;
    let tenantId: string;
    let dbClient = supabase;

    if (authError || !user) {
      console.warn(`[Ingest Route][${requestId}] No active user session. Attempting admin client fallback...`);
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceRoleKey) {
        console.error(`[Ingest Route][${requestId}] Unauthorized and SUPABASE_SERVICE_ROLE_KEY is missing`);
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const adminClient = createClient(supabaseUrl!, serviceRoleKey);
      dbClient = adminClient;

      // Fetch chatbot using admin client to resolve its tenant_id
      const { data: chatbot, error: chatbotError } = await dbClient
        .from('chatbots')
        .select('tenant_id')
        .eq('id', chatbotId)
        .single();

      if (chatbotError || !chatbot) {
        console.warn(`[Ingest Route][${requestId}] Chatbot lookup failed via admin client for ID ${chatbotId}:`, chatbotError);
        return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
      }

      tenantId = chatbot.tenant_id;
      console.log(`[Ingest Route][${requestId}] Resolved Tenant ID via admin client: ${tenantId}`);
    } else {
      console.log(`[Ingest Route][${requestId}] Authenticated user: ${user.id}, chatbot: ${chatbotId}, target URL: ${url}`);

      // 3. Retrieve user's tenant ID
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (profileError || !profile) {
        console.error(`[Ingest Route][${requestId}] Profile fetch failed:`, profileError);
        return NextResponse.json({ error: 'User tenant profile not found' }, { status: 403 });
      }

      tenantId = profile.tenant_id;
      console.log(`[Ingest Route][${requestId}] Extracted Tenant ID: ${tenantId}`);

      // 4. Validate that the chatbot belongs to the user's tenant (RLS will also enforce this, but explicit check is safer)
      const { data: chatbot, error: chatbotError } = await supabase
        .from('chatbots')
        .select('id')
        .eq('id', chatbotId)
        .eq('tenant_id', tenantId)
        .single();

      if (chatbotError || !chatbot) {
        console.warn(`[Ingest Route][${requestId}] Chatbot validation failed or unauthorized access to chatbot ${chatbotId}`);
        return NextResponse.json(
          { error: 'Chatbot not found or you do not have permission to access it' },
          { status: 404 }
        );
      }
    }

    // 5. Fetch and Scrape HTML content from URL
    console.log(`[Ingest Route][${requestId}] Fetching content from: ${url}`);
    let htmlContent: string;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        next: { revalidate: 0 }, // Do not cache
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      htmlContent = await response.text();
    } catch (fetchErr: any) {
      console.error(`[Ingest Route][${requestId}] HTML Fetch failed for ${url}:`, fetchErr);
      return NextResponse.json(
        { error: `Failed to retrieve content from website: ${fetchErr.message || fetchErr}` },
        { status: 422 }
      );
    }

    // 6. Clean HTML using Cheerio (ignore nav, footer, script, styles, header, svg, iframe)
    console.log(`[Ingest Route][${requestId}] Parsing HTML and extracting prose...`);
    const $ = cheerio.load(htmlContent);
    $('nav, footer, script, style, noscript, header, iframe, svg, form, head').remove();

    // Extract clean prose text
    const textContent = $('body')
      .text()
      .replace(/\s+/g, ' ') // Replace multiple spaces/newlines with a single space
      .trim();

    if (!textContent || textContent.length < 50) {
      console.warn(`[Ingest Route][${requestId}] Scraped text is too short or empty (${textContent.length} chars)`);
      return NextResponse.json(
        { error: 'Failed to extract sufficient readable prose from the target URL' },
        { status: 400 }
      );
    }

    console.log(`[Ingest Route][${requestId}] Extracted ${textContent.length} characters of clean text.`);

    // 7. Split text into 1,000 character chunks (200 char overlap) using LangChain's splitter
    console.log(`[Ingest Route][${requestId}] Chunking text...`);
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const docOutputs = await splitter.createDocuments([textContent]);
    const chunks = docOutputs.map((doc) => doc.pageContent);

    console.log(`[Ingest Route][${requestId}] Split text into ${chunks.length} chunks.`);

    if (chunks.length === 0) {
      return NextResponse.json({ error: 'Text splitting generated zero chunks' }, { status: 400 });
    }

    // 8. Generate Gemini Embeddings (text-embedding-004, 768 dimensions)
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      console.error(`[Ingest Route][${requestId}] GEMINI_API_KEY environment variable is missing`);
      return NextResponse.json({ error: 'Gemini integration misconfigured' }, { status: 500 });
    }

    console.log(`[Ingest Route][${requestId}] Generating vector embeddings for ${chunks.length} chunks via text-embedding-004...`);
    let embeddings: number[][];

    try {
      const { embeddings: generatedEmbeddings } = await embedMany({
        model: google.textEmbeddingModel('text-embedding-004'),
        values: chunks,
      });

      embeddings = generatedEmbeddings;
    } catch (geminiErr: any) {
      console.error(`[Ingest Route][${requestId}] Gemini Embeddings creation failed:`, geminiErr);
      return NextResponse.json(
        { error: `Embedding generation failed: ${geminiErr.message || geminiErr}` },
        { status: 502 }
      );
    }

    // 9. Batch insert document chunks into public.document_chunks
    console.log(`[Ingest Route][${requestId}] Saving document chunks to database...`);
    const recordsToInsert = chunks.map((chunk, index) => ({
      tenant_id: tenantId,
      chatbot_id: chatbotId,
      content: chunk,
      embedding: embeddings[index],
      source_url: url,
    }));

    const { error: dbInsertError } = await dbClient
      .from('document_chunks')
      .insert(recordsToInsert);

    if (dbInsertError) {
      console.error(`[Ingest Route][${requestId}] Supabase INSERT failed:`, dbInsertError);
      return NextResponse.json(
        { error: `Failed to save chunks to database: ${dbInsertError.message}` },
        { status: 500 }
      );
    }

    console.log(`[Ingest Route][${requestId}] Successfully ingested ${chunks.length} chunks for chatbot ${chatbotId}`);
    return NextResponse.json({
      success: true,
      requestId,
      chunksCount: chunks.length,
      message: `Successfully crawled and ingested ${chunks.length} chunks.`,
    });

  } catch (err: any) {
    console.error(`[Ingest Route][${requestId}] Unexpected error:`, err);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred during ingestion' },
      { status: 500 }
    );
  }
}
