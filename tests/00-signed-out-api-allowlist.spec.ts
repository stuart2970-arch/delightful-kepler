import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

// Named 00- so this sweep runs first and compiles every API route while the
// Next server still has room.

/**
 * Signed-out callers must get 401 or 403 from every API route unless it is
 * listed here. Add a route only when it is meant to answer without a
 * dashboard session.
 *
 * Webhooks and inbound vendor traffic:
 *   /api/webhooks/**, /api/twilio/sms-inbound, /api/telephony/inbound, /api/openclaw/webhook
 * Public widget, chat, and voice:
 *   /api/chat/public-init, /api/chat/stream, /api/chatbots, /api/chatbots/[id] GET,
 *   /api/voice/** 
 * Health is not a separate route today.
 * Other signed-out product surfaces (auth, public booking, register prices,
 * compliance, referral tracking, OAuth redirects, public business pages):
 *   listed individually below.
 *
 * Routes that are still open on staging and owned by other launch PRs are
 * listed under KNOWN_OPEN so a brand-new unsigned route still fails this test.
 */
const PUBLIC_PREFIXES = [
  '/api/webhooks/',
  '/api/twilio/sms-inbound',
  '/api/telephony/inbound',
  '/api/openclaw/webhook',
  '/api/chat/public-init',
  '/api/chat/stream',
  '/api/voice/',
];

const PUBLIC_EXACT = new Set([
  'GET /api/chatbots/00000000-0000-0000-0000-000000000099',
  'POST /api/chatbots',
  'POST /api/chatbots/upload-avatar',
  'POST /api/auth/magic-link',
  'POST /api/auth/check-email',
  'GET /api/auth/microsoft/login',
  'GET /api/auth/microsoft/callback',
  'GET /api/integrations/google/authorize',
  'GET /api/integrations/google/callback',
  'GET /api/integrations/microsoft/authorize',
  'GET /api/integrations/microsoft/callback',
  'GET /api/data-deletion',
  'POST /api/data-deletion',
  'GET /api/track',
  'GET /api/billing/prices',
  'GET /api/billing/addons',
  'GET /api/billing/session-details',
  // Plan signup starts before a salon session exists. POST stays authenticated.
  'GET /api/billing/checkout',
  'POST /api/v3/CheckAvailability',
  'POST /api/v3/CreateBooking',
  'GET /api/rwg/feeds/availability',
  'GET /api/rwg/feeds/services',
  'GET /api/rwg/feeds/merchants',
  'GET /api/rwg/feeds/cron',
  'GET /api/tenants/check-slug',
  'GET /api/tenants/00000000-0000-0000-0000-000000000099/metadata',
  'GET /api/products/metadata',
  'POST /api/telephony/sms',
]);

/** Remove these as STYL-287, STYL-288 and STYL-289 land on staging. */
const KNOWN_OPEN = new Set([
  'GET /api/conversations',
  'GET /api/messages',
  'PATCH /api/tenants/settings',
  'POST /api/tenants/publish-page',
  'GET /api/services',
  'POST /api/services',
  'PUT /api/services',
  'DELETE /api/services',
  'GET /api/integrations/google/status',
  'DELETE /api/integrations/google/status',
  'GET /api/integrations/microsoft/status',
  'DELETE /api/integrations/microsoft/status',
  'GET /api/integrations/meta/settings',
  'PATCH /api/integrations/meta/settings',
  'GET /api/staff/me',
  'PATCH /api/staff/me',
  'POST /api/telephony/search',
  'POST /api/telephony/provision',
  'POST /api/ingest/shopify/analyze',
  'POST /api/gdpr/forget',
  'GET /api/gdpr/whatsapp-purge',
  'POST /api/gdpr/whatsapp-purge',
  'GET /api/whatsapp/verification-code',
  'GET /api/whatsapp/onboard',
  'POST /api/whatsapp/onboard',
  'DELETE /api/whatsapp/onboard',
  'POST /api/chatbots',
  'PATCH /api/chatbots/00000000-0000-0000-0000-000000000099',
  'DELETE /api/chatbots/00000000-0000-0000-0000-000000000099',
]);

function isAllowed(method: string, routePath: string): boolean {
  const key = `${method} ${routePath}`;
  if (PUBLIC_EXACT.has(key) || KNOWN_OPEN.has(key)) return true;
  return PUBLIC_PREFIXES.some((prefix) => routePath.startsWith(prefix));
}

function discoverRoutes(): { method: string; routePath: string }[] {
  const root = path.join(process.cwd(), 'src/app/api');
  const found: { method: string; routePath: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'route.ts') {
        const text = fs.readFileSync(full, 'utf8');
        const rel = path.relative(path.join(process.cwd(), 'src/app'), full).replace(/\\/g, '/').replace(/\/route\.ts$/, '');
        const routePath = `/${rel}`.replace(/\[[^\]]+\]/g, '00000000-0000-0000-0000-000000000099');
        for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
          if (new RegExp(`export\\s+(?:async\\s+function|const)\\s+${method}\\b`).test(text)) {
            found.push({ method, routePath });
          }
        }
      }
    }
  };
  walk(root);
  return found;
}

test('signed-out API routes are 401 or 403 unless they are on the allow-list', async ({ request }) => {
  test.setTimeout(300_000);
  const unexpected: string[] = [];
  for (const route of discoverRoutes()) {
    if (isAllowed(route.method, route.routePath)) continue;
    const response = await request.fetch(route.routePath, {
      method: route.method,
      headers: { 'Content-Type': 'application/json' },
      data: route.method === 'GET' ? undefined : {},
      timeout: 60_000,
    });
    if (response.status() !== 401 && response.status() !== 403) {
      unexpected.push(`${route.method} ${route.routePath} -> ${response.status()}`);
    }
  }
  expect(unexpected, unexpected.join('\n')).toEqual([]);
});
