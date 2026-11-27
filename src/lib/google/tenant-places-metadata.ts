export type TenantPlacesAddressFields = {
  company_name?: string | null
  rwg_business_name?: string | null
  trading_address_street?: string | null
  business_address?: string | null
  trading_address_city?: string | null
  trading_address_postcode?: string | null
  postcode?: string | null
  latitude?: number | null
  longitude?: number | null
  google_maps_share_url?: string | null
}

export type TenantGoogleReviewsCache = {
  placeId?: string
  verified?: boolean
  reviews?: unknown[]
  photos?: unknown[]
  last_updated?: string
}

const PLACE_ID_INLINE = /^(ChIJ|GhIJ)[a-zA-Z0-9_-]{10,}$/

export const normalizeBusinessToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '')

export const extractPlaceIdFromGoogleMapsInput = (input: string | null | undefined): string | null => {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null
  if (PLACE_ID_INLINE.test(trimmed)) return trimmed

  const paramMatch = trimmed.match(/[?&]place_id=([^&]+)/)
  if (paramMatch?.[1]) {
    try {
      return decodeURIComponent(paramMatch[1])
    } catch {
      return paramMatch[1]
    }
  }

  const pathMatch = trimmed.match(/place_id:([a-zA-Z0-9_-]+)/)
  if (pathMatch?.[1]) return pathMatch[1]

  return null
}

export const tenantBusinessDisplayName = (tenant: TenantPlacesAddressFields): string =>
  (tenant.rwg_business_name || tenant.company_name || '').trim()

export const tenantHasLocationMatchContext = (tenant: TenantPlacesAddressFields): boolean => {
  const street = (tenant.trading_address_street || tenant.business_address || '').trim()
  const city = (tenant.trading_address_city || '').trim()
  const postcode = (tenant.trading_address_postcode || tenant.postcode || '').trim()
  const hasStreet = street.length > 0
  const hasCityPostcode = city.length > 0 && postcode.length > 0
  const hasLatLng =
    typeof tenant.latitude === 'number'
    && typeof tenant.longitude === 'number'
    && !Number.isNaN(tenant.latitude)
    && !Number.isNaN(tenant.longitude)
  return hasStreet || hasCityPostcode || hasLatLng
}

export const businessNamesMatch = (left: string, right: string): boolean => {
  const a = normalizeBusinessToken(left)
  const b = normalizeBusinessToken(right)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

export const buildPlacesTextSearchQuery = (tenant: TenantPlacesAddressFields): string | null => {
  const name = tenantBusinessDisplayName(tenant)
  const street = (tenant.trading_address_street || tenant.business_address || '').trim()
  const city = (tenant.trading_address_city || '').trim()
  const postcode = (tenant.trading_address_postcode || tenant.postcode || '').trim()

  if (!tenantHasLocationMatchContext(tenant)) {
    return null
  }

  const parts = [name, street, city, postcode].filter((part) => part.length > 0)
  if (parts.length <= 1) return null
  return parts.join(', ')
}

export const resolveConfirmedPlaceId = (
  tenant: TenantPlacesAddressFields,
  googleReviews: unknown,
): string | null => {
  const fromUrl = extractPlaceIdFromGoogleMapsInput(tenant.google_maps_share_url)
  if (fromUrl) return fromUrl

  if (googleReviews && typeof googleReviews === 'object' && !Array.isArray(googleReviews)) {
    const cache = googleReviews as TenantGoogleReviewsCache
    if (cache.verified === true && typeof cache.placeId === 'string' && cache.placeId.trim()) {
      return cache.placeId.trim()
    }
  }

  return null
}

export const shouldTrustCachedGooglePlaces = (
  tenant: TenantPlacesAddressFields,
  googleReviews: unknown,
): boolean => {
  if (!googleReviews || typeof googleReviews !== 'object' || Array.isArray(googleReviews)) {
    return false
  }
  const cache = googleReviews as TenantGoogleReviewsCache
  if (cache.verified !== true) return false
  if (typeof cache.placeId !== 'string' || !cache.placeId.trim()) return false
  const confirmed = resolveConfirmedPlaceId(tenant, googleReviews)
  return Boolean(confirmed)
}

export const matchPlaceToTenant = (
  placeDisplayName: string,
  tenant: TenantPlacesAddressFields,
): boolean => {
  const expectedName = tenantBusinessDisplayName(tenant)
  if (!expectedName) return false
  return businessNamesMatch(expectedName, placeDisplayName)
}