import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { addonActivateStatusFields, stripeStatusToAddonStatus } from '../src/lib/billing/addon-subscription-status';
import { handleStripeBillingEvent } from '../src/lib/billing/process-stripe-webhook';
import {
  dueFailedPaymentTransitions,
  elapsedFailedPaymentDays,
  FAILED_PAYMENT_CANCEL_AFTER_DAYS,
  FAILED_PAYMENT_DAY_MS,
  FAILED_PAYMENT_PAUSE_AFTER_DAYS,
} from '../src/lib/billing/failed-payment/evaluate';
import type { FailedPaymentTransitionEvent } from '../src/lib/billing/failed-payment/hook';
import { isFailedPaymentFlowEnabled } from '../src/lib/billing/failed-payment/flag';
import { runFailedPaymentSweep } from '../src/lib/billing/failed-payment/machine';
import { isFailedPaymentSweepAuthorized } from '../src/lib/billing/failed-payment/sweep-auth';
import {
  addBillingInterval,
  createFailedPaymentStripeClient,
  createFailedPaymentStripeClientFromEnv,
  FAILED_PAYMENT_CANCEL_PARAMS,
  FAILED_PAYMENT_PAUSE_PARAMS,
  failedPaymentRestartParams,
  isInvoiceAlreadyWrittenOff,
  setFailedPaymentStripeClientForTests,
} from '../src/lib/billing/failed-payment/stripe-client';
import type { FailedPaymentStripeGateway } from '../src/lib/billing/failed-payment/stripe-client';
import { POST as sweepPost } from '../src/app/api/billing/failed-payment-sweep/route';

const root = process.cwd();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TENANT = '27400000-0000-4000-8000-000000000274';
const DAY = FAILED_PAYMENT_DAY_MS;

type StripeCalls = {
  pause: Array<{ id: string; params: unknown }>;
  restart: Array<{ id: string; params: unknown }>;
  cancel: Array<{ id: string; params: unknown }>;
  writeOff: string[];
  invoiceCreates: unknown[];
  retrieves: string[];
};

function monthlySubscription() {
  return {
    items: {
      data: [{ price: { recurring: { interval: 'month', interval_count: 1 } } }],
    },
  };
}

function trackingStripe() {
  const calls: StripeCalls = {
    pause: [],
    restart: [],
    cancel: [],
    writeOff: [],
    invoiceCreates: [],
    retrieves: [],
  };
  const gateway: FailedPaymentStripeGateway = {
    subscriptions: {
      async retrieve(id) {
        calls.retrieves.push(id);
        return monthlySubscription();
      },
      async update(id, params) {
        const pause = params.pause_collection;
        if (pause && typeof pause === 'object' && pause.behavior === 'void') {
          calls.pause.push({ id, params });
        } else {
          calls.restart.push({ id, params });
        }
        return {};
      },
      async cancel(id, params) {
        calls.cancel.push({ id, params });
        return {};
      },
    },
    invoices: {
      async markUncollectible(id) {
        calls.writeOff.push(id);
        return {};
      },
      async create(params) {
        calls.invoiceCreates.push(params ?? null);
        return {};
      },
    },
  };
  return { client: createFailedPaymentStripeClient(gateway), calls };
}

