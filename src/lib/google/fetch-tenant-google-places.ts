import {
  buildPlacesTextSearchQuery,
  matchPlaceToTenant,
  resolveConfirmedPlaceId,
  type TenantPlacesAddressFields,
} from '@/lib/google/tenant-places-metadata'

export type GooglePlacesBundle = {
  rating: number
  userRatingCount: number
  placeId: string
  reviews: Array<{ rating: number; text: string; author_name: string }>
  regularOpeningHours: Record<string, unknown> | null
  photos: string[]
  verified: boolean
}

const EMPTY_BUNDLE: GooglePlacesBundle = {
  rating: 5,
  userRatingCount: 0,
  placeId: '',
  reviews: [],
  regularOpeningHours: null,
  photos: [],
  verified: false,
}

const PLACE_FIELDS =
  'id,displayName,rating,userRatingCount,reviews,regularOpeningHours,photos,photos.authorAttributions,formattedAddress'

export function parseGoogleOpeningHours(googleHours: { periods?: unknown[] } | null | undefined) {
  const daysMap: Record<number, string> = {
    0: 'sunday',
    1: 'monday',
    2: 'tuesday',
    3: 'wednesday',
    4: 'thursday',
    5: 'friday',
    6: 'saturday',
  }

  const hoursResult: Record<string, { hours: { start: string; end: string }; unavailable: boolean }> = {}

  Object.values(daysMap).forEach((day) => {
    hoursResult[day] = {
      hours: { start: '09:00', end: '17:00' },
      unavailable: true,
    }
  })

  if (!googleHours?.periods || !Array.isArray(googleHours.periods)) {
    return hoursResult
  }

  const pad = (num: number) => String(num).padStart(2, '0')

  for (const period of googleHours.periods as Array<{
    open?: { day?: number; hour?: number; minute?: number }
    close?: { hour?: number; minute?: number }
  }>) {
    const dayNum = period.open?.day
    if (dayNum === undefined) continue

    const dayName = daysMap[dayNum]
    if (!dayName) continue

    const startHour = period.open?.hour
    const startMin = period.open?.minute
    const endHour = period.close?.hour
    const endMin = period.close?.minute

    if (
      startHour !== undefined
      && startMin !== undefined
      && endHour !== undefined
      && endMin !== undefined
    ) {
      hoursResult[dayName] = {
        hours: {
          start: `${pad(startHour)}:${pad(startMin)}`,
          end: `${pad(endHour)}:${pad(endMin)}`,
        },
        unavailable: false,
      }
    }
  }

  return hoursResult
}

const placeHeaders = (apiKey: string): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': apiKey,
    'X-Goog-FieldMask': PLACE_FIELDS,
  }
  if (process.env.GOOGLE_PLACES_HTTP_REFERER) {
    headers.Referer = process.env.GOOGLE_PLACES_HTTP_REFERER
  }
  return headers
}

async function mapPlaceToBundle(
  tenant: TenantPlacesAddressFields,
  place: Record<string, unknown>,
  apiKey: string,
  verified: boolean,
): Promise<GooglePlacesBundle> {
  const displayName =
    typeof (place.displayName as { text?: string } | undefined)?.text === 'string'
      ? (place.displayName as { text: string }).text
      : ''

  if (!matchPlaceToTenant(displayName, tenant)) {
    return { ...EMPTY_BUNDLE }
  }

  const reviews = Array.isArray(place.reviews)
    ? place.reviews.map((r: Record<string, unknown>) => ({
        rating: typeof r.rating === 'number' ? r.rating : 5,
        text:
          typeof (r.text as { text?: string } | undefined)?.text === 'string'
            ? (r.text as { text: string }).text
            : typeof (r.originalText as { text?: string } | undefined)?.text === 'string'
              ? (r.originalText as { text: string }).text
              : '',
        author_name:
          typeof (r.authorAttribution as { displayName?: string } | undefined)?.displayName === 'string'
            ? (r.authorAttribution as { displayName: string }).displayName
            : 'Anonymous',
      }))
    : []

  const parsedHours = place.regularOpeningHours
    ? parseGoogleOpeningHours(place.regularOpeningHours as { periods?: unknown[] })
    : null

  const businessNameLower = (tenant.rwg_business_name || tenant.company_name || '').toLowerCase()
  const placePhotos = Array.isArray(place.photos) ? place.photos : []

  const ownerPhotos = placePhotos.filter((p: Record<string, unknown>) => {
    const attributions = p.authorAttributions as Array<{ displayName?: string }> | undefined
    const creatorName = attributions?.[0]?.displayName || ''
    return creatorName.toLowerCase().includes(businessNameLower)
  })

  const customerPhotos = placePhotos.filter((p: Record<string, unknown>) => {
    const attributions = p.authorAttributions as Array<{ displayName?: string }> | undefined
    const creatorName = attributions?.[0]?.displayName || ''
    return !creatorName.toLowerCase().includes(businessNameLower)
  })

  const combinedPhotos = [...ownerPhotos, ...customerPhotos].slice(0, 10)

  const photoPromises = combinedPhotos.map(async (photo: Record<string, unknown>) => {
    try {
      if (typeof photo.name !== 'string') return null
      const mediaRes = await fetch(
        `https://places.googleapis.com/v1/${photo.name}/media?key=${apiKey}&maxWidthPx=1920&skipHttpRedirect=true`,
      )
      if (mediaRes.ok) {
        const mediaData = await mediaRes.json() as { photoUri?: string }
        return mediaData.photoUri || null
      }
    } catch (e) {
      console.error('Error fetching media URI for photo:', photo.name, e)
    }
    return null
  })

  const photosList = (await Promise.all(photoPromises)).filter(Boolean) as string[]

  return {
    rating: typeof place.rating === 'number' ? place.rating : 5,
    userRatingCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : 0,
    placeId: typeof place.id === 'string' ? place.id : '',
    reviews,
    regularOpeningHours: parsedHours,
    photos: photosList,
    verified,
  }
}

