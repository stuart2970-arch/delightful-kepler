import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createAdminClient, customerFeatureLabel } from '@/lib/entitlements';

const root = process.cwd();

function walkUi(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'api' || name === 'node_modules') continue;
      files.push(...walkUi(full));
      continue;
    }
    if (name.endsWith('.tsx')) files.push(full);
  }
  return files;
}

/**
 * String literals that a customer or admin can see. Identifier-only literals
 * (database columns and feature ids) are internal names and stay as they are.
 */
function withoutInterpolations(literal: string): string {
  let text = '';
  let depth = 0;
  for (let index = 0; index < literal.length; index += 1) {
    const char = literal[index];
    const next = literal[index + 1];
    if (depth === 0 && char === '$' && next === '{') {
      depth = 1;
      index += 1;
      continue;
    }
    if (depth > 0) {
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      continue;
    }
    text += char;
  }
  return text;
}

function visibleChunkLiterals(source: string): string[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const hits: string[] = [];
  const re = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped))) {
    const line = stripped.slice(0, match.index).split('\n').at(-1) ?? '';
    if (/\bconsole\./.test(line)) continue;
    const literal = withoutInterpolations(match[2]);
    if (!/\bchunks?\b/i.test(literal)) continue;
    if (/^[A-Za-z0-9_$.]+$/.test(literal.trim())) continue;
    hits.push(literal.trim());
  }
  return hits;
}

test.describe('STYL-359 knowledge items copy', () => {
  test('app UI string literals do not say chunks', () => {
    const files = [
      ...walkUi(join(root, 'src/components')),
      ...walkUi(join(root, 'src/app')),
    ];
    const failures: string[] = [];
    for (const file of files) {
      const hits = visibleChunkLiterals(readFileSync(file, 'utf8'));
      if (hits.length > 0) {
        failures.push(`${relative(root, file)}: ${hits.join(' | ')}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('superadmin feature-type examples say knowledge items', () => {
    const src = readFileSync(
      join(root, 'src/components/superadmin/SuperAdminEntitlementsView.tsx'),
      'utf8',
    );
    expect(src).toContain('Numeric (e.g. 500 knowledge items, 1000 msgs, UNLIMITED)');
    expect(src).toContain('Numeric (e.g. 500 knowledge items)');
    expect(src).not.toMatch(/500 chunks/);
  });

  test('usage meters label knowledge items even when the stored name still says chunks', () => {
    expect(customerFeatureLabel('knowledge_data_chunks', 'Knowledge Base Data Chunks')).toBe(
      'Knowledge Items',
    );
    expect(customerFeatureLabel('knowledge_data_chunks', '')).toBe('Knowledge Items');
    expect(customerFeatureLabel('knowledge_data_chunks', 'Knowledge Entries')).toBe(
      'Knowledge Entries',
    );
    expect(customerFeatureLabel('data_chunks_addon', 'Knowledge Base Data Pack')).toBe(
      'Knowledge Base Data Pack',
    );
    expect(customerFeatureLabel('message_allowance', 'Monthly Chat Conversations')).toBe(
      'Monthly Chat Conversations',
    );
    const migration = readFileSync(
      join(root, 'supabase/migrations/20261122160000_styl359_knowledge_items_label.sql'),
      'utf8',
    );
    expect(migration).toContain("SET name = 'Knowledge Items'");
    expect(migration).toContain("id = 'knowledge_data_chunks'");
    const sms = readFileSync(join(root, 'src/app/api/webhooks/twilio/sms/route.ts'), 'utf8');
    expect(sms).toContain('No additional knowledge items.');
    expect(sms).not.toContain('file chunks');
  });

  test('the stored knowledge feature name does not say chunks', async () => {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('features')
      .select('id, name')
      .eq('id', 'knowledge_data_chunks')
      .single();
    expect(error).toBeNull();
    expect(data?.name).toBe('Knowledge Items');
  });
});