function adminClient(): SupabaseClient {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureTenant(admin: SupabaseClient) {
  const { data } = await admin.from('tenants').select('id').eq('id', TENANT).maybeSingle();
  if (!data) {
    const { error } = await admin.from('tenants').insert({
      id: TENANT,
      tenant_id: TENANT,
      company_name: 'Harbour Studio',
      slug: 'harbour-studio-274',
      plan_tier: 'foundation',
      is_active: true,
      subscription_status: 'active',
    });
    if (error) throw new Error(error.message);
  }
  const { error: restoreError } = await admin
    .from('tenants')
    .update({ is_active: true, subscription_status: 'active' })
    .eq('id', TENANT);
  if (restoreError) throw new Error(restoreError.message);
}

async function cleanup(admin: SupabaseClient) {
  await admin.from('failed_payment_cases').delete().eq('tenant_id', TENANT);
  await admin.from('stripe_webhook_processed_events').delete().like('event_id', 'evt_styl274%');
  await admin
    .from('tenants')
    .update({ is_active: true, subscription_status: 'active' })
    .eq('id', TENANT);
}

test.describe('STYL-274 failed-payment day count', () => {
  const failedAt = '2026-01-01T00:00:00.000Z';
  const start = new Date(failedAt);

  test('days 0 to 6 only record the failure', () => {
    const snapshot = {
      status: 'past_due' as const,
      firstFailedAt: failedAt,
      pausedAt: null,
      restartedAt: null,
      cancelledAt: null,
      writtenOffInvoiceId: null,
      paidAt: null,
    };
    expect(elapsedFailedPaymentDays(start, start)).toBe(0);
    expect(dueFailedPaymentTransitions(snapshot, start)).toEqual([]);
    expect(dueFailedPaymentTransitions(snapshot, new Date(start.getTime() + 6 * DAY))).toEqual([]);
    expect(FAILED_PAYMENT_PAUSE_AFTER_DAYS).toBe(7);
    expect(FAILED_PAYMENT_CANCEL_AFTER_DAYS).toBe(37);
  });

  test('day 7 pauses and day 37 cancels and writes off', () => {
    const open = {
      status: 'past_due' as const,
      firstFailedAt: failedAt,
      pausedAt: null,
      restartedAt: null,
      cancelledAt: null,
      writtenOffInvoiceId: null,
      paidAt: null,
    };
    expect(dueFailedPaymentTransitions(open, new Date(start.getTime() + 7 * DAY))).toEqual(['pause']);
    expect(dueFailedPaymentTransitions(open, new Date(start.getTime() + 36 * DAY))).toEqual(['pause']);
    expect(dueFailedPaymentTransitions(open, new Date(start.getTime() + 37 * DAY))).toEqual([
      'pause',
      'cancel',
      'write_off',
    ]);

    const paused = { ...open, status: 'paused' as const, pausedAt: '2026-01-08T00:00:00.000Z' };
    expect(dueFailedPaymentTransitions(paused, new Date(start.getTime() + 37 * DAY))).toEqual([
      'cancel',
      'write_off',
    ]);
    expect(dueFailedPaymentTransitions(
      { ...paused, status: 'restarted', restartedAt: '2026-01-10T00:00:00.000Z' },
      new Date(start.getTime() + 37 * DAY),
    )).toEqual([]);
    expect(dueFailedPaymentTransitions(
      { ...open, status: 'recovered' },
      new Date(start.getTime() + 37 * DAY),
    )).toEqual([]);
    expect(dueFailedPaymentTransitions(
      { ...paused, paidAt: '2026-01-10T00:00:00.000Z' },
      new Date(start.getTime() + 37 * DAY),
    )).toEqual([]);
  });
});

test.describe('STYL-274 migration and Stripe test-mode calls', () => {
  test('migration is additive, idempotent, and does not loosen RLS', () => {
    const sql = readFileSync(
      join(root, 'supabase/migrations/20261123100000_styl274_failed_payment_state.sql'),
      'utf8',
    );
    expect(sql).toContain('paid_at timestamptz');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS paid_at');
    expect(sql).toContain('failed_payment_cases');
    expect(sql).toContain('failed_payment_transitions');
    expect(sql).toContain('CONSTRAINT failed_payment_cases_invoice_key UNIQUE (stripe_invoice_id)');
    expect(sql).toContain('CONSTRAINT failed_payment_transitions_key UNIQUE (idempotency_key)');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.failed_payment_cases FROM PUBLIC, anon, authenticated/);
    expect(sql).toContain('claim_failed_payment_transition');
    expect(sql).toContain('SET search_path = public, pg_temp');
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/TO anon|TO authenticated/);
  });

  test('pause, restart, cancel, and write-off use Stripe test-mode semantics', async () => {
    const { client, calls } = trackingStripe();
    const restartedAt = new Date('2026-05-11T00:00:00.000Z');
    await client.pauseCollection('sub_274');
    await client.restartBilling('sub_274', restartedAt);
    await client.cancelSubscription('sub_274');
    await client.writeOffInvoice('in_274');

    expect(calls.pause[0]).toEqual({ id: 'sub_274', params: FAILED_PAYMENT_PAUSE_PARAMS });
    expect(FAILED_PAYMENT_PAUSE_PARAMS.pause_collection).toEqual({ behavior: 'void' });
    const trialEnd = Math.floor(addBillingInterval(restartedAt, 'month', 1).getTime() / 1000);
    expect(calls.restart[0]).toEqual({ id: 'sub_274', params: failedPaymentRestartParams(trialEnd) });
    expect(calls.restart[0].params).not.toHaveProperty('billing_cycle_anchor');
    expect(calls.invoiceCreates).toEqual([]);
    expect(calls.retrieves).toEqual(['sub_274']);
    expect(new Date(trialEnd * 1000).toISOString()).toBe('2026-06-11T00:00:00.000Z');
    expect(calls.cancel[0]).toEqual({ id: 'sub_274', params: FAILED_PAYMENT_CANCEL_PARAMS });
    expect(calls.writeOff).toEqual(['in_274']);
  });

  test('an already written-off invoice is a successful write-off and a live key is refused', async () => {
    const gateway: FailedPaymentStripeGateway = {
      subscriptions: {
        async retrieve() { return monthlySubscription(); },
        async update() { return {}; },
        async cancel() {
          throw Object.assign(new Error('already canceled'), { code: 'resource_missing' });
        },
      },
      invoices: {
        async markUncollectible() {
          throw Object.assign(new Error('Invoice is already uncollectible'), { code: 'invoice_already_uncollectible' });
        },
      },
    };
    const client = createFailedPaymentStripeClient(gateway);
    await expect(client.cancelSubscription('sub_gone')).resolves.toBeUndefined();
    await expect(client.writeOffInvoice('in_done')).resolves.toBeUndefined();
    expect(isInvoiceAlreadyWrittenOff({ code: 'invoice_already_uncollectible' })).toBe(true);

    const refusing: FailedPaymentStripeGateway = {
      subscriptions: {
        async retrieve() { return monthlySubscription(); },
        async update() { return {}; },
        async cancel() { return {}; },
      },
      invoices: {
        async markUncollectible() {
          throw new Error('network down');
        },
      },
    };
    await expect(createFailedPaymentStripeClient(refusing).writeOffInvoice('in_open')).rejects.toThrow('network down');
    expect(() => createFailedPaymentStripeClientFromEnv({
      STRIPE_SECRET_KEY: 'sk_live_secret',
      PLAYWRIGHT_TEST: 'true',
    })).toThrow(/test-mode/);
    expect(() => createFailedPaymentStripeClientFromEnv({ STRIPE_SECRET_KEY: '' })).toThrow(/secret key/);
    expect(() => createFailedPaymentStripeClientFromEnv({
      STRIPE_SECRET_KEY: 'sk_live_example',
      PLAYWRIGHT_TEST: '',
    })).not.toThrow();
    expect(isFailedPaymentFlowEnabled({ FAILED_PAYMENT_FLOW_ENABLED: '' })).toBe(false);
    expect(isFailedPaymentFlowEnabled({ FAILED_PAYMENT_FLOW_ENABLED: 'true' })).toBe(true);
  });
});

