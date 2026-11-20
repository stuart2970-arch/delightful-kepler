import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function select(changed: string): string[] {
  const result = spawnSync('node', ['scripts/prepush-related-specs.mjs'], {
    input: changed.endsWith('\n') ? changed : `${changed}\n`,
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

test.describe('STYL-356 pre-push selects related specs only', () => {
  test('a changed auth module selects its spec and not the whole suite', () => {
    const specs = select('src/lib/auth/dashboard-auth-headers.ts');
    expect(specs).toContain('tests/styl-354-dashboard-save-auth.spec.ts');
    expect(specs.length).toBeLessThan(40);
    expect(specs).not.toContain('tests/whatsapp-ui.spec.ts');
  });

  test('a changed spec is included by path', () => {
    const specs = select('tests/addon-text.spec.ts');
    expect(specs).toEqual(['tests/addon-text.spec.ts']);
  });

  test('widget bundles select widget specs, not every test', () => {
    const specs = select('public/turnstile.html\npublic/widget.js');
    expect(specs).toContain('tests/styl-226-widget-turnstile.spec.ts');
    expect(specs).toContain('tests/homepage-widget.spec.ts');
    expect(specs.length).toBeLessThan(40);
  });

  test('a deleted spec path is not passed to Playwright', () => {
    const specs = select('tests/removed-old-name.spec.ts');
    expect(specs).not.toContain('tests/removed-old-name.spec.ts');
    expect(specs).toEqual([
      'tests/addon-text.spec.ts',
      'tests/styl-226-release-source.spec.ts',
    ]);
  });

  test('an unmatched change falls back to the fast smoke specs', () => {
    const specs = select('README.md');
    expect(specs).toEqual([
      'tests/addon-text.spec.ts',
      'tests/styl-226-release-source.spec.ts',
    ]);
  });

  test('CI still runs the full Playwright suite on every pull request', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/playwright.yml'), 'utf8');
    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toContain('- main');
    expect(workflow).toContain('- staging');
    expect(workflow).toMatch(/run:\s*npm run test:e2e\s*$/m);
    expect(workflow).not.toMatch(/run:\s*npm run test:e2e --/);
    const hook = readFileSync(join(process.cwd(), '.husky/pre-push'), 'utf8');
    expect(hook).toContain('npx eslint');
    expect(hook).toContain('npm run typecheck');
    expect(hook).toContain('scripts/prepush-related-specs.mjs');
    expect(hook).toContain('--diff-filter=d');
    expect(hook).toContain('sort -u');
    expect(hook).toContain('xargs -0');
    expect(hook).toContain("tr '\\n' '\\0'");
    expect(hook).not.toContain("xargs -d");
    expect(hook).toContain('Refusing to run the full suite.');
    expect(hook).not.toContain('SKIP_SIGNED_OUT_SWEEP=1 npm run test:e2e');
  });
});
