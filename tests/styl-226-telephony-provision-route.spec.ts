import { test, expect } from '@playwright/test';
import { handleProvisionPost } from '../src/app/api/telephony/provision/route';
import type { ProvisionDeps, ProvisionTwilioClient } from '../src/lib/telephony/provision-flow';

const TENANT = '10000000-0000-0000-0000-000000000002';
const USER = 'user-provision-1';

const SAFE_ENV = {
  VOICE_ENABLED: 'true',
  VAPI_API_KEY: 'safe-test-vapi-private-key',
  NEXT_PUBLIC_VAPI_PUBLIC_KEY: 'safe-test-vapi-public-key',
  VAPI_MASTER_ASSISTANT_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  VAPI_WEBHOOK_SECRET: 'hook-secret',
  APP_URL: 'https://staging.styleflo.ai',
  TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  TWILIO_AUTH_TOKEN: 'twilio-auth-token-for-tests',
  VENDOR_FETCH_TIMEOUT_MS: '40',
} as NodeJS.ProcessEnv;

type Row = Record<string, any>;

function createHarness(opts?: {
  failTenantSave?: boolean;
  throwAfterBuy?: boolean;
  failTwilioRelease?: boolean;
  failVapiDelete?: boolean;
  failMarkActive?: boolean;
  failReserveWith?: { code?: string; message?: string };
  seedPurchase?: Row;
  seedIncoming?: Array<{ sid: string; phoneNumber: string; voiceUrl?: string }>;
  purchaseDelayMs?: number;
}) {
  const purchases: Row[] = [];
  const tenants: Row[] = [{
    id: TENANT,
    has_landline: true,
    has_mobile: false,
    twilio_shadow_number: null,
    twilio_mobile_number: null,
  }];
  const addons: Row[] = [{
    tenant_id: TENANT,
    addon_catalog_id: 'landline_addon',
    is_active: true,
    subscription_status: 'active',
    price_paid_pence: 899,
  }];
  const profiles: Row[] = [{ id: USER, tenant_id: TENANT, is_super_admin: false }];
  const counters = { purchases: 0 };

  function rowsFor(name: string): Row[] {
    if (name === 'tenant_phone_number_purchases') return purchases;
    if (name === 'tenants') return tenants;
    if (name === 'tenant_active_addons') return addons;
    if (name === 'profiles') return profiles;
    return [];
  }

  function rowMatches(row: Row, filters: Array<[string, string, any]>) {
    return filters.every(([op, col, val]) => {
      if (op === 'eq') return row[col] === val;
      if (op === 'in') return Array.isArray(val) && val.includes(row[col]);
      if (op === 'neq') return row[col] != null && row[col] !== val;
      if (op === 'lt') return row[col] < val;
      if (op === 'is') return val === null ? row[col] == null : row[col] === val;
      return true;
    });
  }

  function from(name: string) {
    const filters: Array<[string, string, any]> = [];
    const matched = () => rowsFor(name).filter((row) => rowMatches(row, filters));
    const api: any = {
      select() { return api; },
      eq(column: string, value: string) {
        filters.push(['eq', column, value]);
        return api;
      },
      in(column: string, values: string[]) {
        filters.push(['in', column, values]);
        return api;
      },
      neq(column: string, value: string) {
        filters.push(['neq', column, value]);
        return api;
      },
      is(column: string, value: any) {
        filters.push(['is', column, value]);
        return api;
      },
      then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
        return Promise.resolve({ data: matched(), error: null }).then(resolve, reject);
      },
      async single() {
        return { data: matched()[0] || null, error: null };
      },
      async maybeSingle() {
        return { data: matched()[0] || null, error: null };
      },
      async insert(row: Row) {
        const store = rowsFor(name);
        if (name === 'tenant_phone_number_purchases' && opts?.failReserveWith) {
          return { error: opts.failReserveWith };
        }
        if (name === 'tenant_phone_number_purchases' && store.some((item) => item.tenant_id === row.tenant_id)) {
          return { error: { code: '23505', message: 'duplicate key' } };
        }
        store.push({ created_at: new Date().toISOString(), ...row });
        return { error: null };
      },
      update(row: Row) {
        const updateFilters: Array<[string, string, any]> = [];
        const apply = () => serialized(async () => {
          if (name === 'tenants' && opts?.failTenantSave) {
            return { error: { message: 'save failed' } };
          }
          if (name === 'tenants' && opts?.throwAfterBuy) {
            throw new Error('boom after Twilio buy');
          }
          if (name === 'tenant_phone_number_purchases' && opts?.failMarkActive && row.status === 'active') {
            return { error: { message: 'mark active failed' } };
          }
          const hits = rowsFor(name).filter((item) => rowMatches(item, updateFilters));
          for (const item of hits) Object.assign(item, row);
          return { data: hits, error: null };
        });
        const chain: any = {
          eq(column: string, value: string) {
            updateFilters.push(['eq', column, value]);
            return chain;
          },
          neq(column: string, value: string) {
            updateFilters.push(['neq', column, value]);
            return chain;
          },
          is(column: string, value: any) {
            updateFilters.push(['is', column, value]);
            return chain;
          },
          select: apply,
          then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
            return apply().then(resolve, reject);
          },
        };
        return chain;
      },
      delete() {
        const deleteFilters: Array<[string, string, any]> = [];
        const apply = async () => {
          const store = rowsFor(name);
          const removed: Row[] = [];
          for (let index = store.length - 1; index >= 0; index -= 1) {
            const item = store[index];
            const ok = deleteFilters.every(([op, column, value]) => {
              if (op === 'eq') return item[column] === value;
              if (op === 'neq') return item[column] !== value;
              if (op === 'lt') return item[column] < value;
              return true;
            });
            if (ok) {
              removed.unshift(store[index]);
              store.splice(index, 1);
            }
          }
          return { data: removed, error: null };
        };
        const chain: any = {
          eq(column: string, value: string) {
            deleteFilters.push(['eq', column, value]);
            return chain;
          },
          neq(column: string, value: string) {
            deleteFilters.push(['neq', column, value]);
            return chain;
          },
          lt(column: string, value: string) {
            deleteFilters.push(['lt', column, value]);
            return chain;
          },
          select: apply,
          then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
            return apply().then(resolve, reject);
          },
        };
        return chain;
      },
    };
    return api;
  }

  const supabase = { from };

  let writeLock = Promise.resolve();
  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = writeLock.then(work, work);
    writeLock = run.then(() => undefined, () => undefined);
    return run;
  }

  const incomingList: Array<{ sid: string; phoneNumber: string; voiceUrl?: string }> = [
    ...(opts?.seedIncoming || []),
  ];
  const inflightCreates = new Map<string, Promise<{ sid: string; phoneNumber: string; voiceUrl?: string }>>();
  const incoming = ((sid: string) => ({
    remove: async () => {
      if (opts?.failTwilioRelease) throw new Error('release failed');
      return { sid };
    },
  })) as ProvisionTwilioClient['incomingPhoneNumbers'];
  (incoming as any).list = async (params?: { phoneNumber?: string; limit?: number }) => {
    const filtered = params?.phoneNumber
      ? incomingList.filter((item) => item.phoneNumber === params.phoneNumber)
      : incomingList.slice();
    return params?.limit ? filtered.slice(0, params.limit) : filtered;
  };
  (incoming as any).create = async (params: { phoneNumber?: string; voiceUrl?: string }) => {
    const phoneNumber = params?.phoneNumber || '+441234567890';
    const owned = incomingList.find((item) => item.phoneNumber === phoneNumber);
    if (owned) return owned;
    const pending = inflightCreates.get(phoneNumber);
    if (pending) return pending;
    counters.purchases += 1;
    const purchased = {
      sid: `PN${counters.purchases}`,
      phoneNumber,
      voiceUrl: params?.voiceUrl,
    };
    const delay = opts?.purchaseDelayMs || 0;
    const work = !delay
      ? Promise.resolve().then(() => {
          incomingList.push(purchased);
          return purchased;
        })
      : new Promise<{ sid: string; phoneNumber: string; voiceUrl?: string }>((resolve) => {
          setTimeout(() => {
            incomingList.push(purchased);
            resolve(purchased);
          }, delay);
        });
    inflightCreates.set(phoneNumber, work);
    return work.finally(() => inflightCreates.delete(phoneNumber));
  };

  const client: ProvisionTwilioClient = {
    availablePhoneNumbers: () => ({
      mobile: { list: async () => [{ phoneNumber: '+447700900001' }] },
      local: { list: async () => [{ phoneNumber: '+441234567890' }] },
    }),
    incomingPhoneNumbers: incoming,
  };

  if (opts?.seedPurchase) {
    purchases.push({ ...opts.seedPurchase });
  }

  const fetchImpl: typeof fetch = async (url, init) => {
    if (init?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const target = String(url);
    if (target.includes('/org')) {
      return new Response(JSON.stringify({ id: 'org' }), { status: 200 });
    }
    if (target.endsWith('/phone-number') && (init?.method || 'GET') === 'POST') {
      return new Response(JSON.stringify({ id: 'vapiphone_1' }), { status: 200 });
    }
    if (target.includes('/phone-number/') && init?.method === 'DELETE') {
      if (opts?.failVapiDelete) return new Response('no', { status: 500 });
      return new Response('', { status: 200 });
    }
    return new Response('no', { status: 404 });
  };

  const deps: ProvisionDeps = {
    env: SAFE_ENV,
    fetchImpl,
    getUser: async () => ({ id: USER }),
    userSupabase: supabase as any,
    adminSupabase: supabase as any,
    createTwilio: () => client,
  };

  return { deps, purchases, counters };
}

