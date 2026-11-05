import { test, expect } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

test.describe('STYL-226: release source and Playwright gate', () => {
  test('docs/staging.md names the live App Hosting branch and public URL', () => {
    const docs = readFileSync(join(root, 'docs/staging.md'), 'utf8');
    expect(docs).toMatch(/live branch.*`staging`/i);
    expect(docs).toContain('https://staging.styleflo.ai');
    expect(docs).toMatch(/hotfix/i);
    expect(docs).toMatch(/same day/i);
    expect(docs).toMatch(/nothing to `main` without Stuart/i);
    expect(docs).not.toMatch(/Live branch\s*\|\s*`main`/);
  });

  test('playwright.yml runs on pull requests to main and staging', () => {
    const workflow = readFileSync(join(root, '.github/workflows/playwright.yml'), 'utf8');
    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toContain('- main');
    expect(workflow).toContain('- staging');
  });

  test('deploy.yml still deploys production only from main to Cloud Run styleflo-new', () => {
    const deploy = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
    expect(deploy).toMatch(/branches:\s*\n\s*-\s*main/);
    expect(deploy).toContain('SERVICE_NAME: styleflo-new');
    expect(deploy).toContain('GCP_REGION: europe-west2');
    expect(deploy).not.toMatch(/^\s+environment:\s+production\s*$/m);
    expect(deploy).not.toMatch(/branches:[\s\S]*staging/);
  });

  test('no workflow deploys production from the staging branch', () => {
    const workflowsDir = join(root, '.github/workflows');
    expect(existsSync(workflowsDir)).toBe(true);
    const files = readdirSync(workflowsDir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
    expect(existsSync(join(workflowsDir, 'deploy-staging.yml'))).toBe(false);

    for (const name of files) {
      const text = readFileSync(join(workflowsDir, name), 'utf8');
      if (name === 'deploy.yml') {
        expect(text, name).not.toMatch(/branches:[\s\S]*staging/);
        continue;
      }
      const mentionsProductionService = /styleflo-new/.test(text);
      const triggersOnStagingPush = /on:[\s\S]*push:[\s\S]*branches:[\s\S]*staging/.test(text);
      expect(mentionsProductionService && triggersOnStagingPush, name).toBe(false);
    }
  });
});
