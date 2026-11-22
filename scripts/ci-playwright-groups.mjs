#!/usr/bin/env node
/**
 * CI Playwright area groups: each spec file belongs to exactly one group.
 * The `misc` group is a catch-all for files not matched by earlier groups.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..');
const testsDir = join(root, 'tests');

/** @type {{ id: string, label: string, matchers: RegExp[], catchAll?: boolean }[]} */
export const CI_PLAYWRIGHT_GROUPS = [
  {
    id: 'booking-calendar',
    label: 'Booking & calendar',
    matchers: [
      /tests\/styl-182-calendar-booking\.spec\.ts$/,
      /tests\/styl-189-ingest-dedupe\.spec\.ts$/,
      /tests\/styl-195-check-availability\.spec\.ts$/,
      /tests\/styl-244-rota-roundtrip\.spec\.ts$/,
      /tests\/styl-245-opening-hours\.spec\.ts$/,
      /tests\/styl-266-create-booking-auth\.spec\.ts$/,
      /tests\/styl-407-rwg-check-availability\.spec\.ts$/,
      /tests\/styl-412-staff-token-grants\.spec\.ts$/,
      /tests\/styl-289-integration-status-auth\.spec\.ts$/,
      /tests\/styl-293-evening-slot-booking\.spec\.ts$/,
      /tests\/styl-389-booking-manage\.spec\.ts$/,
      /tests\/styl-392-cancelled-slot-availability\.spec\.ts$/,
      /tests\/styl-404-calendar-push-sync\.spec\.ts$/,
      /tests\/scheduling-verification\.spec\.ts$/,
      /tests\/multi-colleague\.spec\.ts$/,
      /tests\/voice-availability\.spec\.ts$/,
      /tests\/integrations\.spec\.ts$/,
      /tests\/unit\/appointment-calendar-sync\.spec\.ts$/,
      /tests\/unit\/availability\.spec\.ts$/,
      /tests\/unit\/booking-confirmation-email\.spec\.ts$/,
      /tests\/unit\/manage-token-url\.spec\.ts$/,
      /tests\/unit\/styl-404-calendar-push-sync\.spec\.ts$/,
    ],
  },
  {
    id: 'chat-widget',
    label: 'Chat & widget',
    matchers: [
      /tests\/chatbot\.spec\.ts$/,
      /tests\/chat-unfinished-tool-tag\.spec\.ts$/,
      /tests\/homepage-widget\.spec\.ts$/,
      /tests\/greeting\.spec\.ts$/,
      /tests\/knowledge-base\.spec\.ts$/,
      /tests\/styl-190-phone-calls-channel\.spec\.ts$/,
      /tests\/styl-197-usage-metering\.spec\.ts$/,
      /tests\/styl-199-mock-reply-guard\.spec\.ts$/,
      /tests\/styl-233-chat-reply-complete\.spec\.ts$/,
      /tests\/styl-240-prompt-leak-guard\.spec\.ts$/,
      /tests\/styl-241-text-chat-no-voice\.spec\.ts$/,
      /tests\/styl-247-preview-inbox\.spec\.ts$/,
      /tests\/styl-247-receptionist-preview\.spec\.ts$/,
      /tests\/styl-271-widget-channel-lead\.spec\.ts$/,
      /tests\/styl-295-296-voice-minute-gate\.spec\.ts$/,
      /tests\/styl-361-turnstile-iframe\.spec\.ts$/,
      /tests\/styl-226-widget-turnstile\.spec\.ts$/,
      /tests\/styl-226-widget-voice-recording\.spec\.ts$/,
      /tests\/openclaw\.spec\.ts$/,
      /tests\/unit\/lead-notifier-html\.spec\.ts$/,
      /tests\/unit\/styl-310-conversation-metering\.spec\.ts$/,
    ],
  },
  {
    id: 'billing-stripe-entitlements',
    label: 'Billing, Stripe & entitlements',
    matchers: [
      /tests\/addon-text\.spec\.ts$/,
      /tests\/addons-sliding-scale\.spec\.ts$/,
      /tests\/billing-checkout-auth\.spec\.ts$/,
      /tests\/styl-177-pack-text\.spec\.ts$/,
      /tests\/styl-179-disabled-addons\.spec\.ts$/,
      /tests\/styl-197-entitlement-rls\.spec\.ts$/,
      /tests\/styl-200-billing-account-tab\.spec\.ts$/,
      /tests\/styl-202-entitlement-rls\.spec\.ts$/,
      /tests\/styl-218-knowledge-items-billing\.spec\.ts$/,
      /tests\/styl-242-billing-already-included\.spec\.ts$/,
      /tests\/styl-242-entitlement-rls\.spec\.ts$/,
      /tests\/styl-243-bolt-on-activation-idempotent\.spec\.ts$/,
      /tests\/styl-142-stripe-invoice-presentation\.spec\.ts$/,
      /tests\/styl-249-billing-pending-cancel\.spec\.ts$/,
      /tests\/styl-249-pending-cancel-webhook\.spec\.ts$/,
      /tests\/styl-312-legacy-voice-cap\.spec\.ts$/,
      /tests\/styl-261-webhook-cancel-race\.spec\.ts$/,
      /tests\/styl-279-stripe-webhook-event-idempotency\.spec\.ts$/,
      /tests\/styl-385-credit-grant-idempotency\.spec\.ts$/,
      /tests\/styl-226-addon-subscription-status\.spec\.ts$/,
      /tests\/styl-226-stripe-webhook-signature\.spec\.ts$/,
      /tests\/unit\/bolton-activation\.spec\.ts$/,
      /tests\/unit\/styl-309-tier-voice-grant\.spec\.ts$/,
      /tests\/unit\/styl-142-checkout-invoice-presentation\.spec\.ts$/,
      /tests\/unit\/styl-142-stripe-checkout-customer\.spec\.ts$/,
      /tests\/styl-414-stripe-customer-race\.spec\.ts$/,
    ],
  },
  {
    id: 'auth',
    label: 'Auth & session',
    matchers: [
      /tests\/auth\.spec\.ts$/,
      /tests\/styl-225-banned-names\.spec\.ts$/,
      /tests\/crypto\.spec\.ts$/,
      /tests\/styl-228-magic-link-auth\.spec\.ts$/,
      /tests\/styl-228-turnstile-site-key\.spec\.ts$/,
      /tests\/styl-231-google-sign-in-scopes\.spec\.ts$/,
      /tests\/styl-239-tenant-created-auth\.spec\.ts$/,
      /tests\/styl-287-tenant-settings-auth\.spec\.ts$/,
      /tests\/styl-288-conversations-auth\.spec\.ts$/,
      /tests\/styl-290-oauth-callback-auth\.spec\.ts$/,
      /tests\/styl-354-dashboard-save-auth\.spec\.ts$/,
      /tests\/styl-361-staging-turnstile-sitekey\.spec\.ts$/,
      /tests\/meta-pixel-consent\.spec\.ts$/,
    ],
  },
  {
    id: 'admin-superadmin',
    label: 'Admin & superadmin',
    matchers: [
      /tests\/superadmin-auth\.spec\.ts$/,
      /tests\/telephony-deprovision-auth\.spec\.ts$/,
      /tests\/styl-194-account-ownership\.spec\.ts$/,
      /tests\/styl-203-firebase-app-hosting\.spec\.ts$/,
      /tests\/styl-203-staging-core-secrets\.spec\.ts$/,
      /tests\/styl-210-live-supabase-guard\.spec\.ts$/,
      /tests\/styl-250-addon-audit-rls\.spec\.ts$/,
      /tests\/styl-251-wordpress-publish-rollback\.spec\.ts$/,
      /tests\/styl-252-wp-trigger-superadmin-guard\.spec\.ts$/,
      /tests\/styl-298-wpmudev-webhook-auth\.spec\.ts$/,
      /tests\/styl-299-data-deletion-signed-request\.spec\.ts$/,
      /tests\/styl-304-tenant-created-bearer\.spec\.ts$/,
      /tests\/styl-397-service-role-table-grants\.spec\.ts$/,
      /tests\/styl-238-no-wp-token-literal\.spec\.ts$/,
      /tests\/styl-226-telephony-deprovision\.spec\.ts$/,
      /tests\/styl-226-telephony-provision-route\.spec\.ts$/,
      /tests\/styl-226-telephony-provision-safety\.spec\.ts$/,
      /tests\/styl-226-wordpress-disabled-on-staging\.spec\.ts$/,
      /tests\/system-email-.*\.spec\.ts$/,
    ],
  },
  {
    id: 'voice-telephony-vapi',
    label: 'Voice, telephony & Vapi',
    matchers: [
      /tests\/styl-vapi-end-of-call-ingest\.spec\.ts$/,
      /tests\/styl-vapi-web-call-guard\.spec\.ts$/,
      /tests\/vapi-webhook-secret-prod-apphosting\.spec\.ts$/,
      /tests\/styl-245-voice-hours\.spec\.ts$/,
      /tests\/styl-315-foundation-voice-renewal\.spec\.ts$/,
      /tests\/styl-384-vapi-no-recording\.spec\.ts$/,
      /tests\/styl-388-voice-diagnostics\.spec\.ts$/,
      /tests\/styl-401-315-dashboard-copy\.spec\.ts$/,
      /tests\/styl-226-vapi-no-prod-fallback\.spec\.ts$/,
      /tests\/styl-226-vapi-webhook-auth\.spec\.ts$/,
      /tests\/styl-226-voice-gate\.spec\.ts$/,
      /tests\/styl-226-voice-log-hygiene\.spec\.ts$/,
      /tests\/styl-226-inbound-schema\.spec\.ts$/,
    ],
  },
  {
    id: 'channels-meta-whatsapp',
    label: 'Channels (Meta, WhatsApp, Twilio)',
    matchers: [
      /tests\/twilio-sms\.spec\.ts$/,
      /tests\/twilio-whatsapp-verification\.spec\.ts$/,
      /tests\/whatsapp-onboard-webhook\.spec\.ts$/,
      /tests\/whatsapp-purge\.spec\.ts$/,
      /tests\/whatsapp-ui\.spec\.ts$/,
      /tests\/meta-data-deletion-erasure\.spec\.ts$/,
      /tests\/meta-webhook-signature\.spec\.ts$/,
      /tests\/styl-219-meta-channel-labels\.spec\.ts$/,
      /tests\/unit\/styl-256-whatsapp-templates\.spec\.ts$/,
    ],
  },
  {
    id: 'misc',
    label: 'Other / misc',
    catchAll: true,
    matchers: [],
  },
];

