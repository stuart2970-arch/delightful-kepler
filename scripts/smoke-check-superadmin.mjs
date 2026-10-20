import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { superadminRoutes } from './superadmin-routes.mjs';

const appUrl = (process.argv[2] || process.env.APP_URL || '').replace(/\/$/, '');
if (!appUrl) {
  console.error('::error::Missing target APP_URL argument or env variable.');
  process.exit(1);
}

const routes = superadminRoutes;

console.log(`[Smoke Check] Verifying unauthenticated lockdown across ${routes.length} route configurations against ${appUrl}...`);

let failures = 0;
let totalChecks = 0;

for (const entry of routes) {
  for (const method of entry.methods) {
    totalChecks++;
    const targetUrl = `${appUrl}${entry.path}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (method !== 'GET') {
      options.body = JSON.stringify({});
    }

    try {
      const response = await fetch(targetUrl, options);
      const status = response.status;

      // Acceptance criterion: Every admin route without login MUST return 401 (or 405 for unexported method)
      if (status !== 401 && status !== 405) {
        console.error(`::error::SECURITY FAILURE: ${method} ${entry.path} returned HTTP ${status} without login! (Expected 401)`);
        failures++;
      } else {
        console.log(`PASS: ${method} ${entry.path} returned ${status}`);
      }
    } catch (err) {
      console.error(`::error::Network error probing ${method} ${entry.path}: ${err.message}`);
      failures++;
    }
  }
}

console.log(`[Smoke Check] Completed ${totalChecks} endpoint probes. Failures: ${failures}`);

if (failures > 0) {
  console.error(`::error::Post-deploy superadmin smoke check FAILED with ${failures} vulnerabilities detected!`);
  process.exit(1);
} else {
  console.log('[Smoke Check] ALL superadmin routes are strictly locked down (100% 401/405).');
  process.exit(0);
}
