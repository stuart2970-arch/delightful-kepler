import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import * as cheerio from 'cheerio';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { z } from 'zod';
import { checkFeatureEntitlement } from '@/lib/entitlements';
import { batchEmbedTexts } from '@/lib/embeddings';
import { sanitizeForPostgres } from '@/lib/file-parser';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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

  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // 1. Authenticate user session
    const supabase = await createSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    // 2. Validate request body
    const body = await request.json();
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
      if (!serviceRoleKey) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const adminClient = createClient(supabaseUrl!, serviceRoleKey);
      dbClient = adminClient;

      const { data: chatbot, error: chatbotError } = await dbClient
        .from('chatbots')
        .select('tenant_id')
        .eq('id', chatbotId)
        .single();

      if (chatbotError || !chatbot) {
        return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
      }

      tenantId = chatbot.tenant_id;
    } else {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('tenant_id, is_super_admin')
        .eq('id', user.id)
        .single();

      if (profileError || !profile) {
        return NextResponse.json({ error: 'User tenant profile not found' }, { status: 403 });
      }

      if (profile.is_super_admin) {
        if (!serviceRoleKey) {
          return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }
        const adminClient = createClient(supabaseUrl!, serviceRoleKey);
        dbClient = adminClient;

        const { data: chatbot, error: chatbotError } = await adminClient
          .from('chatbots')
          .select('tenant_id')
          .eq('id', chatbotId)
          .single();

        if (chatbotError || !chatbot) {
          return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
        }
        tenantId = chatbot.tenant_id;
      } else {
        tenantId = profile.tenant_id;

        const { data: chatbot, error: chatbotError } = await supabase
          .from('chatbots')
          .select('id')
          .eq('id', chatbotId)
          .eq('tenant_id', tenantId)
          .single();

        if (chatbotError || !chatbot) {
          return NextResponse.json(
            { error: 'Chatbot not found or you do not have permission to access it' },
            { status: 404 }
          );
        }
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
        next: { revalidate: 0 },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      htmlContent = await response.text();
    } catch (fetchErr: any) {
      return NextResponse.json(
        { error: `Failed to retrieve content from website: ${fetchErr.message || fetchErr}` },
        { status: 422 }
      );
    }

    // 6. Clean HTML using Cheerio
    const $ = cheerio.load(htmlContent);

    const image_url = $('meta[property="og:image"]').attr('content') || 
                      $('meta[name="twitter:image"]').attr('content') || 
                      $('link[rel="image_src"]').attr('href') || null;
                      
    const rawTitle = $('meta[property="og:title"]').attr('content') || 
                     $('title').text() || null;
    const title = rawTitle ? sanitizeForPostgres(rawTitle) : null;

    let price = null;
    let currency = null;
    const isProduct = url.includes('/products/') || url.includes('/product/') || url.includes('/shop/');

    let platform = 'generic';
    if (htmlContent.includes('cdn.shopify.com') || url.includes('/products/')) {
      platform = 'shopify';
    } else if (htmlContent.includes('wp-content') || htmlContent.includes('woocommerce')) {
      platform = 'woocommerce';
    }

    const siteName = $('meta[property="og:site_name"]').attr('content') || null;
    let fallbackSiteName = 'Store';
    try {
      fallbackSiteName = new URL(url).hostname.replace('www.', '');
    } catch (_) {}

    const metadata = {
      image_url,
      title,
      price,
      currency,
      platform,
      site_name: siteName ? sanitizeForPostgres(siteName) : fallbackSiteName,
      is_product: isProduct
    };

    $('nav, footer, script, style, noscript, header, iframe, svg, form, head').remove();

    $('a').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && text) {
        try {
          const absoluteUrl = new URL(href, url).toString();
          $(el).text(` [${text}](${absoluteUrl}) `);
        } catch (e) {
          $(el).text(` [${text}](${href}) `);
        }
      }
    });

    // Extract clean prose text and sanitize for PostgreSQL
    const rawText = $('body').text();
    const textContent = sanitizeForPostgres(rawText);

    if (!textContent || textContent.length < 50) {
      return NextResponse.json(
        { error: 'Failed to extract sufficient readable prose from the target URL' },
        { status: 400 }
      );
    }

    console.log(`[Ingest Route][${requestId}] Extracted ${textContent.length} characters of clean text.`);

    // Enforce quota
    const estimatedIncomingChunks = Math.ceil(textContent.length / 1000);
    const entitlementCheck = await checkFeatureEntitlement(dbClient, tenantId, 'knowledge_data_chunks', estimatedIncomingChunks);

    if (!entitlementCheck.allowed) {
      return NextResponse.json({ error: entitlementCheck.error }, { status: 403 });
    }

    // Split text into chunks
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const docOutputs = await splitter.createDocuments([textContent]);
    const chunks = docOutputs
      .map((doc) => sanitizeForPostgres(doc.pageContent))
      .filter((c) => c.length > 0);

    if (chunks.length === 0) {
      return NextResponse.json({ error: 'Text splitting generated zero chunks' }, { status: 400 });
    }

    console.log(`[Ingest Route][${requestId}] Generating vector embeddings for ${chunks.length} chunks via multi-tier engine...`);
    const embeddings = await batchEmbedTexts(chunks);

    if (!embeddings || embeddings.length === 0) {
      return NextResponse.json(
        { error: 'Failed to generate any embeddings for the chunks' },
        { status: 502 }
      );
    }

    // Batch insert document chunks into PostgreSQL
    const sanitizedUrl = sanitizeForPostgres(url);
    const recordsToInsert = chunks.slice(0, embeddings.length).map((chunkContent, idx) => ({
      tenant_id: tenantId,
      chatbot_id: chatbotId,
      content: sanitizeForPostgres(chunkContent),
      embedding: embeddings[idx],
      source_url: sanitizedUrl,
      metadata: metadata,
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
      message: `Successfully crawled and ingested ${chunks.length} chunks from ${url}.`,
    });

  } catch (err: any) {
    console.error(`[Ingest Route][${requestId}] Unexpected error:`, err);
    return NextResponse.json(
      { error: err.message || 'An unexpected internal error occurred during ingestion' },
      { status: 500 }
    );
  }
}