function provisionRequest() {
  return new Request('http://localhost:3001/api/telephony/provision', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer test' },
    body: JSON.stringify({ tenant_id: TENANT }),
  });
}

test.describe('STYL-226: provision route with mocked Twilio and Vapi', () => {
  test('concurrent requests buy only one Twilio number', async () => {
    const { deps, counters, purchases } = createHarness();
    const [first, second] = await Promise.all([
      handleProvisionPost(provisionRequest(), deps),
      handleProvisionPost(provisionRequest(), deps),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(counters.purchases).toBe(1);
    expect(purchases.filter((row) => row.status === 'active')).toHaveLength(1);
  });

  test('failed tenant save releases the Twilio number and removes it from Vapi', async () => {
    const { deps, purchases } = createHarness({ failTenantSave: true });
    const res = await handleProvisionPost(provisionRequest(), deps);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/released/i);
    expect(body.error).not.toMatch(/was NOT released/i);
    expect(purchases).toHaveLength(0);
  });

  test('failed Twilio release returns an honest error and records an orphan', async () => {
    const { deps, purchases } = createHarness({ failTenantSave: true, failTwilioRelease: true });
    const res = await handleProvisionPost(provisionRequest(), deps);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/was NOT released/i);
    expect(body.error).toMatch(/PN1/);
    expect(purchases).toHaveLength(1);
    expect(purchases[0].status).toBe('orphan');
    expect(purchases[0].twilio_sid).toBe('PN1');
  });

  test('non-unique reservation errors return 500, not 409', async () => {
    const { deps, counters } = createHarness({
      failReserveWith: { code: '42501', message: 'permission denied' },
    });
    const res = await handleProvisionPost(provisionRequest(), deps);
    expect(res.status).toBe(500);
    expect(counters.purchases).toBe(0);
    const body = await res.json();
    expect(body.error).toMatch(/permission denied|Failed to reserve/i);
  });

  test('stale pending reservations older than 10 minutes can be reclaimed', async () => {
    const { deps, counters, purchases } = createHarness({
      seedPurchase: {
        tenant_id: TENANT,
        status: 'pending',
        created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      },
    });
    const res = await handleProvisionPost(provisionRequest(), deps);
    expect(res.status).toBe(200);
    expect(counters.purchases).toBe(1);
    expect(purchases.filter((row) => row.status === 'active')).toHaveLength(1);
  });

  test('fresh pending reservations still block a second buy', async () => {
    const { deps, counters } = createHarness({
      seedPurchase: {
        tenant_id: TENANT,
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    });
    const res = await handleProvisionPost(provisionRequest(), deps);
    expect(res.status).toBe(409);
    expect(counters.purchases).toBe(0);
  });

  test('unexpected throw after Twilio buy unwinds the paid number', async () => {
    const { deps, purchases } = createHarness({ throwAfterBuy: true });
    const res = await handleProvisionPost(provisionRequest(), deps);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/boom after Twilio buy/i);
    expect(body.error).toMatch(/released/i);
    expect(purchases).toHaveLength(0);
  });

  test('failed Vapi delete during unwind is reported and recorded as an orphan', async () => {
    const { deps, purchases } = createHarness({ failTenantSave: true, failVapiDelete: true });
    const res = await handleProvisionPost(provisionRequest(), deps);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Vapi delete failed/i);
    expect(purchases).toHaveLength(1);
    expect(purchases[0].status).toBe('orphan');
  });

  test('Twilio purchase timeout that later succeeds does not buy a second number on retry', async () => {
    const { deps, counters, purchases } = createHarness({
      purchaseDelayMs: 80,
      seedIncoming: [{
        sid: 'PNOTHER',
        phoneNumber: '+449999999999',
        voiceUrl: 'http://localhost:3001/api/telephony/inbound',
      }],
    });
    const first = await handleProvisionPost(provisionRequest(), deps);
    expect(first.status).toBe(504);
    expect(purchases[0].status).toBe('unknown');
    expect(purchases[0].phone_number).toBe('+441234567890');
    expect(counters.purchases).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const second = await handleProvisionPost(provisionRequest(), deps);
    expect(second.status).toBe(200);
    expect(counters.purchases).toBe(1);
    const body = await second.json();
    expect(body.number).toBe('+441234567890');
    expect(purchases.filter((row) => row.status === 'active')).toHaveLength(1);
  });

  test('concurrent unknown retries claim once and do not buy another number', async () => {
    const { deps, counters, purchases } = createHarness({
      seedPurchase: {
        tenant_id: TENANT,
        status: 'unknown',
        phone_number: '+441234567890',
        created_at: new Date().toISOString(),
      },
      seedIncoming: [{
        sid: 'PN1',
        phoneNumber: '+441234567890',
        voiceUrl: 'http://localhost:3001/api/telephony/inbound',
      }, {
        sid: 'PNOTHER',
        phoneNumber: '+449999999999',
        voiceUrl: 'http://localhost:3001/api/telephony/inbound',
      }],
    });
    const [first, second] = await Promise.all([
      handleProvisionPost(provisionRequest(), deps),
      handleProvisionPost(provisionRequest(), deps),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(counters.purchases).toBe(0);
    expect(purchases.filter((row) => row.status === 'active')).toHaveLength(1);
  });

  test('mark-active failure is reported without releasing a saved number', async () => {
    const { deps, purchases } = createHarness({ failMarkActive: true });
    const res = await handleProvisionPost(provisionRequest(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.number).toBe('+441234567890');
    expect(body.warning).toMatch(/could not be marked active/i);
    expect(purchases[0].status).toBe('pending');
  });
});