function listSpecFiles(dir = testsDir, base = testsDir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSpecFiles(full, base));
      continue;
    }
    if (name.endsWith('.spec.ts')) {
      out.push(relative(root, full).split('\\').join('/'));
    }
  }
  return out.sort();
}

/**
 * @param {string} relPath
 * @returns {string | null}
 */
export function groupForSpec(relPath) {
  const normalized = relPath.split('\\').join('/');
  for (const group of CI_PLAYWRIGHT_GROUPS) {
    if (group.catchAll) continue;
    if (group.matchers.some((re) => re.test(normalized))) {
      return group.id;
    }
  }
  const misc = CI_PLAYWRIGHT_GROUPS.find((g) => g.catchAll);
  return misc ? misc.id : null;
}

export function buildAssignmentMap() {
  const files = listSpecFiles();
  /** @type {Record<string, string[]>} */
  const byGroup = {};
  for (const g of CI_PLAYWRIGHT_GROUPS) {
    byGroup[g.id] = [];
  }
  /** @type {Record<string, string>} */
  const fileToGroup = {};
  for (const file of files) {
    const g = groupForSpec(file);
    if (!g) {
      throw new Error(`No group for ${file}`);
    }
    fileToGroup[file] = g;
    byGroup[g].push(file);
  }
  return { files, fileToGroup, byGroup };
}

