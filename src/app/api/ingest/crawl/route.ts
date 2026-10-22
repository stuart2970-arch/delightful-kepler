import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { z } from 'zod';
import { checkFeatureEntitlement } from '@/lib/entitlements';
import { batchEmbedTexts } from '@/lib/embeddings';
import { sanitizeForPostgres } from '@/lib/file-parser';
import { requireUser } from '@/lib/auth/require-superadmin';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Input validation schema
const IngestRequestSchema = z.object({
  url: z.string().url({ message: 'Invalid URL format' }),
  chatbotId: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, { message: 'Invalid chatbot ID format' }),
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  console.log(`[Ingest Route][${requestId}] Processing crawling request...`);

  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  try {
    // 1. Authenticate user session (STYL-186: strict 401 when no session)
    const auth = await requireUser(request);
    if (!auth.ok) {
      return auth.response;
    }

    // 2. Validate request body
    const body = await request.json();
    const validation = IngestRequestSchema.safeParse(body);

    if (!validation.success) {
      const errorMsg = validation.error.issues.map((issue) => issue.message).join(', ');
      console.warn(`[Ingest Route][${requestId}] Validation failed: ${errorMsg}`);
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }

    const { url, chatbotId } = validation.data;

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const dbClient = adminClient;

    // 3. Verify user profile and tenant
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('tenant_id, is_super_admin')
      .eq('id', auth.userId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'User tenant profile not found' }, { status: 403 });
    }

    let tenantId: string;
    if (profile.is_super_admin) {
      const { data: chatbot, error: chatbotError } = await adminClient
        .from('chatbots')
        .select('id, tenant_id')
        .eq('id', chatbotId)
        .maybeSingle();

      if (chatbotError || !chatbot) {
        return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
      }
      tenantId = chatbot.tenant_id;
    } else {
      tenantId = profile.tenant_id;
      const { data: chatbot, error: chatbotError } = await adminClient
        .from('chatbots')
        .select('id, tenant_id')
        .eq('id', chatbotId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (chatbotError || !chatbot) {
        return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
      }
    }

    // 4. Fetch and Scrape HTML content from URL
    console.log(`[Ingest Route][${requestId}] Fetching content from: ${url}`);
    let htmlContent: string;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-GB,en;q=0.5',
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

    // 5. Clean HTML using Cheerio
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
      title: title || fallbackSiteName,
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

    // 6. Split text into chunks
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

    // 7. Enforce quota considering existing chunks for this URL on this chatbot (STYL-186 re-crawl)
    const sanitizedUrl = sanitizeForPostgres(url);
    const { count: existingCount } = await dbClient
      .from('document_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('chatbot_id', chatbotId)
      .eq('source_url', sanitizedUrl);

    const existingChunksForUrl = existingCount || 0;
    const netIncoming = Math.max(0, chunks.length - existingChunksForUrl);

    const entitlementCheck = await checkFeatureEntitlement(
      dbClient,
      tenantId,
      'knowledge_data_chunks',
      netIncoming
    );

    if (!entitlementCheck.allowed) {
      return NextResponse.json({ error: entitlementCheck.error }, { status: 403 });
    }

    // 8. Generate vector embeddings
    console.log(`[Ingest Route][${requestId}] Generating vector embeddings for ${chunks.length} chunks via multi-tier engine...`);
    const embeddings = await batchEmbedTexts(chunks);

    if (!embeddings || embeddings.length === 0) {
      return NextResponse.json(
        { error: 'Failed to generate any embeddings for the chunks' },
        { status: 502 }
      );
    }

    // 9. Re-crawl: delete previous chunks for this URL and chatbot before inserting new ones (STYL-186)
    if (existingChunksForUrl > 0) {
      const { error: dbDeleteError } = await dbClient
        .from('document_chunks')
        .delete()
        .eq('chatbot_id', chatbotId)
        .eq('source_url', sanitizedUrl);

      if (dbDeleteError) {
        console.warn(`[Ingest Route][${requestId}] Failed to clean existing chunks for URL before re-crawl:`, dbDeleteError);
      }
    }

    // 10. Batch insert document chunks into PostgreSQL
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

    console.log(`[Ingest Route][${requestId}] Successfully ingested ${recordsToInsert.length} chunks for chatbot ${chatbotId}`);
    return NextResponse.json({
      success: true,
      requestId,
      chunksCount: recordsToInsert.length,
      message: `Successfully crawled and ingested ${recordsToInsert.length} chunks from ${url}.`,
    });

  } catch (err: any) {
    console.error(`[Ingest Route][${requestId}] Unexpected error:`, err);
    return NextResponse.json(
      { error: err.message || 'An unexpected internal error occurred during ingestion' },
      { status: 500 }
    );
  }
}
