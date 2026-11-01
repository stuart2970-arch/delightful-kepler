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
} as NodeJS.ProcessEnv;

type Row = Record<string, any>;

function createHarness(opts?: { failTenantSave?: boolean; failTwilioRelease?: boolean }) {
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

  function from(name: string) {
    const filters: Array<[string, string, any]> = [];
    const matched = () => rowsFor(name).filter((row) => filters.every(([op, col, val]) => (
      op === 'eq' ? row[col] === val : val.includes(row[col])
    )));
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
      then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
        return Promise.resolve({ data: matched(), error: null }).then(resolve, reject);
      },
      async single() {
        return { data: matched()[0] || null, error: null };
      },
      async insert(row: Row) {
        const store = rowsFor(name);
        if (name === 'tenant_phone_number_purchases' && store.some((item) => item.tenant_id === row.tenant_id)) {
          return { error: { code: '23505', message: 'duplicate key' } };
        }
        store.push({ ...row });
        return { error: null };
      },
      update(row: Row) {
        return {
          async eq(column: string, value: string) {
            if (name === 'tenants' && opts?.failTenantSave) {
              return { error: { message: 'save failed' } };
            }
            for (const item of rowsFor(name)) {
              if (item[column] === value) Object.assign(item, row);
            }
            return { error: null };
          },
        };
      },
      delete() {
        return {
          async eq(column: string, value: string) {
            const store = rowsFor(name);
            const index = store.findIndex((item) => item[column] === value);
            if (index >= 0) store.splice(index, 1);
            return { error: null };
          },
        };
      },
    };
    return api;
  }

  const supabase = { from };

  const incoming = ((sid: string) => ({
    remove: async () => {
      if (opts?.failTwilioRelease) throw new Error('release failed');
      return { sid };
    },
  })) as ProvisionTwilioClient['incomingPhoneNumbers'];
  (incoming as any).create = async () => {
    counters.purchases += 1;
    return { sid: `PN${counters.purchases}`, phoneNumber: '+441234567890' };
  };

  const client: ProvisionTwilioClient = {
    availablePhoneNumbers: () => ({
      mobile: { list: async () => [{ phoneNumber: '+447700900001' }] },
      local: { list: async () => [{ phoneNumber: '+441234567890' }] },
    }),
    incomingPhoneNumbers: incoming,
  };

  const fetchImpl: typeof fetch = async (url, init) => {
    const target = String(url);
    if (target.includes('/org')) {
      return new Response(JSON.stringify({ id: 'org' }), { status: 200 });
    }
    if (target.endsWith('/phone-number') && (init?.method || 'GET') === 'POST') {
      return new Response(JSON.stringify({ id: 'vapiphone_1' }), { status: 200 });
    }
    if (target.includes('/phone-number/') && init?.method === 'DELETE') {
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
});
