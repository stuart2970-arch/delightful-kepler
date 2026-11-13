import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Read from default ".env.test" file.
dotenv.config({ path: path.resolve(__dirname, '.env.test') });

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run test:server',
    url: 'http://localhost:3001',
    reuseExistingServer: false,
    timeout: 120 * 1000,
    env: {
      ...process.env,
      // The pre-push hook and CI give the Playwright process an 8GB heap.
      // Do not hand that same ceiling to the Next server. The signed-out
      // sweep compiles every API route, and two 8GB heaps get the machine
      // killed before the suite finishes.
      NODE_OPTIONS: '--max-old-space-size=4096',
      PLAYWRIGHT_TEST: 'true',
      // STYL-199: existing suites inject mockModelReply. Never set this on production.
      ALLOW_MOCK_REPLY: 'true',
      // High ceiling so the shared test IP is not blocked. Production omits this (default 20).
      AUTH_RATE_LIMIT_PER_IP: process.env.AUTH_RATE_LIMIT_PER_IP || '10000',
      APP_URL: process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001',
      STRIPE_PORTAL_CONFIG_OWNER: process.env.STRIPE_PORTAL_CONFIG_OWNER || 'bpc_test_owner',
      STRIPE_PORTAL_CONFIG_ADMIN: process.env.STRIPE_PORTAL_CONFIG_ADMIN || 'bpc_test_admin',
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'sk_test_mock',
      CRON_SECRET: process.env.CRON_SECRET || 'mock_cron_secret_for_local_testing',
    },
  },
});