test.describe('STYL-274 failed-payment state machine', () => {
  test.beforeAll(async () => {
    if (!serviceKey) throw new Error('Local Supabase service role key is required');
    if (!supabaseUrl.includes('127.0.0.1') && !supabaseUrl.includes('localhost')) {
      throw new Error('STYL-274 tests must use the local Supabase stack');
    }
    await ensureTenant(adminClient());
  });

  test.beforeEach(async () => {
    process.env.FAILED_PAYMENT_FLOW_ENABLED = 'true';
    await cleanup(adminClient());
  });

  test.afterAll(async () => {
    if (!serviceKey) return;
    await cleanup(adminClient());
  });

  function failureEvent(input: { eventId: string; invoiceId: string; subscriptionId: string; created: Date }) {
    return {
      id: input.eventId,
      type: 'invoice.payment_failed',
      created: Math.floor(input.created.getTime() / 1000),
      data: {
        object: {
          id: input.invoiceId,
          customer: 'cus_styl274',
          subscription: input.subscriptionId,
          subscription_details: { metadata: { tenant_id: TENANT } },
        },
      },
    };
  }

  test('duplicate failure webhooks keep the first failure time', async () => {
    const admin = adminClient();
    const failedAt = new Date('2026-03-01T09:00:00.000Z');
    const later = new Date('2026-03-04T09:00:00.000Z');
    const invoiceId = 'in_styl274_dup';
    const hooks: FailedPaymentTransitionEvent[] = [];

    const first = await handleStripeBillingEvent(
      failureEvent({
        eventId: 'evt_styl274_dup_1',
        invoiceId,
        subscriptionId: 'sub_styl274_dup',
        created: failedAt,
      }),
      { supabaseAdmin: admin, onFailedPaymentTransition: async (event) => { hooks.push(event); } },
    );
    const replay = await handleStripeBillingEvent(
      failureEvent({
        eventId: 'evt_styl274_dup_1',
        invoiceId,
        subscriptionId: 'sub_styl274_dup',
        created: later,
      }),
      { supabaseAdmin: admin },
    );
    const retry = await handleStripeBillingEvent(
      failureEvent({
        eventId: 'evt_styl274_dup_2',
        invoiceId,
        subscriptionId: 'sub_styl274_dup',
        created: later,
      }),
      { supabaseAdmin: admin },
    );

    expect(first.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(retry.status).toBe(200);

    const { data: cases } = await admin
      .from('failed_payment_cases')
      .select('status, first_failed_at, paused_at')
      .eq('stripe_invoice_id', invoiceId);
    expect(cases).toHaveLength(1);
    expect(cases?.[0].status).toBe('past_due');
    expect(Date.parse(cases?.[0].first_failed_at)).toBe(failedAt.getTime());
    expect(cases?.[0].paused_at).toBeNull();
    expect(hooks).toEqual([]);

    const { data: tenant } = await admin
      .from('tenants')
      .select('subscription_status, is_active')
      .eq('id', TENANT)
      .single();
    expect(tenant?.subscription_status).toBe('past_due');
    expect(tenant?.is_active).toBe(true);
  });

  test('day 7 pauses once and a repeated sweep is a no-op', async () => {
    const admin = adminClient();
    const failedAt = new Date('2026-04-01T00:00:00.000Z');
    const day7 = new Date(failedAt.getTime() + 7 * DAY);
    const { client, calls } = trackingStripe();
    const hooks: FailedPaymentTransitionEvent[] = [];
    const recorded = await handleStripeBillingEvent(
      failureEvent({
        eventId: 'evt_styl274_pause',
        invoiceId: 'in_styl274_pause',
        subscriptionId: 'sub_styl274_pause',
        created: failedAt,
      }),
      { supabaseAdmin: admin },
    );
    expect(recorded.status).toBe(200);

    const first = await runFailedPaymentSweep(admin, {
      now: day7,
      stripe: client,
      onTransition: async (event) => { hooks.push(event); },
    });
    const second = await runFailedPaymentSweep(admin, {
      now: day7,
      stripe: client,
      onTransition: async (event) => { hooks.push(event); },
    });

    expect(first.failed).toBe(0);
    expect(first.applied).toBe(1);
    expect(second.applied).toBe(0);
    expect(calls.pause).toHaveLength(1);
    expect(calls.pause[0].id).toBe('sub_styl274_pause');
    expect(calls.restart).toHaveLength(0);
    expect(calls.cancel).toHaveLength(0);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].kind).toBe('pause');

    const { data: row } = await admin
      .from('failed_payment_cases')
      .select('status, paused_at')
      .eq('stripe_invoice_id', 'in_styl274_pause')
      .single();
    expect(row?.status).toBe('paused');
    expect(Date.parse(row?.paused_at)).toBe(day7.getTime());

    const { data: transitions } = await admin
      .from('failed_payment_transitions')
      .select('transition, status, idempotency_key')
      .eq('idempotency_key', 'pause:in_styl274_pause');
    expect(transitions).toEqual([
      { transition: 'pause', status: 'processed', idempotency_key: 'pause:in_styl274_pause' },
    ]);

    const { data: tenant } = await admin
      .from('tenants')
      .select('subscription_status, is_active')
      .eq('id', TENANT)
      .single();
    expect(tenant?.subscription_status).toBe('paused');
    expect(tenant?.is_active).toBe(false);
  });

  test('paying while paused restarts billing from that day', async () => {
    const admin = adminClient();
    const failedAt = new Date('2026-05-01T00:00:00.000Z');
    const day7 = new Date(failedAt.getTime() + 7 * DAY);
    const restartAt = new Date(failedAt.getTime() + 10 * DAY);
    const { client, calls } = trackingStripe();
    const hooks: FailedPaymentTransitionEvent[] = [];

    await handleStripeBillingEvent(
      failureEvent({
        eventId: 'evt_styl274_restart_fail',
        invoiceId: 'in_styl274_restart',
        subscriptionId: 'sub_styl274_restart',
        created: failedAt,
      }),
      { supabaseAdmin: admin },
    );
    await runFailedPaymentSweep(admin, { now: day7, stripe: client });

    const paid = await handleStripeBillingEvent({
      id: 'evt_styl274_restart_paid',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_styl274_restart',
          customer: 'cus_styl274',
          subscription: 'sub_styl274_restart',
          billing_reason: 'manual',
          subscription_details: { metadata: { tenant_id: TENANT } },
        },
      },
    }, {
      supabaseAdmin: admin,
      now: restartAt,
      failedPaymentStripe: client,
      allocateRollingCredits: async () => undefined,
      onFailedPaymentTransition: async (event) => { hooks.push(event); },
    });
    const paidAgain = await handleStripeBillingEvent({
      id: 'evt_styl274_restart_paid_again',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_styl274_restart',
          customer: 'cus_styl274',
          subscription: 'sub_styl274_restart',
          billing_reason: 'manual',
          subscription_details: { metadata: { tenant_id: TENANT } },
        },
      },
    }, {
      supabaseAdmin: admin,
      now: new Date(restartAt.getTime() + DAY),
      failedPaymentStripe: client,
      allocateRollingCredits: async () => undefined,
    });

    expect(paid.status).toBe(200);
    expect(paidAgain.status).toBe(200);
    expect(calls.restart).toHaveLength(1);
    const nextBillingAt = addBillingInterval(restartAt, 'month', 1);
    const trialEnd = Math.floor(nextBillingAt.getTime() / 1000);
    expect(calls.restart[0]).toEqual({
      id: 'sub_styl274_restart',
      params: failedPaymentRestartParams(trialEnd),
    });
    expect(calls.restart[0].params).not.toHaveProperty('billing_cycle_anchor');
    expect(calls.invoiceCreates).toEqual([]);
    expect(hooks.map((event) => event.kind)).toEqual(['restart']);
    expect(hooks[0].billingRestartedAt).toBe(restartAt.toISOString());
    expect(hooks[0].nextBillingAt).toBe(new Date(trialEnd * 1000).toISOString());

    const { data: row } = await admin
      .from('failed_payment_cases')
      .select('status, restarted_at, cancelled_at')
      .eq('stripe_invoice_id', 'in_styl274_restart')
      .single();
    expect(row?.status).toBe('restarted');
    expect(Date.parse(row?.restarted_at)).toBe(restartAt.getTime());
    expect(row?.cancelled_at).toBeNull();

    const later = await runFailedPaymentSweep(admin, {
      now: new Date(failedAt.getTime() + 37 * DAY),
      stripe: client,
    });
    expect(later.applied).toBe(0);
    expect(calls.cancel).toHaveLength(0);
    expect(calls.writeOff).toHaveLength(0);

    const { data: tenant } = await admin
      .from('tenants')
      .select('subscription_status, is_active')
      .eq('id', TENANT)
      .single();
    expect(tenant?.subscription_status).toBe('active');
    expect(tenant?.is_active).toBe(true);
  });

  test('a payment during days 0 to 6 does not pause on day 7', async () => {
    const admin = adminClient();
    const failedAt = new Date('2026-06-01T00:00:00.000Z');
    const { client, calls } = trackingStripe();
    await handleStripeBillingEvent(
      failureEvent({
        eventId: 'evt_styl274_recover_fail',
        invoiceId: 'in_styl274_recover',
        subscriptionId: 'sub_styl274_recover',
        created: failedAt,
      }),
      { supabaseAdmin: admin },
    );
    const paid = await handleStripeBillingEvent({
      id: 'evt_styl274_recover_paid',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_styl274_recover',
          billing_reason: 'manual',
          subscription: 'sub_styl274_recover',
          subscription_details: { metadata: { tenant_id: TENANT } },
        },
      },
    }, {
      supabaseAdmin: admin,
      now: new Date(failedAt.getTime() + 2 * DAY),
      failedPaymentStripe: client,
      allocateRollingCredits: async () => undefined,
    });
    expect(paid.status).toBe(200);

    const sweep = await runFailedPaymentSweep(admin, {
      now: new Date(failedAt.getTime() + 7 * DAY),
      stripe: client,
    });
    expect(sweep.applied).toBe(0);
    expect(calls.pause).toHaveLength(0);
    expect(calls.restart).toHaveLength(0);

    const { data: row } = await admin
      .from('failed_payment_cases')
      .select('status, paused_at, restarted_at')
      .eq('stripe_invoice_id', 'in_styl274_recover')
      .single();
    expect(row?.status).toBe('recovered');
    expect(row?.paused_at).toBeNull();
    expect(row?.restarted_at).toBeNull();
  });

  test('day 37 cancels the account and writes off the invoice once', async () => {
    const admin = adminClient();
    const failedAt = new Date('2026-02-01T00:00:00.000Z');
    const { client, calls } = trackingStripe();
    const hooks: FailedPaymentTransitionEvent[] = [];
    await handleStripeBillingEvent(
      failureEvent({
        eventId: 'evt_styl274_cancel_fail',
        invoiceId: 'in_styl274_cancel',
        subscriptionId: 'sub_styl274_cancel',
        created: failedAt,
      }),
      { supabaseAdmin: admin },
    );
    await runFailedPaymentSweep(admin, {
      now: new Date(failedAt.getTime() + 7 * DAY),
      stripe: client,
      onTransition: async (event) => { hooks.push(event); },
    });

    const day37 = new Date(failedAt.getTime() + 37 * DAY);
    const first = await runFailedPaymentSweep(admin, {
      now: day37,
      stripe: client,
      onTransition: async (event) => { hooks.push(event); },
    });
    const second = await runFailedPaymentSweep(admin, {
      now: day37,
      stripe: client,
      onTransition: async (event) => { hooks.push(event); },
    });

    expect(first.failed).toBe(0);
    expect(first.applied).toBe(2);
    expect(second.applied).toBe(0);
    expect(calls.pause).toHaveLength(1);
    expect(calls.cancel).toEqual([{ id: 'sub_styl274_cancel', params: FAILED_PAYMENT_CANCEL_PARAMS }]);
    expect(calls.writeOff).toEqual(['in_styl274_cancel']);
    expect(hooks.map((event) => event.kind)).toEqual(['pause', 'cancel', 'write_off']);

    const { data: row } = await admin
      .from('failed_payment_cases')
      .select('status, cancelled_at, written_off_invoice_id')
      .eq('stripe_invoice_id', 'in_styl274_cancel')
      .single();
    expect(row?.status).toBe('cancelled');
    expect(Date.parse(row?.cancelled_at)).toBe(day37.getTime());
    expect(row?.written_off_invoice_id).toBe('in_styl274_cancel');

    const { data: tenant } = await admin
      .from('tenants')
      .select('subscription_status, is_active')
      .eq('id', TENANT)
      .single();
    expect(tenant?.subscription_status).toBe('cancelled');
    expect(tenant?.is_active).toBe(false);

    const latePay = await handleStripeBillingEvent({
      id: 'evt_styl274_cancel_late_pay',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_styl274_cancel',
          billing_reason: 'manual',
          subscription: 'sub_styl274_cancel',
          subscription_details: { metadata: { tenant_id: TENANT } },
        },
      },
    }, {
      supabaseAdmin: admin,
      failedPaymentStripe: client,
      allocateRollingCredits: async () => undefined,
      onFailedPaymentTransition: async (event) => { hooks.push(event); },
    });
    expect(latePay.status).toBe(200);
    expect(latePay.body.message).toBe('Written-off invoice payment ignored');
    expect(hooks.map((event) => event.kind)).toContain('written_off_paid');
    const { data: stillCancelled } = await admin
      .from('tenants')
      .select('subscription_status, is_active')
      .eq('id', TENANT)
      .single();
    expect(stillCancelled?.subscription_status).toBe('cancelled');
    expect(stillCancelled?.is_active).toBe(false);
    expect(calls.restart).toHaveLength(0);
  });

  test('a Stripe error during restart still unlocks the tenant', async () => {
    const admin = adminClient();
    const failedAt = new Date('2026-04-01T00:00:00.000Z');
    const { client } = trackingStripe();
    await handleStripeBillingEvent(
      failureEvent({
        eventId: 'evt_styl274_throw_fail',
        invoiceId: 'in_styl274_throw',
        subscriptionId: 'sub_styl274_throw',
        created: failedAt,
      }),
      { supabaseAdmin: admin },
    );
    await runFailedPaymentSweep(admin, {
      now: new Date(failedAt.getTime() + 7 * DAY),
      stripe: client,
    });
    const throwing = {
      ...client,
      async restartBilling() {
        throw new Error('Failed-payment actions require a Stripe test-mode secret key');
      },
    };
    const paid = await handleStripeBillingEvent({
      id: 'evt_styl274_throw_paid',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_styl274_throw',
          billing_reason: 'manual',
          subscription: 'sub_styl274_throw',
          subscription_details: { metadata: { tenant_id: TENANT } },
        },
      },
    }, {
      supabaseAdmin: admin,
      now: new Date(failedAt.getTime() + 10 * DAY),
      failedPaymentStripe: throwing,
      allocateRollingCredits: async () => undefined,
    });
    expect(paid.status).toBe(200);
    expect(paid.body.message).toContain('unlocked');
    const { data: tenant } = await admin
      .from('tenants')
      .select('is_active, subscription_status')
      .eq('id', TENANT)
      .single();
    expect(tenant?.is_active).toBe(true);
    expect(tenant?.subscription_status).toBe('active');
  });

  test('a trialing subscription update is treated as active', async () => {
    expect(stripeStatusToAddonStatus('trialing')).toBe('trialing');
    expect(addonActivateStatusFields('trialing').is_active).toBe(true);
    const admin = adminClient();
    const trialing = await handleStripeBillingEvent({
      id: 'evt_styl274_trialing',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_styl274_trialing',
          status: 'trialing',
          metadata: { tenant_id: TENANT, addon_catalog_id: 'styl274-missing-addon', is_addon: 'true' },
          items: { data: [{ id: 'si_styl274_trialing', price: { id: 'price_styl274_missing' } }] },
        },
      },
    }, { supabaseAdmin: admin });
    const ignored = await handleStripeBillingEvent({
      id: 'evt_styl274_trialing_ignored',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_styl274_trialing',
          status: 'past_due',
          metadata: { tenant_id: TENANT, addon_catalog_id: 'styl274-missing-addon', is_addon: 'true' },
          items: { data: [{ id: 'si_styl274_trialing', price: { id: 'price_styl274_missing' } }] },
        },
      },
    }, { supabaseAdmin: admin });
    expect(trialing.status).toBe(200);
    expect(String(trialing.body.message || '')).not.toMatch(/ignored/);
    expect(String(ignored.body.message || '')).toMatch(/ignored/);
    const { data: tenant } = await admin
      .from('tenants')
      .select('is_active, subscription_status')
      .eq('id', TENANT)
      .single();
    expect(tenant?.is_active).toBe(true);
    expect(tenant?.subscription_status).toBe('active');
  });

  test('a failed restart is retried and a paid case is not cancelled', async () => {
    const admin = adminClient();
    const failedAt = new Date('2026-04-01T00:00:00.000Z');
    const paidAt = new Date(failedAt.getTime() + 10 * DAY);
    const day37 = new Date(failedAt.getTime() + 37 * DAY);
    const { client, calls } = trackingStripe();
    await handleStripeBillingEvent(
      failureEvent({
        eventId: 'evt_styl274_retry_fail',
        invoiceId: 'in_styl274_retry',
        subscriptionId: 'sub_styl274_retry',
        created: failedAt,
      }),
      { supabaseAdmin: admin },
    );
    await runFailedPaymentSweep(admin, {
      now: new Date(failedAt.getTime() + 7 * DAY),
      stripe: client,
    });
    const throwing = {
      ...client,
      async restartBilling() {
        throw new Error('stripe down');
      },
    };
    const paid = await handleStripeBillingEvent({
      id: 'evt_styl274_retry_paid',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_styl274_retry',
          billing_reason: 'manual',
          subscription: 'sub_styl274_retry',
          subscription_details: { metadata: { tenant_id: TENANT } },
        },
      },
    }, {
      supabaseAdmin: admin,
      now: paidAt,
      failedPaymentStripe: throwing,
      allocateRollingCredits: async () => undefined,
    });
    expect(paid.status).toBe(200);
    expect(String(paid.body.message || '')).toContain('unlocked');

    const { data: paused } = await admin
      .from('failed_payment_cases')
      .select('status, paid_at, restarted_at, cancelled_at, written_off_invoice_id')
      .eq('stripe_invoice_id', 'in_styl274_retry')
      .single();
    expect(paused?.status).toBe('paused');
    expect(Date.parse(paused?.paid_at)).toBe(paidAt.getTime());
    expect(paused?.restarted_at).toBeNull();
    expect(paused?.cancelled_at).toBeNull();

    const blocked = await runFailedPaymentSweep(admin, { now: day37, stripe: throwing });
    expect(blocked.failed).toBeGreaterThanOrEqual(1);
    expect(calls.cancel).toHaveLength(0);
    expect(calls.writeOff).toHaveLength(0);
    const { data: stillPaused } = await admin
      .from('failed_payment_cases')
      .select('status, cancelled_at, written_off_invoice_id')
      .eq('stripe_invoice_id', 'in_styl274_retry')
      .single();
    expect(stillPaused?.status).toBe('paused');
    expect(stillPaused?.cancelled_at).toBeNull();
    expect(stillPaused?.written_off_invoice_id).toBeNull();

    const retried = await runFailedPaymentSweep(admin, { now: day37, stripe: client });
    expect(retried.applied).toBe(1);
    expect(calls.cancel).toHaveLength(0);
    expect(calls.writeOff).toHaveLength(0);
    expect(calls.restart).toHaveLength(1);
    const { data: restarted } = await admin
      .from('failed_payment_cases')
      .select('status, restarted_at, cancelled_at, written_off_invoice_id')
      .eq('stripe_invoice_id', 'in_styl274_retry')
      .single();
    expect(restarted?.status).toBe('restarted');
    expect(restarted?.restarted_at).not.toBeNull();
    expect(restarted?.cancelled_at).toBeNull();
    expect(restarted?.written_off_invoice_id).toBeNull();
  });
});

