import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Google Places API key is missing. Please add it to your environment variables.' }, { status: 500 });
    }

    // Step 1: Follow redirects if it's a short URL (maps.app.goo.gl, g.page, etc.)
    let finalUrl = url;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
      clearTimeout(timeoutId);
      finalUrl = res.url;
    } catch (e) {
      console.warn("Could not follow redirect, using original URL", e);
    }

    // Step 2: Parse the final URL for the business name and location
    // e.g. https://www.google.com/maps/place/StyleFlo+%26+WP-123/@53.3954806,-2.8865454,18.75z/...
    const match = finalUrl.match(/\/place\/([^\/]+)\/@([0-9\.-]+),([0-9\.-]+)/);
    
    let query = '';
    let location = '';

    if (match) {
      query = decodeURIComponent(match[1].replace(/\+/g, ' '));
      location = `${match[2]},${match[3]}`;
    } else {
      // Fallback: try to extract 'q' parameter if it's an older map URL, or just use the whole URL
      const urlObj = new URL(finalUrl);
      query = urlObj.searchParams.get('q') || urlObj.searchParams.get('query') || '';
      
      if (!query) {
         return NextResponse.json({ error: 'Could not extract business name from URL. Please ensure it is a direct Google Maps business link.' }, { status: 400 });
      }
    }

    // Step 3: Call Places API Text Search to get the exact Place ID
    let textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
    if (location) {
      textSearchUrl += `&location=${location}&radius=500`;
    }

    const searchRes = await fetch(textSearchUrl);
    const searchData = await searchRes.json();

    if (!searchData.results || searchData.results.length === 0) {
      // Fallback: If we couldn't find the exact place (often happens with brand new unindexed businesses), 
      // just return the basic info we managed to parse from the URL!
      return NextResponse.json({
        name: query,
        phone: '',
        streetAddress: '',
        city: '',
        postcode: '',
        placeId: '',
        warning: 'Business not yet fully indexed by Google Places API. Partially imported name from URL.'
      });
    }

    const placeId = searchData.results[0].place_id;

    // Step 4: Call Places API Details to get all address components
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,address_components&key=${apiKey}`;
    const detailsRes = await fetch(detailsUrl);
    const detailsData = await detailsRes.json();

    if (!detailsData.result) {
      return NextResponse.json({ error: 'Could not fetch business details.' }, { status: 500 });
    }

    const result = detailsData.result;
    
    // Parse address components
    let streetAddress = '';
    let streetNumber = '';
    let route = '';
    let city = '';
    let postcode = '';

    for (const comp of result.address_components || []) {
      if (comp.types.includes('street_number')) streetNumber = comp.long_name;
      if (comp.types.includes('route')) route = comp.long_name;
      if (comp.types.includes('locality') || comp.types.includes('postal_town')) city = comp.long_name;
      if (comp.types.includes('postal_code')) postcode = comp.long_name;
    }

    streetAddress = `${streetNumber} ${route}`.trim();

    return NextResponse.json({
      name: result.name || query,
      phone: result.formatted_phone_number || '',
      streetAddress,
      city,
      postcode,
      placeId
    });

  } catch (error: any) {
    console.error('Error importing place:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
