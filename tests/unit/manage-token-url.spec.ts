import { test, expect } from '@playwright/test'
import { manageBookingUrl } from '../../src/lib/booking/manage-token'

test('manageBookingUrl is an absolute URL', () => {
  const url = manageBookingUrl('test-token-value', {
    ...process.env,
    NEXT_PUBLIC_APP_URL: 'http://localhost:3001',
  })
  expect(url.startsWith('http://localhost:3001/booking/manage?token=')).toBe(true)
})