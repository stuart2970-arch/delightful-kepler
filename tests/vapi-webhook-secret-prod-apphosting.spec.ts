import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

/** Env entry for `variable`, ignoring comments so a note cannot satisfy the binding. */
function envBlock(yaml: string, variable: string): string {
  const body = yaml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  const marker = `- variable: ${variable}`;
  const start = body.indexOf(marker);
  expect(start, variable).toBeGreaterThanOrEqual(0);
  const next = body.indexOf('\n  - variable:', start + marker.length);
  return body.slice(start, next === -1 ? undefined : next).trim();
}

test('production apphosting.yaml binds VAPI_WEBHOOK_SECRET at RUNTIME like staging', () => {
  const base = readFileSync(join(root, 'apphosting.yaml'), 'utf8');
  const staging = readFileSync(join(root, 'apphosting.staging.yaml'), 'utf8');

  const baseBlock = envBlock(base, 'VAPI_WEBHOOK_SECRET');
  const stagingBlock = envBlock(staging, 'VAPI_WEBHOOK_SECRET');

  // Same shape as apphosting.staging.yaml: secret name, RUNTIME only, no pasted value.
  expect(baseBlock).toBe(stagingBlock);
  expect(baseBlock).toBe(
    [
      '- variable: VAPI_WEBHOOK_SECRET',
      '    secret: VAPI_WEBHOOK_SECRET',
      '    availability:',
      '      - RUNTIME',
    ].join('\n'),
  );
  expect(baseBlock).not.toMatch(/^\s*value:/m);
  expect(baseBlock).not.toMatch(/-\s*BUILD\b/);
});
