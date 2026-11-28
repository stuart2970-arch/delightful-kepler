const JUNK_PATH_SNIPPETS = [
  '/login',
  '/log-in',
  '/signin',
  '/sign-in',
  '/signup',
  '/sign-up',
  '/register',
  '/account',
  '/my-account',
  '/cart',
  '/checkout',
  '/basket',
  '/wp-admin',
  '/wp-login',
  '/feed',
  '/rss',
  '/tag/',
  '/tags/',
  '/category/',
  '/author/',
  '/privacy',
  '/cookie',
  '/cookies',
  '/terms-and-conditions',
  '/terms-of-service',
  '/gdpr',
];

const NON_HTML_ASSET_EXTENSIONS = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.xml',
  '.zip',
  '.mp4',
  '.mp3',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
]);

export type KnowledgeUrlFilterResult =
  | { allowed: true; normalized: string }
  | { allowed: false; reason: string; normalized?: string };

export function normalizeKnowledgeImportUrl(raw: string): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProto);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '') || parsed.origin;
  } catch {
    return null;
  }
}

export function knowledgeImportUrlRejectionReason(url: string): string | null {
  const normalized = normalizeKnowledgeImportUrl(url);
  if (!normalized) return 'URL is not a valid http(s) address';

  let pathname = '';
  try {
    pathname = new URL(normalized).pathname.toLowerCase();
  } catch {
    return 'URL is not a valid http(s) address';
  }

  const lower = normalized.toLowerCase();
  for (const ext of NON_HTML_ASSET_EXTENSIONS) {
    if (lower.endsWith(ext) || pathname.endsWith(ext)) {
      return 'Non-HTML assets are skipped during website import';
    }
  }

  for (const snippet of JUNK_PATH_SNIPPETS) {
    if (pathname.includes(snippet) || lower.includes(snippet)) {
      return 'This page type is excluded from knowledge import (login, checkout, feeds, legal boilerplate, etc.)';
    }
  }

  return null;
}

export function filterKnowledgeImportUrl(raw: string): KnowledgeUrlFilterResult {
  const normalized = normalizeKnowledgeImportUrl(raw);
  if (!normalized) {
    return { allowed: false, reason: 'URL is not a valid http(s) address' };
  }
  const rejection = knowledgeImportUrlRejectionReason(normalized);
  if (rejection) {
    return { allowed: false, reason: rejection, normalized };
  }
  return { allowed: true, normalized };
}

export function dedupeKnowledgeImportUrls(urls: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const verdict = filterKnowledgeImportUrl(raw);
    if (!verdict.allowed) continue;
    const key = verdict.normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(verdict.normalized);
  }
  return out;
}