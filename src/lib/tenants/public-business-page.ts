export const UNPUBLISHED_PAGE_ROBOTS_HEADER = 'noindex, nofollow'

export const unpublishedPageHeaders = (): Record<string, string> => ({
  'X-Robots-Tag': UNPUBLISHED_PAGE_ROBOTS_HEADER,
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
})

export const withUnpublishedRobotsHeaders = (
  headers: Record<string, string>,
): Record<string, string> => ({
  ...headers,
  ...unpublishedPageHeaders(),
})