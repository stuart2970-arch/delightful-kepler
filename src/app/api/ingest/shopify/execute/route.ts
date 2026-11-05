import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { requireUser } from '@/lib/auth/require-superadmin';
import { dedupedIngest } from '@/lib/knowledge/ingest-documents';
import { formatStoredIngestMessage } from '@/lib/knowledge/dedupe-chunks';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow long execution on Vercel Pro (up to 5 mins)

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  variants: Array<{ title: string; price: string; sku: string; available: boolean }>;
  tags: string[];
  product_type: string;
}

const policyRoutes = [
  '/policies/privacy-policy',
  '/policies/terms-of-service',
  '/policies/refund-policy',
  '/policies/shipping-policy'
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const storeUrl = searchParams.get('storeUrl');
  const chatbotId = searchParams.get('chatbotId');

  if (!storeUrl || !chatbotId) {
    return new Response('Missing parameters', { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const auth = await requireUser(request);
  if (!auth.ok) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Set up SSE Stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        sendEvent({ type: 'status', message: 'Initialising Shopify pipeline...' });

        const { data: profile } = await adminClient
          .from('profiles')
          .select('tenant_id, is_super_admin')
          .eq('id', auth.userId)
          .single();
        if (!profile?.tenant_id && !profile?.is_super_admin) throw new Error('Profile not found');

        let tenantId = profile?.tenant_id as string;
        if (profile?.is_super_admin) {
          const { data: chatbot, error: chatbotError } = await adminClient
            .from('chatbots')
            .select('id, tenant_id')
            .eq('id', chatbotId)
            .maybeSingle();
          if (chatbotError || !chatbot) throw new Error('Chatbot not found');
          tenantId = chatbot.tenant_id;
        } else {
          const { data: chatbot, error: chatbotError } = await adminClient
            .from('chatbots')
            .select('id, tenant_id')
            .eq('id', chatbotId)
            .eq('tenant_id', tenantId)
            .maybeSingle();
          if (chatbotError || !chatbot) throw new Error('Chatbot not found');
        }

        const cleanUrl = storeUrl.replace(/\/$/, '');
        const targetJsonUrl = `${cleanUrl}/collections/all/products.json?limit=250`;

        sendEvent({ type: 'status', message: 'Fetching product inventory...' });
        const response = await fetch(targetJsonUrl, { headers: { 'User-Agent': 'StyleFloIngestEngine/2.0' } });
        if (!response.ok) throw new Error('Could not access Shopify products.json');
        
        const data = await response.json();
        const products: ShopifyProduct[] = data.products || [];
        
        sendEvent({ type: 'status', message: `Found ${products.length} products.` });

        let insertedCount = 0;
        let skippedDuplicateCount = 0;
        let stoppedForLimit = false;

        const storeOne = async (
          text: string,
          sourceUrl: string,
          metadata: Record<string, unknown>,
        ): Promise<'inserted' | 'skipped' | 'limit' | 'failed'> => {
          const outcome = await dedupedIngest({
            dbClient: adminClient,
            tenantId,
            chatbotId,
            chunks: [text],
            sourceUrl,
            metadata,
            replaceExistingSource: false,
          });

          if (!outcome.ok) {
            if (outcome.status === 403) return 'limit';
            console.warn('[Shopify ingest]', outcome.body.error);
            return 'failed';
          }
          if (outcome.body.insertedCount > 0) return 'inserted';
          return 'skipped';
        };

        // Process Products
        for (let i = 0; i < products.length; i++) {
          const product = products[i];

          sendEvent({ type: 'progress', message: `Processing product ${i + 1} of ${products.length}`, current: i + 1, total: products.length + policyRoutes.length });

          const cleanDescription = product.body_html ? product.body_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
          
          const variantsText = (product.variants || []).map(v => 
            `Variant Option: ${v.title} | Price: ${v.price} | SKU: ${v.sku || 'N/A'} | Inventory Available: ${v.available}`
          ).join('\n');

          const tagsText = (product.tags || []).join(', ');

          const fullSemanticTextChunk = `
Product Title: ${product.title}
Category/Type: ${product.product_type}
Handles/Path: /products/${product.handle}
Tags: ${tagsText}
Description: ${cleanDescription}
${variantsText}
          `.trim();

          const productUrl = `${cleanUrl}/products/${product.handle}`;
          const result = await storeOne(fullSemanticTextChunk, productUrl, {
            source_url: productUrl,
            shopify_product_id: product.id,
            platform: 'shopify',
            is_product: true,
          });

          if (result === 'limit') {
            sendEvent({ type: 'warning', message: 'Knowledge items limit reached. Stopping ingestion.' });
            stoppedForLimit = true;
            break;
          }
          if (result === 'inserted') insertedCount += 1;
          if (result === 'skipped') skippedDuplicateCount += 1;
        }

        // Process Policies
        if (!stoppedForLimit) {
          sendEvent({ type: 'status', message: 'Extracting store policies...' });
          for (let i = 0; i < policyRoutes.length; i++) {
            const route = policyRoutes[i];
            const policyUrl = `${cleanUrl}${route}`;

            sendEvent({ type: 'progress', message: `Crawling ${route}...`, current: products.length + i + 1, total: products.length + policyRoutes.length });

            try {
              const polRes = await fetch(policyUrl, { headers: { 'User-Agent': 'StyleFloIngestEngine/2.0' } });
              if (polRes.ok) {
                const html = await polRes.text();
                const $ = cheerio.load(html);
                
                // Target Shopify standard policy container
                const policyHtml = $('.shopify-policy__container').html();
                if (policyHtml) {
                  const cleanPolicy = cheerio.load(policyHtml).text().replace(/\s+/g, ' ').trim();
                  if (cleanPolicy && cleanPolicy.length > 50) {
                    const result = await storeOne(cleanPolicy, policyUrl, {
                      source_url: policyUrl,
                      platform: 'shopify',
                      is_policy: true,
                    });
                    if (result === 'limit') {
                      sendEvent({ type: 'warning', message: 'Knowledge items limit reached. Stopping ingestion.' });
                      break;
                    }
                    if (result === 'inserted') insertedCount += 1;
                    if (result === 'skipped') skippedDuplicateCount += 1;
                  }
                }
              }
            } catch (e) {
               console.warn('Failed to fetch policy', route, e);
            }
          }
        }

        sendEvent({
          type: 'complete',
          message: formatStoredIngestMessage(insertedCount, skippedDuplicateCount),
          chunksCount: insertedCount,
          insertedCount,
          skippedDuplicateCount,
          alreadyCoveredCount: skippedDuplicateCount,
        });
        controller.close();
      } catch (err: any) {
        sendEvent({ type: 'error', message: err.message || 'Fatal error during ingestion' });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
