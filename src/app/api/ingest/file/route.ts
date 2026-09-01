import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { checkFeatureEntitlement } from '@/lib/entitlements';
import { GoogleGenAI } from '@google/genai';
import zlib from 'zlib';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function generateSingleEmbedding(text: string, apiKey: string): Promise<number[]> {
  const ai = new GoogleGenAI({ apiKey });

  // @google/genai v2+ returns EmbedContentResponse with `embeddings: ContentEmbedding[]` (plural array)
  // NOT `embedding: { values }` (singular) — that was a v1 shape.
  try {
    const response = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: text,
    });
    // v2 SDK: response.embeddings is an array; first element has .values
    const values = response.embeddings?.[0]?.values ?? (response as any).embedding?.values;
    if (Array.isArray(values) && values.length > 0) {
      return values;
    }
  } catch (err: any) {
    console.warn(`[Gemini SDK] text-embedding-004 failed: ${err?.message || err}. Trying embedding-001...`);
  }

  try {
    const response = await ai.models.embedContent({
      model: 'embedding-001',
      contents: text,
    });
    const values = response.embeddings?.[0]?.values ?? (response as any).embedding?.values;
    if (Array.isArray(values) && values.length > 0) {
      return values;
    }
  } catch (err: any) {
    console.warn(`[Gemini SDK] embedding-001 failed: ${err?.message || err}. Trying REST fallback...`);
  }

  // REST API fallback — try v1 first, then v1beta
  for (const endpoint of [
    `https://generativelanguage.googleapis.com/v1/models/text-embedding-004:embedContent?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${apiKey}`,
  ]) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(`[REST Embedding] ${endpoint} failed (${res.status}): ${errText.slice(0, 150)}`);
        continue;
      }
      const data = await res.json();
      const vals = data.embedding?.values;
      if (Array.isArray(vals) && vals.length > 0) return vals;
    } catch (err: any) {
      console.warn(`[REST Embedding] fetch error for ${endpoint}: ${err?.message || err}`);
    }
  }

  throw new Error('All embedding methods exhausted — no embedding values returned.');
}

async function batchEmbedGemini(texts: string[], apiKey: string): Promise<number[][]> {
  if (texts.length === 0) return [];

  const BATCH_SIZE = 10;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunkBatch = texts.slice(i, i + BATCH_SIZE);
    
    const batchVecs = await Promise.all(
      chunkBatch.map(text => generateSingleEmbedding(text, apiKey))
    );

    if (batchVecs.length === chunkBatch.length) {
      allEmbeddings.push(...batchVecs);
    } else {
      throw new Error(`Failed to generate complete embeddings for batch starting at ${i}`);
    }
  }

  return allEmbeddings;
}

function parseTextFromStream(streamStr: string, output: string[]) {
  const tjMatches = streamStr.matchAll(/\(([^()\\]|\\[\s\S])*\)\s*(?:Tj|TJ|\'|\")/g);
  for (const m of tjMatches) {
    const cleaned = m[0]
      .replace(/^\(/, '')
      .replace(/\)\s*(?:Tj|TJ|\'|\")$/, '')
      .replace(/\\([\s\S])/g, '$1')
      .trim();
    if (cleaned.length > 0) {
      output.push(cleaned);
    }
  }

  const tjArrayMatches = streamStr.matchAll(/\[((?:\((?:[^()\\]|\\[\s\S])*\)|[^\%\)\]])+)\]\s*TJ/g);
  for (const m of tjArrayMatches) {
    const innerStrings = m[1].matchAll(/\(([^()\\]|\\[\s\S])*\)/g);
    for (const s of innerStrings) {
      const cleaned = s[0].slice(1, -1).replace(/\\([\s\S])/g, '$1').trim();
      if (cleaned.length > 0) {
        output.push(cleaned);
      }
    }
  }
}

function extractTextFromPdf(buffer: Buffer): string {
  const textBlocks: string[] = [];

  try {
    const latinStr = buffer.toString('latin1');
    parseTextFromStream(latinStr, textBlocks);

    const streamRegex = /\/Filter\s*\/FlateDecode[\s\S]*?stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match;
    while ((match = streamRegex.exec(latinStr)) !== null) {
      try {
        const streamHeaderIndex = match.index;
        const streamKwIndex = latinStr.indexOf('stream', streamHeaderIndex);
        if (streamKwIndex !== -1 && streamKwIndex < match.index + match[0].length) {
          let start = streamKwIndex + 6;
          if (latinStr.charCodeAt(start) === 13) start++;
          if (latinStr.charCodeAt(start) === 10) start++;
          const end = match.index + match[0].lastIndexOf('endstream');
          if (end > start) {
            const compressedBuf = buffer.subarray(start, end);
            const decompressedBuf = zlib.inflateSync(compressedBuf);
            parseTextFromStream(decompressedBuf.toString('latin1'), textBlocks);
          }
        }
      } catch {
        // Skip un-decompressable blocks
      }
    }
  } catch (err) {
    console.warn('[PDF Ingest] Stream text parsing warning:', err);
  }

  return textBlocks.join(' ').replace(/\s+/g, ' ').trim();
}

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

    // Process file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isTxt = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
    let textContent = '';

    if (isPdf) {
      try {
        textContent = extractTextFromPdf(buffer);
      } catch (err: any) {
        console.warn(`[Ingest File][${requestId}] Native zlib PDF extraction warning: ${err?.message || err}`);
      }

      if (!textContent || textContent.trim().length < 10) {
        try {
          const { PDFParse } = await import('pdf-parse');
          const parser = new PDFParse({ data: buffer });
          try {
            const result = await parser.getText();
            if (result?.text) textContent = result.text;
          } finally {
            await parser.destroy().catch(() => {});
          }
        } catch (dynamicErr: any) {
          console.warn(`[Ingest File][${requestId}] Dynamic PDFParse import fallback skipped: ${dynamicErr?.message || dynamicErr}`);
        }
      }
    } else if (isTxt) {
      textContent = buffer.toString('utf-8');
    } else {
      return NextResponse.json({ error: 'Unsupported file type. Only PDF and TXT are supported.' }, { status: 400 });
    }

    textContent = textContent.replace(/\s+/g, ' ').trim();
    if (textContent.length < 10) {
      return NextResponse.json({ error: 'Extracted text from PDF is empty or unreadable. If this is a scanned image PDF, please copy and paste the text as TXT.' }, { status: 400 });
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

    const embeddings = await batchEmbedGemini(chunks, geminiApiKey);

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

    if (dbInsertError) return NextResponse.json({ error: `Failed to save chunks: ${dbInsertError.message}` }, { status: 500 });

    return NextResponse.json({ success: true, chunksCount: recordsToInsert.length, message: `Successfully ingested ${recordsToInsert.length} chunks from ${file.name}.` });
  } catch (error: any) {
    console.error(`[Ingest File][${requestId}] Unhandled error:`, error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
