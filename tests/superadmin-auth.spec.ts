import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { createTestSuperadminUser, createTestNormalUser, TestUserSession } from './test-auth-helper';
import { superadminRoutes } from '../scripts/superadmin-routes.mjs';

test.describe('STYL-178: Superadmin Server-Side Authentication & Authorization Hardening', () => {
  let superadminSession: TestUserSession;
  let normalUserSession: TestUserSession;

  const routesConfig = superadminRoutes;

  test.beforeAll(async () => {
    superadminSession = await createTestSuperadminUser();
    normalUserSession = await createTestNormalUser();
  });

  test.afterAll(async () => {
    if (superadminSession) await superadminSession.cleanup();
    if (normalUserSession) await normalUserSession.cleanup();
  });

  test('Proxy guard: /api/superadmin/does-not-exist rejects unauthenticated requests with 401', async ({ request }) => {
    const res = await request.get('/api/superadmin/does-not-exist');
    expect(res.status()).toBe(401);
    const body = await res.json().catch(() => ({}));
    expect(body.error).toBe('Authentication required');
  });

  test('Bearer token verification: garbage token returns 401', async ({ request }) => {
    const res = await request.get('/api/superadmin/tiers', {
      headers: { Authorization: 'Bearer this_is_a_garbage_jwt_token_123' },
    });
    expect(res.status()).toBe(401);
  });

  test('Privilege escalation prevention: normal user cannot set their own is_super_admin flag', async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const authedClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${normalUserSession.token}` } }
    });

    // Attempt to escalate privileges to superadmin
    const { error: updateError } = await authedClient
      .from('profiles')
      .update({ is_super_admin: true })
      .eq('id', normalUserSession.user.id);

    // Trigger should raise an exception and prevent the update
    expect(updateError).toBeDefined();

    // Verify row in database remains is_super_admin: false
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: profile } = await adminClient
      .from('profiles')
      .select('is_super_admin')
      .eq('id', normalUserSession.user.id)
      .single();

    expect(profile?.is_super_admin).toBe(false);
  });

  test('Deny-by-default code audit: all routes in src/app/api/superadmin/ must enforce requireSuperAdmin or withSuperAdmin', () => {
    const superadminDir = path.resolve(__dirname, '../src/app/api/superadmin');
    const getRouteFiles = (dir: string): string[] => {
      let results: string[] = [];
      const list = fs.readdirSync(dir);
      list.forEach((file) => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
          results = results.concat(getRouteFiles(fullPath));
        } else if (file === 'route.ts') {
          results.push(fullPath);
        }
      });
      return results;
    };

    const routeFiles = getRouteFiles(superadminDir);
    expect(routeFiles.length).toBeGreaterThanOrEqual(13);

    for (const filePath of routeFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      const hasHelper =
        content.includes('withSuperAdmin') || content.includes('requireSuperAdmin');
      expect(
        hasHelper,
        `Route ${path.relative(process.cwd(), filePath)} does NOT use withSuperAdmin or requireSuperAdmin!`
      ).toBe(true);
    }
  });

  // Dynamic test matrix driven by scripts/superadmin-routes.json
  for (const entry of routesConfig) {
    for (const method of entry.methods) {
      const isCron = entry.auth === 'cron';
      const isMixed = entry.auth === 'mixed';
      const expectedAuth = isMixed ? entry.methodAuth?.[method] : entry.auth;

      test(`Route Matrix: ${method} ${entry.path} enforces strict auth boundary`, async ({ request }) => {
        const dummyBody = method !== 'GET' ? {} : undefined;
        const optionsForMethod = (token?: string, extraHeaders: Record<string, string> = {}) => {
          const headers: Record<string, string> = { ...extraHeaders };
          if (token) headers['Authorization'] = `Bearer ${token}`;
          if (dummyBody) headers['Content-Type'] = 'application/json';
          return {
            headers,
            data: dummyBody,
          };
        };

        const makeCall = async (token?: string, extraHeaders?: Record<string, string>) => {
          const opts = optionsForMethod(token, extraHeaders);
          switch (method) {
            case 'GET': return request.get(entry.path, opts);
            case 'POST': return request.post(entry.path, opts);
            case 'PATCH': return request.patch(entry.path, opts);
            case 'DELETE': return request.delete(entry.path, opts);
            default: throw new Error(`Unsupported method ${method}`);
          }
        };

        // 1. Unauthenticated call -> MUST return 401
        const unauthRes = await makeCall();
        expect(
          unauthRes.status(),
          `Expected 401 for unauthenticated ${method} ${entry.path}, got ${unauthRes.status()}`
        ).toBe(401);

        if (isCron) {
          // Cron routes require CRON_SECRET or SUPABASE_SERVICE_ROLE_KEY
          const validCronSecret = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
          const cronRes = await makeCall(validCronSecret);
          expect([200, 204]).toContain(cronRes.status());
          return;
        }

        // 2. Normal authenticated user (not superadmin)
        const normalRes = await makeCall(normalUserSession.token);
        if (expectedAuth === 'user') {
          // Allowed for normal logged-in user
          expect(normalRes.status()).not.toBe(401);
          expect(normalRes.status()).not.toBe(403);
        } else {
          // Superadmin required -> MUST return 403 Forbidden
          expect(
            normalRes.status(),
            `Expected 403 for normal user on ${method} ${entry.path}, got ${normalRes.status()}`
          ).toBe(403);
        }

        // 3. Superadmin authenticated user -> MUST pass auth (status NOT 401 and NOT 403)
        // With dummy bodies or non-existent IDs, it may return 200, 400 (validation), or 404 (not found)
        const adminRes = await makeCall(superadminSession.token);
        expect(
          adminRes.status(),
          `Superadmin was rejected with 401/403 on ${method} ${entry.path} (got ${adminRes.status()})`
        ).not.toBe(401);
        expect(
          adminRes.status(),
          `Superadmin was rejected with 401/403 on ${method} ${entry.path} (got ${adminRes.status()})`
        ).not.toBe(403);
      });
    }
  }
});
