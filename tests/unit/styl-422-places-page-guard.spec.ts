import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { POST as tenantCreated } from '../../src/app/api/webhooks/tenant-created/route'
import {
  buildPlacesTextSearchQuery,
  extractPlaceIdFromGoogleMapsInput,
  GOOGLE_PLACES_LOOKUP_COOLDOWN_MS,
  isGooglePlacesLookupCooldownActive,
  readGoogleReviewsCacheMeta,
  resolveConfirmedPlaceId,
  shouldTrustCachedGooglePlaces,
  tenantHasLocationMatchContext,
} from '../../src/lib/google/tenant-places-metadata'
import { fetchTenantGooglePlacesBundle } from '../../src/lib/google/fetch-tenant-google-places'
import {
  UNPUBLISHED_PAGE_ROBOTS_HEADER,
  withUnpublishedRobotsHeaders,
} from '../../src/lib/tenants/public-business-page'

test.describe('STYL-422 tenant Google Places guardrails', () => {
  test('name-only tenant does not build a Places text query', () => {
    const tenant = { company_name: 'Jon James' }
    expect(tenantHasLocationMatchContext(tenant)).toBe(false)
    expect(buildPlacesTextSearchQuery(tenant)).toBeNull()
  })

  test('extracts place_id from Google Maps share URLs', () => {
    const placeId = 'ChIJabc123xyz45'
    expect(
      extractPlaceIdFromGoogleMapsInput(`https://maps.google.com/?q=place&place_id=${placeId}`),
    ).toBe(placeId)
    expect(extractPlaceIdFromGoogleMapsInput(placeId)).toBe(placeId)
  })

  test('cached Places data requires verified flag and matching confirmed place id', () => {
    const tenant = {
      company_name: 'Jon James',
      google_maps_share_url: 'https://maps.google.com/?place_id=ChIJconfirmed1234',
    }
    const trusted = {
      verified: true,
      placeId: 'ChIJconfirmed1234',
      reviews: [{ text: 'Great' }],
    }
    const untrusted = {
      placeId: 'ChIJguess',
      reviews: [{ text: 'Wrong business' }],
    }

    expect(shouldTrustCachedGooglePlaces(tenant, trusted)).toBe(true)
    expect(shouldTrustCachedGooglePlaces(tenant, untrusted)).toBe(false)
    expect(resolveConfirmedPlaceId(tenant, untrusted)).toBe('ChIJconfirmed1234')
  })

  test('rejects verified cache when cached placeId disagrees with Google Maps share URL', () => {
    const tenant = {
      company_name: 'Jon James',
      google_maps_share_url: 'https://maps.google.com/?place_id=ChIJshareurl1234',
    }
    const mismatchedVerifiedCache = {
      verified: true,
      placeId: 'ChIJotherplace99',
      reviews: [{ text: 'Wrong business cached' }],
    }

    expect(shouldTrustCachedGooglePlaces(tenant, mismatchedVerifiedCache)).toBe(false)
  })

  test('lookup cooldown uses last_lookup_at even when cache is not verified', () => {
    const now = Date.now()
    const recent = new Date(now - 60_000).toISOString()
    const stale = new Date(now - GOOGLE_PLACES_LOOKUP_COOLDOWN_MS - 1_000).toISOString()

    expect(isGooglePlacesLookupCooldownActive(readGoogleReviewsCacheMeta({
      verified: false,
      last_lookup_at: recent,
    }), now)).toBe(true)
    expect(isGooglePlacesLookupCooldownActive(readGoogleReviewsCacheMeta({
      verified: false,
      last_lookup_at: stale,
    }), now)).toBe(false)
  })

  test('fetchTenantGooglePlacesBundle skips searchText for name-only tenants', async () => {
    const calls: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response(JSON.stringify({ places: [] }), { status: 200 })
    }) as typeof fetch

    try {
      const result = await fetchTenantGooglePlacesBundle({ company_name: 'Jon James' }, 'test-key')
      expect(result.verified).toBe(false)
      expect(result.reviews).toHaveLength(0)
      expect(calls).toHaveLength(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('does not persist unverified Places search matches from mocked searchText', async () => {
    const calls: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('searchText')) {
        return new Response(
          JSON.stringify({
            places: [
              {
                id: 'places/wrong-business',
                displayName: { text: 'Totally Different Salon' },
                rating: 4.9,
                userRatingCount: 200,
                reviews: [],
                photos: [],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    try {
      const result = await fetchTenantGooglePlacesBundle(
        {
          company_name: 'Jon James',
          trading_address_street: '1 High Street',
          trading_address_city: 'London',
          trading_address_postcode: 'SW1A 1AA',
        },
        'test-key',
      )
      expect(result.verified).toBe(false)
      expect(result.placeId).toBe('')
      expect(calls.some((url) => url.includes('searchText'))).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

test.describe('STYL-422 unpublished business page headers', () => {
  test('unpublished responses include noindex, nofollow robots header', () => {
    expect(UNPUBLISHED_PAGE_ROBOTS_HEADER).toBe('noindex, nofollow')
    const headers = withUnpublishedRobotsHeaders({ 'Access-Control-Allow-Origin': '*' })
    expect(headers['X-Robots-Tag']).toBe('noindex, nofollow')
  })
})

test.describe('STYL-422 metadata route publish gate', () => {
  test('metadata route blocks unpublished tenants with noindex headers', () => {
    const routeSrc = readFileSync(
      join(process.cwd(), 'src/app/api/tenants/[slug]/metadata/route.ts'),
      'utf8',
    )
    expect(routeSrc).toContain('page_published')
    expect(routeSrc).toContain('withUnpublishedRobotsHeaders')
    expect(routeSrc).toContain('fetchTenantGooglePlacesBundle')
    expect(routeSrc).toContain('verified: true')
    expect(routeSrc).toContain('shouldTrustCachedGooglePlaces')
    expect(routeSrc).toContain('last_lookup_at')
    expect(routeSrc).toContain('isGooglePlacesLookupCooldownActive')
  })
})

test.describe('STYL-422 tenant-created publish gate', () => {
  test('tenant-created skips WordPress when page_published is false', async () => {
    const previous = {
      APP_ENV: process.env.APP_ENV,
      NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
      WORDPRESS_SITE_URL: process.env.WORDPRESS_SITE_URL,
      STYLEFLO_WP_CREATE_BUSINESS_TOKEN: process.env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN,
      TENANT_CREATED_WEBHOOK_SECRET: process.env.TENANT_CREATED_WEBHOOK_SECRET,
    }
    const fetches: string[] = []
    const originalFetch = globalThis.fetch

    try {
      process.env.APP_ENV = 'production'
      process.env.NEXT_PUBLIC_ENV = 'production'
      process.env.WORDPRESS_SITE_URL = 'https://wp.example.test'
      process.env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN = 'mock-token'
      process.env.TENANT_CREATED_WEBHOOK_SECRET = 'secret-test'

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        fetches.push(String(input))
        return new Response('{}', { status: 200 })
      }) as typeof fetch

      const req = new NextRequest('http://localhost:3001/api/webhooks/tenant-created', {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret-test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          record: {
            id: 'tenant_unpublished',
            slug: 'draft-slug',
            company_name: 'Draft Co',
            page_published: false,
          },
        }),
      })

      const res = await tenantCreated(req)
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.skipped).toBe(true)
      expect(fetches).toHaveLength(0)
    } finally {
      globalThis.fetch = originalFetch
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})