import { test, expect } from '@playwright/test';
import {
  dedupeKnowledgeImportUrls,
  filterKnowledgeImportUrl,
} from '../src/lib/knowledge/url-import-filter';

test.describe('STYL-360 knowledge URL import filter', () => {
  test('blocks login, cart, and wp-admin paths', () => {
    for (const url of [
      'https://shop.example/login',
      'https://shop.example/cart',
      'https://shop.example/wp-admin/edit.php',
      'https://shop.example/privacy-policy',
    ]) {
      const verdict = filterKnowledgeImportUrl(url);
      expect(verdict.allowed, url).toBe(false);
    }
  });

  test('blocks non-HTML assets and dedupes URLs', () => {
    expect(filterKnowledgeImportUrl('https://x.example/brochure.pdf').allowed).toBe(false);
    const list = dedupeKnowledgeImportUrls([
      'https://x.example/about',
      'https://x.example/about/',
      'https://x.example/contact',
    ]);
    expect(list).toHaveLength(2);
  });
});