export function validateCiPlaywrightGroups() {
  const { files, fileToGroup, byGroup } = buildAssignmentMap();
  const errors = [];
  const seen = new Map();

  for (const file of files) {
    const group = fileToGroup[file];
    const matches = CI_PLAYWRIGHT_GROUPS.filter(
      (g) => !g.catchAll && g.matchers.some((re) => re.test(file)),
    );
    if (matches.length > 1) {
      errors.push(`${file}: matched more than one group: ${matches.map((m) => m.id).join(', ')}`);
    }
    if (!group) {
      errors.push(`${file}: not assigned to any group`);
    }
    seen.set(file, group);
  }

  const assigned = new Set(files);
  if (assigned.size !== files.length) {
    errors.push('Duplicate paths in spec list');
  }

  for (const [file, group] of seen) {
    if (!byGroup[group]?.includes(file)) {
      errors.push(`${file}: internal map inconsistency`);
    }
  }

  return { ok: errors.length === 0, errors, files, fileToGroup, byGroup };
}

/**
 * @param {string} groupId
 * @returns {string[]}
 */
export function testPathsForGroup(groupId) {
  const { byGroup } = buildAssignmentMap();
  const paths = byGroup[groupId];
  if (!paths) {
    throw new Error(`Unknown CI Playwright group: ${groupId}`);
  }
  return paths;
}

function isMain() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return import.meta.url === pathToFileURL(argv1).href;
}

if (isMain()) {
  const mode = process.argv[2] || 'validate';
  if (mode === 'validate') {
    const result = validateCiPlaywrightGroups();
    if (!result.ok) {
      for (const err of result.errors) {
        console.error(err);
      }
      process.exit(1);
    }
    for (const group of CI_PLAYWRIGHT_GROUPS) {
      const paths = result.byGroup[group.id];
      console.log(`${group.id}: ${paths.length} spec file(s)`);
    }
    console.log(`Total: ${result.files.length} spec file(s)`);
    process.exit(0);
  }
  if (mode === 'report') {
    const result = validateCiPlaywrightGroups();
    console.log(JSON.stringify(result.byGroup, null, 2));
    process.exit(result.ok ? 0 : 1);
  }
  if (mode === 'list-files') {
    const groupId = process.argv[3];
    if (!groupId) {
      console.error('Usage: node scripts/ci-playwright-groups.mjs list-files <area-id>');
      process.exit(2);
    }
    const paths = testPathsForGroup(groupId);
    process.stdout.write(`${paths.join(' ')}\n`);
    process.exit(0);
  }
  console.error(`Usage: node scripts/ci-playwright-groups.mjs [validate|report|list-files <area-id>]`);
  process.exit(2);
}