function watchFailedPaymentTables(admin: SupabaseClient): { client: SupabaseClient; touches: string[] } {
  const touches: string[] = [];
  const client = new Proxy(admin, {
    get(target, prop, receiver) {
      if (prop !== 'from') return Reflect.get(target, prop, receiver);
      return (table: string) => {
        if (table === 'failed_payment_cases' || table === 'failed_payment_transitions') touches.push(table);
        return target.from(table);
      };
    },
  }) as SupabaseClient;
  return { client, touches };
}

function missingFailedPaymentTables(admin: SupabaseClient): SupabaseClient {
  const error = { message: 'relation "failed_payment_cases" does not exist', code: '42P01' };
  return new Proxy(admin, {
    get(target, prop, receiver) {
      if (prop !== 'from') return Reflect.get(target, prop, receiver);
      return (table: string) => {
        if (table !== 'failed_payment_cases' && table !== 'failed_payment_transitions') return target.from(table);
        const builder = {
          select: () => builder,
          insert: () => builder,
          update: () => builder,
          delete: () => builder,
          eq: () => builder,
          is: () => builder,
          in: () => builder,
          not: () => builder,
          maybeSingle: async () => ({ data: null, error }),
          single: async () => ({ data: null, error }),
          then: (
            onFulfilled: (value: { data: null; error: typeof error }) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => Promise.resolve({ data: null, error }).then(onFulfilled, onRejected),
        };
        return builder;
      };
    },
  }) as SupabaseClient;
}

test.describe('STYL-274 failed-payment flow flag', () => {
  test.beforeAll(async () => {
    if (!serviceKey) throw new Error('Local Supabase service role key is required');
    await ensureTenant(adminClient());
  });

  test.afterAll(async () => {
    if (!serviceKey) return;
    await cleanup(adminClient());
  });

  test('flag off does not touch the new tables and still unlocks', async () => {
    process.env.FAILED_PAYMENT_FLOW_ENABLED = 'false';
    const watched = watchFailedPaymentTables(adminClient());
    const failedAt = new Date('2026-07-01T00:00:00.000Z');
    const failed = await handleStripeBillingEvent({
      id: 'evt_styl274_flag_webhook_fail',
      type: 'invoice.payment_failed',
      created: Math.floor(failedAt.getTime() / 1000),
      data: {
        object: {
          id: 'in_styl274_flag_webhook',
          subscription: 'sub_styl274_flag_webhook',
          subscription_details: { metadata: { tenant_id: TENANT } },
        },
      },
    }, { supabaseAdmin: watched.client });
    expect(failed.status).toBe(200);
    expect(String(failed.body.message || '')).toContain('past_due');
    const paid = await handleStripeBillingEvent({
      id: 'evt_styl274_flag_webhook_paid',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_styl274_flag_webhook',
          billing_reason: 'manual',
          subscription: 'sub_styl274_flag_webhook',
          subscription_details: { metadata: { tenant_id: TENANT } },
        },
      },
    }, {
      supabaseAdmin: watched.client,
      allocateRollingCredits: async () => undefined,
    });
    expect(paid.status).toBe(200);
    expect(String(paid.body.message || '')).toContain('unlocked');
    expect(watched.touches).toEqual([]);
    const { data: tenant } = await adminClient()
      .from('tenants')
      .select('is_active, subscription_status')
      .eq('id', TENANT)
      .single();
    expect(tenant?.is_active).toBe(true);
    expect(tenant?.subscription_status).toBe('active');
  });

  test('a missing failed-payment table is logged and does not block the webhook', async () => {
    process.env.FAILED_PAYMENT_FLOW_ENABLED = 'true';
    const logs: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' '));
    };
    try {
      const admin = missingFailedPaymentTables(adminClient());
      const failedAt = new Date('2026-07-02T00:00:00.000Z');
      const failed = await handleStripeBillingEvent({
        id: 'evt_styl274_missing_table_fail',
        type: 'invoice.payment_failed',
        created: Math.floor(failedAt.getTime() / 1000),
        data: {
          object: {
            id: 'in_styl274_missing_table',
            subscription: 'sub_styl274_missing_table',
            subscription_details: { metadata: { tenant_id: TENANT } },
          },
        },
      }, { supabaseAdmin: admin });
      expect(failed.status).toBe(200);
      expect(String(failed.body.message || '')).toContain('past_due');
      const paid = await handleStripeBillingEvent({
        id: 'evt_styl274_missing_table_paid',
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_styl274_missing_table',
            billing_reason: 'manual',
            subscription: 'sub_styl274_missing_table',
            subscription_details: { metadata: { tenant_id: TENANT } },
          },
        },
      }, {
        supabaseAdmin: admin,
        allocateRollingCredits: async () => undefined,
      });
      expect(paid.status).toBe(200);
      expect(String(paid.body.message || '')).toContain('unlocked');
      expect(logs.some((line) => line.includes('[failed-payment]'))).toBe(true);
    } finally {
      console.error = original;
      process.env.FAILED_PAYMENT_FLOW_ENABLED = 'true';
    }
  });
});

