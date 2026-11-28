/**
 * Playwright workers may not inherit .env.test. Direct imports of route handlers
 * (not HTTP through test:server) still need signature bypass in test mode.
 */
if ((process.env.PLAYWRIGHT_TEST || '').trim() !== 'true') {
  process.env.PLAYWRIGHT_TEST = 'true';
}