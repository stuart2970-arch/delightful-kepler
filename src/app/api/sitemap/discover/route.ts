import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { websiteUrl } = await request.json();

    if (!websiteUrl) {
      return NextResponse.json({ error: 'websiteUrl is required' }, { status: 400 });
    }

    // Normalize URL
    let baseUrl = websiteUrl.trim();
    if (!baseUrl.startsWith('http')) {
      baseUrl = `https://${baseUrl}`;
    }
    // Remove trailing slash
    baseUrl = baseUrl.replace(/\/+$/, '');

    const sitemapUrl = `${baseUrl}/sitemap.xml`;
    console.log(`Checking sitemap at: ${sitemapUrl}`);

    const response = await fetch(sitemapUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ 
        urls: [], 
        message: `No sitemap found at ${sitemapUrl} (Status: ${response.status})` 
      });
    }

    const xml = await response.text();
    let discoveredUrls: Set<string> = new Set();

    // Determine if this is a sitemap index or a regular sitemap
    if (xml.includes('<sitemapindex')) {
      // It's a sitemap index. Extract all sitemap URLs.
      const sitemapRegex = /<loc>(.*?)<\/loc>/g;
      let match;
      const subSitemaps = [];
      while ((match = sitemapRegex.exec(xml)) !== null) {
        subSitemaps.push(match[1].trim());
      }

      console.log(`Found sitemap index with ${subSitemaps.length} sub-sitemaps.`);
      
      // Fetch up to 5 sub-sitemaps to prevent hanging on massive sites
      const sitemapsToFetch = subSitemaps.slice(0, 5);
      
      await Promise.all(sitemapsToFetch.map(async (subUrl) => {
        try {
          const subRes = await fetch(subUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
          });
          if (subRes.ok) {
            const subXml = await subRes.text();
            extractUrls(subXml, discoveredUrls);
          }
        } catch (err) {
          console.error(`Failed to fetch sub-sitemap: ${subUrl}`, err);
        }
      }));

    } else {
      // It's a regular sitemap
      extractUrls(xml, discoveredUrls);
    }

    // Filter out non-http/https URLs and images/pdfs
    const validUrls = Array.from(discoveredUrls).filter(url => {
      if (!url.startsWith('http')) return false;
      const lower = url.toLowerCase();
      if (lower.endsWith('.pdf') || lower.endsWith('.jpg') || lower.endsWith('.png') || lower.endsWith('.gif') || lower.endsWith('.svg') || lower.endsWith('.jpeg')) {
        return false;
      }
      return true;
    });

    return NextResponse.json({ urls: validUrls, message: `Found ${validUrls.length} pages in sitemap.` });

  } catch (error: any) {
    console.error('Sitemap discovery error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to discover sitemap' },
      { status: 500 }
    );
  }
}

function extractUrls(xml: string, urlSet: Set<string>) {
  const locRegex = /<loc>(.*?)<\/loc>/g;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    urlSet.add(match[1].trim());
  }
}
