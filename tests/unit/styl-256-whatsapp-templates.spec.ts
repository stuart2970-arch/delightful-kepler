import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { STARTER_TEMPLATES_EN_GB } from '@/lib/meta';

const MISSED_CALL_BODY =
  'Hello {{1}}, this is {{2}}. We were unable to take your call at {{3}}. We have noted your missed call and will call you back as soon as we can.';
const APPOINTMENT_BODY =
  'Hello {{1}}, this is a reminder of your appointment with {{2}} on {{3}} at {{4}}. Please reply YES to confirm the appointment, or reply to this message if you need to reschedule.';
const BOOKING_LINK_BODY =
  'Hi {{1}}, thanks for reaching out to {{2}}! You can view our services and book online anytime here: {{3}}';

function starter(name: string) {
  const template = STARTER_TEMPLATES_EN_GB.find((item) => item.name === name);
  expect(template, name).toBeTruthy();
  return template!;
}

function bodyComponent(name: string) {
  const component = starter(name).components.find((item) => item.type === 'BODY');
  expect(component, `${name} BODY`).toBeTruthy();
  return component!;
}

test.describe('STYL-256 WhatsApp starter templates', () => {
  test('missed_call_followup is a utility callback with three sample values', () => {
    const template = starter('missed_call_followup');
    const body = bodyComponent('missed_call_followup');
    expect(template.category).toBe('UTILITY');
    expect(template.language).toBe('en_GB');
    expect(body.text).toBe(MISSED_CALL_BODY);
    expect(body.example?.body_text).toEqual([['Sarah', 'StyleFlo', '10:15']]);
  });

  test('appointment_reminder keeps four positional variables and includes samples', () => {
    const template = starter('appointment_reminder');
    const body = bodyComponent('appointment_reminder');
    expect(template.category).toBe('UTILITY');
    expect(template.language).toBe('en_GB');
    expect(body.text).toBe(APPOINTMENT_BODY);
    expect(body.example?.body_text).toEqual([['Sarah', 'StyleFlo', '12 November 2026', '10:00']]);
  });

  test('every starter body with variables sends example.body_text in Meta shape', () => {
    expect(STARTER_TEMPLATES_EN_GB.map((item) => item.name)).toEqual([
      'appointment_reminder',
      'booking_link',
      'missed_call_followup',
    ]);

    for (const template of STARTER_TEMPLATES_EN_GB) {
      const body = template.components.find((item) => item.type === 'BODY');
      expect(body, template.name).toBeTruthy();
      const indexes = [...body!.text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
      const expectedCount = Math.max(...indexes);
      expect(body!.example?.body_text, template.name).toEqual([
        expect.any(Array),
      ]);
      const samples = body!.example?.body_text?.[0];
      expect(samples, template.name).toHaveLength(expectedCount);
      expect(samples?.every((value) => typeof value === 'string' && value.length > 0)).toBe(true);
    }

    expect(bodyComponent('booking_link').text).toBe(BOOKING_LINK_BODY);
    expect(bodyComponent('booking_link').example?.body_text?.[0]?.[2]).toMatch(/^https:\/\//);
  });

  test('dashboard preview does not hard-code Approved by Meta and uses the starter copy', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/components/dashboard-views/WhatsAppMetaView.tsx'),
      'utf8',
    );
    expect(src).not.toContain('Approved by Meta');
    expect(src).not.toContain('How can our AI assistant help you today');
    expect(src).not.toContain('Reply 1 to confirm');
    expect(src).toContain('STARTER_TEMPLATES_EN_GB');
    expect(src).toContain('starter_template_statuses');
  });

  test('missed-call send helper passes three body parameters in template order', async () => {
    const meta = await import('@/lib/meta');
    expect(typeof meta.buildMissedCallFollowupSendComponents).toBe('function');

    const components = meta.buildMissedCallFollowupSendComponents({
      customerName: 'Sarah',
      businessName: 'StyleFlo',
      callTime: '10:15',
    });

    expect(components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Sarah' },
          { type: 'text', text: 'StyleFlo' },
          { type: 'text', text: '10:15' },
        ],
      },
    ]);
  });

  test('sync edits a rejected template by id and skips pending or approved templates', async () => {
    const meta = await import('@/lib/meta');
    expect(typeof meta.syncStarterTemplates).toBe('function');

    const calls: { url: string; method: string; body?: unknown }[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });

      if (method === 'GET' && url.includes('name=missed_call_followup')) {
        return json({
          data: [{ id: '111', name: 'missed_call_followup', language: 'en_GB', status: 'REJECTED' }],
        });
      }
      if (method === 'GET' && url.includes('name=appointment_reminder')) {
        return json({
          data: [{ id: '222', name: 'appointment_reminder', language: 'en_GB', status: 'PENDING' }],
        });
      }
      if (method === 'GET' && url.includes('name=booking_link')) {
        return json({
          data: [{ id: '333', name: 'booking_link', language: 'en_GB', status: 'APPROVED' }],
        });
      }
      if (method === 'POST' && url.endsWith('/111')) {
        return json({ success: true });
      }
      return json({ error: { message: `unexpected ${method} ${url}` } }, 500);
    };

    const results = await meta.syncStarterTemplates({
      wabaId: '1955389302102945',
      accessToken: 'test-token-not-real',
      names: ['missed_call_followup', 'appointment_reminder', 'booking_link'],
      fetchImpl,
      graphBaseUrl: 'https://graph.facebook.com/v21.0',
    });

    expect(results.find((row) => row.name === 'missed_call_followup')).toMatchObject({
      action: 'edited',
      id: '111',
      status: 'REJECTED',
    });
    expect(results.find((row) => row.name === 'appointment_reminder')?.action).toBe('skipped_pending');
    expect(results.find((row) => row.name === 'booking_link')?.action).toBe('skipped_existing');

    const edit = calls.find((call) => call.method === 'POST');
    expect(edit?.url).toBe('https://graph.facebook.com/v21.0/111');
    expect(edit?.body).toMatchObject({
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: MISSED_CALL_BODY,
          example: { body_text: [['Sarah', 'StyleFlo', '10:15']] },
        },
      ],
    });
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(calls.some((call) => call.url.includes('/222') && call.method === 'POST')).toBe(false);
  });

  test('sync creates a missing starter template and a dry run does not post', async () => {
    const meta = await import('@/lib/meta');
    const calls: { url: string; method: string; body?: unknown }[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === 'GET') return json({ data: [] });
      return json({ id: 'created-1', status: 'PENDING' });
    };

    const created = await meta.syncStarterTemplates({
      wabaId: '1955389302102945',
      accessToken: 'test-token-not-real',
      names: ['appointment_reminder'],
      fetchImpl,
      graphBaseUrl: 'https://graph.facebook.com/v21.0',
    });
    expect(created[0]).toMatchObject({ name: 'appointment_reminder', action: 'created', id: 'created-1' });
    const createCall = calls.find((call) => call.method === 'POST');
    expect(createCall?.url).toBe('https://graph.facebook.com/v21.0/1955389302102945/message_templates');
    expect(createCall?.body.components[0].example.body_text).toEqual([
      ['Sarah', 'StyleFlo', '12 November 2026', '10:00'],
    ]);

    calls.length = 0;
    const dry = await meta.syncStarterTemplates({
      wabaId: '1955389302102945',
      accessToken: 'test-token-not-real',
      names: ['missed_call_followup'],
      dryRun: true,
      fetchImpl,
      graphBaseUrl: 'https://graph.facebook.com/v21.0',
    });
    expect(dry[0].action).toBe('dry_run_create');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  test('sync refuses the real Graph fetch during Playwright', async () => {
    const meta = await import('@/lib/meta');
    const previous = process.env.PLAYWRIGHT_TEST;
    process.env.PLAYWRIGHT_TEST = 'true';
    try {
      await expect(
        meta.syncStarterTemplates({
          wabaId: '1955389302102945',
          accessToken: 'test-token-not-real',
          names: ['missed_call_followup'],
        })
      ).rejects.toThrow(/Meta/);
    } finally {
      if (previous === undefined) delete process.env.PLAYWRIGHT_TEST;
      else process.env.PLAYWRIGHT_TEST = previous;
    }
  });

  test('dashboard account payload drops the stored WhatsApp token', async () => {
    const templates = await import('@/lib/whatsapp-starter-templates');
    const payload = templates.publicWhatsAppAccount(
      { id: '1', waba_id: '9', business_token_enc: 'secret-token', pin_enc: 'secret-pin' },
      { missed_call_followup: 'REJECTED' },
    );
    expect(payload).toEqual({
      id: '1',
      waba_id: '9',
      starter_template_statuses: { missed_call_followup: 'REJECTED' },
    });
    expect(JSON.stringify(payload)).not.toContain('secret');
  });

  test('resubmit route is superadmin-only and reuses starter sync', async () => {
    const routePath = path.resolve(
      __dirname,
      '../../src/app/api/superadmin/whatsapp-templates/resubmit/route.ts',
    );
    expect(fs.existsSync(routePath), routePath).toBe(true);
    const src = fs.readFileSync(routePath, 'utf8');
    expect(src).toContain('withSuperAdmin');
    expect(src).toContain('syncStarterTemplates');
    expect(src).toContain('decryptToken');
    expect(src).toContain('RESUBMIT_STARTER_TEMPLATE_NAMES');
    expect(src).toContain("process.env.PLAYWRIGHT_TEST === 'true'");
    expect(src).toContain('dryRun: !confirm');

    const templates = await import('@/lib/whatsapp-starter-templates');
    expect([...templates.RESUBMIT_STARTER_TEMPLATE_NAMES]).toEqual([
      'missed_call_followup',
      'appointment_reminder',
    ]);
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
