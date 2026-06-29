import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

export const dynamic = 'force-dynamic';

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url) {
      return NextResponse.json({ error: 'url parameter is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Try to query database for cached metadata first
    try {
      const { data, error } = await supabaseAdmin
        .from('document_chunks')
        .select('metadata')
        .eq('source_url', url)
        .not('metadata', 'is', null)
        .limit(1);

      if (!error && data && data.length > 0 && data[0].metadata && Object.keys(data[0].metadata).length > 0) {
        return NextResponse.json({ success: true, metadata: data[0].metadata }, {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          }
        });
      }
    } catch (dbErr) {
      console.warn('[Products API] Database query failed or metadata column absent. Falling back to live scrape:', dbErr);
    }

    // 2. Live Scrape Fallback
    console.log('[Products API] Live scraping product page:', url);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      next: { revalidate: 0 }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const htmlContent = await response.text();
    const $ = cheerio.load(htmlContent);

    // Extract Open Graph images and metadata before head tags are removed
    const image_url = $('meta[property="og:image"]').attr('content') || 
                      $('meta[name="twitter:image"]').attr('content') || 
                      $('link[rel="image_src"]').attr('href') || null;

    const title = $('meta[property="og:title"]').attr('content') || 
                  $('title').text() || null;

    let price = $('meta[property="product:price:amount"]').attr('content') || 
                $('meta[property="og:price:amount"]').attr('content') || null;
    let currency = $('meta[property="product:price:currency"]').attr('content') || 
                   $('meta[property="og:price:currency"]').attr('content') || null;

    const isProduct = url.includes('/products/') || url.includes('/product/') || url.includes('/shop/');

    if (isProduct && !price) {
      // Look for schema product data in script json-ld tags
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const jsonText = $(el).html();
          if (jsonText) {
            const json = JSON.parse(jsonText);
            const checkProduct = (obj: any) => {
              if (obj && (obj['@type'] === 'Product' || obj['@type'] === 'http://schema.org/Product')) {
                const offers = obj.offers;
                if (offers) {
                  price = offers.price || (Array.isArray(offers) ? offers[0]?.price : null);
                  currency = offers.priceCurrency || (Array.isArray(offers) ? offers[0]?.priceCurrency : null);
                }
              }
            };

            if (Array.isArray(json)) {
              json.forEach(checkProduct);
            } else if (json['@graph'] && Array.isArray(json['@graph'])) {
              json['@graph'].forEach(checkProduct);
            } else {
              checkProduct(json);
            }
          }
        } catch (e) {
          // ignore parsing error
        }
      });
    }

    // Identify store platform
    let platform = 'generic';
    if (htmlContent.includes('cdn.shopify.com') || url.includes('/products/')) {
      platform = 'shopify';
    } else if (htmlContent.includes('wp-content') || htmlContent.includes('woocommerce')) {
      platform = 'woocommerce';
    }

    const metadata = {
      image_url,
      title,
      price,
      currency,
      platform,
      is_product: isProduct
    };

    // Cache metadata back in DB (non-blocking)
    try {
      supabaseAdmin
        .from('document_chunks')
        .update({ metadata })
        .eq('source_url', url)
        .then(({ error }) => {
          if (error) console.error('[Products API] Failed to update metadata cache:', error.message);
        });
    } catch (e) {
      // ignore table column error
    }

    return NextResponse.json({ success: true, metadata }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      }
    });
  } catch (err: any) {
    console.error('[Products API] Unexpected route failure:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