async function fetchPlaceById(
  tenant: TenantPlacesAddressFields,
  placeId: string,
  apiKey: string,
): Promise<GooglePlacesBundle> {
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    method: 'GET',
    headers: placeHeaders(apiKey),
  })

  if (!response.ok) {
    const errText = await response.text()
    console.warn('[Places API Error] place lookup failed', response.status, errText.slice(0, 200))
    return { ...EMPTY_BUNDLE }
  }

  const place = await response.json() as Record<string, unknown>
  return mapPlaceToBundle(tenant, place, apiKey, true)
}

async function fetchPlaceByTextSearch(
  tenant: TenantPlacesAddressFields,
  apiKey: string,
): Promise<GooglePlacesBundle> {
  const textQuery = buildPlacesTextSearchQuery(tenant)
  if (!textQuery) {
    return { ...EMPTY_BUNDLE }
  }

  const headers: Record<string, string> = {
    ...placeHeaders(apiKey),
    'X-Goog-FieldMask':
      'places.id,places.displayName,places.rating,places.userRatingCount,places.reviews,places.regularOpeningHours,places.photos,places.photos.authorAttributions',
  }

  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers,
    body: JSON.stringify({ textQuery }),
  })

  if (!response.ok) {
    const errText = await response.text()
    if (response.status === 403 && errText.includes('API_KEY_HTTP_REFERRER_BLOCKED')) {
      console.warn(
        '[Places API Error] Google returned 403 API_KEY_HTTP_REFERRER_BLOCKED. Server-side API requests from Node.js require an API key without HTTP Referrer restrictions in Google Cloud Console, or set GOOGLE_PLACES_SERVER_API_KEY / GOOGLE_PLACES_HTTP_REFERER in environment variables.',
      )
    } else {
      console.warn('[Places API Error]', response.status, errText.slice(0, 200))
    }
    return { ...EMPTY_BUNDLE }
  }

  const data = await response.json() as { places?: Record<string, unknown>[] }
  const candidates = data.places || []
  for (const candidate of candidates) {
    const bundle = await mapPlaceToBundle(tenant, candidate, apiKey, true)
    if (bundle.placeId && bundle.verified) {
      return bundle
    }
  }

  return { ...EMPTY_BUNDLE }
}

export async function fetchTenantGooglePlacesBundle(
  tenant: TenantPlacesAddressFields & { google_reviews?: unknown },
  apiKey: string,
): Promise<GooglePlacesBundle> {
  try {
    const confirmedPlaceId = resolveConfirmedPlaceId(tenant, tenant.google_reviews)
    if (confirmedPlaceId) {
      return fetchPlaceById(tenant, confirmedPlaceId, apiKey)
    }

    return fetchPlaceByTextSearch(tenant, apiKey)
  } catch (error) {
    console.error('Error fetching Google Reviews:', error)
    return { ...EMPTY_BUNDLE }
  }
}