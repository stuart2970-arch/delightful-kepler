import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { google } from '@ai-sdk/google';
import { embed } from 'ai';
import * as cheerio from 'cheerio';
import { checkFeatureEntitlement } from '@/lib/entitlements';

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

  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll() {} // readonly context
    }
  });

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Authenticate user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
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
        sendEvent({ type: 'status', message: 'Initializing Shopify pipeline...' });

        // Verify tenant
        const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', user.id).single();
        if (!profile?.tenant_id) throw new Error('Profile not found');
        const tenantId = profile.tenant_id;

        const cleanUrl = storeUrl.replace(/\/$/, '');
        const targetJsonUrl = `${cleanUrl}/collections/all/products.json?limit=250`;

        sendEvent({ type: 'status', message: 'Fetching product inventory...' });
        const response = await fetch(targetJsonUrl, { headers: { 'User-Agent': 'StyleFloIngestEngine/2.0' } });
        if (!response.ok) throw new Error('Could not access Shopify products.json');
        
        const data = await response.json();
        const products: ShopifyProduct[] = data.products || [];
        
        sendEvent({ type: 'status', message: `Found ${products.length} products.` });

        let processedChunksCount = 0;

        // Process Products
        for (let i = 0; i < products.length; i++) {
          const product = products[i];

          // Check Quota before each chunk
          const entitlement = await checkFeatureEntitlement(adminClient, tenantId, 'knowledge_data_chunks', 1);
          if (!entitlement.allowed) {
            sendEvent({ type: 'warning', message: 'Data quota exceeded. Stopping ingestion gracefully.' });
            break;
          }

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

          try {
            const { embedding } = await embed({
              model: google.textEmbeddingModel('gemini-embedding-001'),
              value: fullSemanticTextChunk,
              providerOptions: { google: { outputDimensionality: 768 } },
            });

            const { error: insertError } = await adminClient
              .from('document_chunks')
              .insert({
                tenant_id: tenantId,
                chatbot_id: chatbotId,
                content: fullSemanticTextChunk,
                embedding,
                metadata: {
                  source_url: `${cleanUrl}/products/${product.handle}`,
                  shopify_product_id: product.id,
                  platform: 'shopify',
                  is_product: true
                },
                chunk_source_type: 'shopify_json'
              });

            if (!insertError) {
              processedChunksCount++;
            }
          } catch (e) {
            console.warn('Embedding failed for product', product.handle, e);
          }
        }

        // Process Policies
        sendEvent({ type: 'status', message: 'Extracting store policies...' });
        for (let i = 0; i < policyRoutes.length; i++) {
          const route = policyRoutes[i];
          const policyUrl = `${cleanUrl}${route}`;

          const entitlement = await checkFeatureEntitlement(adminClient, tenantId, 'knowledge_data_chunks', 1);
          if (!entitlement.allowed) {
            break;
          }

          sendEvent({ type: 'progress', message: `Crawling ${route}...`, current: products.length + i + 1, total: products.length + policyRoutes.length });

          try {
            const polRes = await fetch(policyUrl, { headers: { 'User-Agent': 'StyleFloIngestEngine/2.0' } });
            if (polRes.ok) {
              const html = await polRes.text();
              const $ = cheerio.load(html);
              
              // Target Shopify standard policy container
              const policyHtml = $('.shopify-policy__container').html();
              if (policyHtml) {
                // Strip tags, extract text
                const cleanPolicy = cheerio.load(policyHtml).text().replace(/\s+/g, ' ').trim();
                if (cleanPolicy && cleanPolicy.length > 50) {
                  
                  const { embedding } = await embed({
                    model: google.textEmbeddingModel('gemini-embedding-001'),
                    value: cleanPolicy,
                    providerOptions: { google: { outputDimensionality: 768 } },
                  });

                  const { error: insertError } = await adminClient
                    .from('document_chunks')
                    .insert({
                      tenant_id: tenantId,
                      chatbot_id: chatbotId,
                      content: cleanPolicy,
                      embedding,
                      metadata: {
                        source_url: policyUrl,
                        platform: 'shopify',
                        is_policy: true
                      },
                      chunk_source_type: 'shopify_policy'
                    });

                  if (!insertError) {
                    processedChunksCount++;
                  }
                }
              }
            }
          } catch (e) {
             console.warn('Failed to fetch policy', route, e);
          }
        }

        sendEvent({ type: 'complete', message: `Successfully vectorized ${processedChunksCount} chunks.` });
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
