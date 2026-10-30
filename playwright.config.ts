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
      PLAYWRIGHT_TEST: 'true',
      // High ceiling so the shared test IP is not blocked. Production omits this (default 20).
      AUTH_RATE_LIMIT_PER_IP: process.env.AUTH_RATE_LIMIT_PER_IP || '10000',
    },
  },
});