test.describe('STYL-274 sweep route fails closed', () => {
  const previousSecret = process.env.FAILED_PAYMENT_SWEEP_SECRET;
  const previousPlaywright = process.env.PLAYWRIGHT_TEST;
  const previousFlag = process.env.FAILED_PAYMENT_FLOW_ENABLED;

  test.afterEach(() => {
    if ((process.env.PLAYWRIGHT_TEST || '').trim() === 'true') {
      setFailedPaymentStripeClientForTests(null);
    }
    if (previousSecret === undefined) delete process.env.FAILED_PAYMENT_SWEEP_SECRET;
    else process.env.FAILED_PAYMENT_SWEEP_SECRET = previousSecret;
    if (previousPlaywright === undefined) delete process.env.PLAYWRIGHT_TEST;
    else process.env.PLAYWRIGHT_TEST = previousPlaywright;
    if (previousFlag === undefined) delete process.env.FAILED_PAYMENT_FLOW_ENABLED;
    else process.env.FAILED_PAYMENT_FLOW_ENABLED = previousFlag;
  });

  test('missing, blank, and wrong secrets are rejected', async () => {
    process.env.FAILED_PAYMENT_FLOW_ENABLED = 'true';
    delete process.env.FAILED_PAYMENT_SWEEP_SECRET;
    expect(isFailedPaymentSweepAuthorized('Bearer something')).toBe(false);
    const unset = await sweepPost(new Request('http://localhost:3001/api/billing/failed-payment-sweep', {
      method: 'POST',
      headers: { authorization: 'Bearer something' },
    }));
    expect(unset.status).toBe(401);

    process.env.FAILED_PAYMENT_SWEEP_SECRET = '   ';
    const blank = await sweepPost(new Request('http://localhost:3001/api/billing/failed-payment-sweep', {
      method: 'POST',
      headers: { authorization: 'Bearer    ' },
    }));
    expect(blank.status).toBe(401);

    process.env.FAILED_PAYMENT_SWEEP_SECRET = 'sweep-secret-274';
    const missing = await sweepPost(new Request('http://localhost:3001/api/billing/failed-payment-sweep', {
      method: 'POST',
    }));
    const wrong = await sweepPost(new Request('http://localhost:3001/api/billing/failed-payment-sweep', {
      method: 'POST',
      headers: { authorization: 'Bearer sweep-secret-000' },
    }));
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
  });

  test('a repeated authorised sweep pauses once', async () => {
    process.env.FAILED_PAYMENT_FLOW_ENABLED = 'true';
    if (!serviceKey) throw new Error('Local Supabase service role key is required');
    const admin = adminClient();
    await ensureTenant(admin);
    await cleanup(admin);

    const failedAt = new Date(Date.now() - 7 * DAY - 60_000);
    const recorded = await handleStripeBillingEvent({
      id: 'evt_styl274_route_fail',
      type: 'invoice.payment_failed',
      created: Math.floor(failedAt.getTime() / 1000),
      data: {
        object: {
          id: 'in_styl274_route',
          subscription: 'sub_styl274_route',
          subscription_details: { metadata: { tenant_id: TENANT } },
        },
      },
    }, { supabaseAdmin: admin });
    expect(recorded.status).toBe(200);

    const { client, calls } = trackingStripe();
    process.env.PLAYWRIGHT_TEST = 'true';
    process.env.FAILED_PAYMENT_SWEEP_SECRET = 'sweep-secret-274';
    setFailedPaymentStripeClientForTests(client);

    const headers = { authorization: 'Bearer sweep-secret-274' };
    const first = await sweepPost(new Request('http://localhost:3001/api/billing/failed-payment-sweep', {
      method: 'POST',
      headers,
    }));
    const second = await sweepPost(new Request('http://localhost:3001/api/billing/failed-payment-sweep', {
      method: 'POST',
      headers,
    }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody.applied).toBeGreaterThanOrEqual(1);
    expect(calls.pause.filter((call) => call.id === 'sub_styl274_route')).toHaveLength(1);
    expect(secondBody.failed).toBe(0);
    expect(calls.pause.filter((call) => call.id === 'sub_styl274_route')).toHaveLength(1);

    await cleanup(admin);
  });

  test('flag off returns 200 and does not pause', async () => {
    if (!serviceKey) throw new Error('Local Supabase service role key is required');
    const admin = adminClient();
    await ensureTenant(admin);
    await cleanup(admin);
    process.env.FAILED_PAYMENT_FLOW_ENABLED = 'true';
    const failedAt = new Date(Date.now() - 8 * DAY);
    const recorded = await handleStripeBillingEvent({
      id: 'evt_styl274_flag_off_fail',
      type: 'invoice.payment_failed',
      created: Math.floor(failedAt.getTime() / 1000),
      data: {
        object: {
          id: 'in_styl274_flag_off',
          subscription: 'sub_styl274_flag_off',
          subscription_details: { metadata: { tenant_id: TENANT } },
        },
      },
    }, { supabaseAdmin: admin });
    expect(recorded.status).toBe(200);

    process.env.FAILED_PAYMENT_FLOW_ENABLED = 'false';
    process.env.PLAYWRIGHT_TEST = 'true';
    process.env.FAILED_PAYMENT_SWEEP_SECRET = 'sweep-secret-274';
    const { client, calls } = trackingStripe();
    setFailedPaymentStripeClientForTests(client);
    const response = await sweepPost(new Request('http://localhost:3001/api/billing/failed-payment-sweep', {
      method: 'POST',
      headers: { authorization: 'Bearer sweep-secret-274' },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.disabled).toBe(true);
    expect(body.applied).toBe(0);
    expect(calls.pause).toHaveLength(0);
    expect(calls.invoiceCreates).toEqual([]);
    const { data: row } = await admin
      .from('failed_payment_cases')
      .select('status, paused_at')
      .eq('stripe_invoice_id', 'in_styl274_flag_off')
      .single();
    expect(row?.status).toBe('past_due');
    expect(row?.paused_at).toBeNull();
    await cleanup(admin);
  });
});
