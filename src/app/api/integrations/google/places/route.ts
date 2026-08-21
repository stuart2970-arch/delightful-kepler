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

    const trimmedInput = url.trim();

    // Check 1: Direct Google Place ID (e.g. ChIJ... or GhIJ...)
    if (/^(ChIJ|GhIJ)[a-zA-Z0-9_-]{10,}$/.test(trimmedInput)) {
      return await fetchPlaceDetailsById(trimmedInput, apiKey);
    }

    // Follow redirects for short links (maps.app.goo.gl, g.page, etc.)
    let finalUrl = trimmedInput;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(trimmedInput, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
      clearTimeout(timeoutId);
      finalUrl = res.url;
    } catch (e) {
      console.warn("Could not follow redirect, using original URL", e);
    }

    // Check 2: Direct Place ID in URL parameters (place_id=...)
    const placeIdParamMatch = finalUrl.match(/[?&]place_id=([^&]+)/);
    if (placeIdParamMatch) {
      return await fetchPlaceDetailsById(placeIdParamMatch[1], apiKey);
    }

    // Check 3: Extract Google CID (Customer ID) decimal or hex (ftid=0x...:0x...)
    let cid: string | null = null;
    const cidMatch = finalUrl.match(/[?&]cid=([0-9]+)/);
    if (cidMatch) {
      cid = cidMatch[1];
    } else {
      const ftidMatch = finalUrl.match(/ftid=0x[0-9a-fA-F]+:0x([0-9a-fA-F]+)/);
      if (ftidMatch) {
        try {
          cid = BigInt('0x' + ftidMatch[1]).toString(10);
        } catch (err) {
          console.warn('Could not parse hex ftid to decimal CID', err);
        }
      }
    }

    // If exact CID is found, query Google Places by CID for 100% unique match!
    if (cid) {
      const cidSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=cid:${cid}&key=${apiKey}`;
      const cidRes = await fetch(cidSearchUrl);
      const cidData = await cidRes.json();
      if (cidData.results && cidData.results.length > 0 && cidData.results[0].place_id) {
        return await fetchPlaceDetailsById(cidData.results[0].place_id, apiKey);
      }
    }

    // Check 4: Extract business name & location from Google Maps URL
    const match = finalUrl.match(/\/place\/([^\/]+)\/@([0-9\.-]+),([0-9\.-]+)/);
    let query = '';
    let location = '';

    if (match) {
      query = decodeURIComponent(match[1].replace(/\+/g, ' '));
      location = `${match[2]},${match[3]}`;
    } else {
      try {
        const urlObj = new URL(finalUrl);
        query = urlObj.searchParams.get('q') || urlObj.searchParams.get('query') || '';
      } catch (err) {
        query = trimmedInput;
      }
      
      if (!query) {
         return NextResponse.json({ error: 'Could not extract business name from URL. Please ensure it is a direct Google Maps business link.' }, { status: 400 });
      }
    }

    // Call Places API Text Search (Attempt A: Wide 10km location radius)
    let textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
    if (location) {
      textSearchUrl += `&location=${location}&radius=10000`;
    }

    let searchRes = await fetch(textSearchUrl);
    let searchData = await searchRes.json();

    // Fallback 1: If location-restricted search returned 0 results, retry WITHOUT location restriction!
    if ((!searchData.results || searchData.results.length === 0) && location) {
      const globalSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
      searchRes = await fetch(globalSearchUrl);
      searchData = await searchRes.json();
    }

    if (!searchData.results || searchData.results.length === 0) {
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

    // Smart Match: Find the result whose name best matches the query name
    let bestMatchPlaceId = searchData.results[0].place_id;
    const cleanQuery = query.toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const result of searchData.results) {
      const cleanResultName = (result.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanResultName.includes(cleanQuery) || cleanQuery.includes(cleanResultName)) {
        bestMatchPlaceId = result.place_id;
        break;
      }
    }

    return await fetchPlaceDetailsById(bestMatchPlaceId, apiKey, query);

  } catch (error: any) {
    console.error('Error importing place:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

async function fetchPlaceDetailsById(placeId: string, apiKey: string, fallbackName = '') {
  const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,address_components&key=${apiKey}`;
  const detailsRes = await fetch(detailsUrl);
  const detailsData = await detailsRes.json();

  if (!detailsData.result) {
    return NextResponse.json({ error: 'Could not fetch business details for Place ID: ' + placeId }, { status: 500 });
  }

  const result = detailsData.result;
  
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
    name: result.name || fallbackName,
    phone: result.formatted_phone_number || '',
    streetAddress,
    city,
    postcode,
    placeId
  });
}
