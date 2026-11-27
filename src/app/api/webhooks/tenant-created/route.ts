import { NextRequest, NextResponse } from 'next/server';
import { getWordpressPublishConfig } from '@/lib/env/wordpress-publish';
import { postWordpressCreateBusiness } from '@/lib/wordpress/wordpress-api';
import { secretsEqual } from '@/lib/security/secrets-equal';

function bearerToken(req: NextRequest): string {
  const header = req.headers.get('authorization') || '';
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1] ?? '';
}

/**
 * Fail closed. An unset, blank, or mismatched TENANT_CREATED_WEBHOOK_SECRET
 * never falls through.
 */
function isTenantCreatedAuthorized(req: NextRequest): boolean {
  const expected = (process.env.TENANT_CREATED_WEBHOOK_SECRET || '').trim();
  if (!expected) return false;
  return secretsEqual(bearerToken(req), expected);
}

/** Slug or tenant id only. Rejects emails, names, phones, and token-shaped strings. */
function safeIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(trimmed)) return undefined;
  if (/^[0-9a-fA-F]{20,}$/.test(trimmed)) return undefined;
  if (/^\d{8,}$/.test(trimmed)) return undefined;
  return trimmed;
}

function redactSensitive(text: string): string {
  const redacted = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '[redacted-phone]')
    .replace(/\b[0-9a-fA-F]{20,}\b/g, '[redacted]')
    .replace(/(token|authorization|secret|password|api[_-]?key)(\s*[:=]\s*)(\S+)/gi, '$1$2[redacted]');
  return redacted.slice(0, 200);
}

export async function POST(req: NextRequest) {
  if (!isTenantCreatedAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const record = body?.record || body;
    const slug = typeof record?.slug === 'string' ? record.slug : '';
    const loggedSlug = safeIdentifier(slug);
    const tenantId = safeIdentifier(record?.id) || safeIdentifier(record?.tenant_id);

    console.log('[Tenant Created Webhook] Triggered', { slug: loggedSlug, tenantId });

    if (!slug) {
      console.warn('[Tenant Created Webhook] Missing slug');
      return NextResponse.json({ error: 'Missing slug in payload record' }, { status: 400 });
    }

    const name = record.company_name || record.name || 'Unnamed Business';

    if (record.page_published !== true) {
      return NextResponse.json(
        { success: true, skipped: true, reason: 'Business page is not published' },
        { status: 200 },
      );
    }

    const wpConfig = getWordpressPublishConfig();
    if (!wpConfig.enabled) {
      return NextResponse.json({ success: false, error: wpConfig.reason }, { status: 200 });
    }

    console.log('[Tenant Created Webhook] Syncing tenant', { slug: loggedSlug });

    const wpResponse = await postWordpressCreateBusiness(wpConfig, slug, name);
    if (!wpResponse.ok) {
      console.error('[Tenant Created Webhook] WordPress creation failed', {
        slug: loggedSlug,
        kind: wpResponse.kind,
        status: wpResponse.status,
        detail: wpResponse.logDetail,
      });
      return NextResponse.json({
        error: wpResponse.message,
        wordpressError: wpResponse.kind,
      }, { status: wpResponse.status > 0 ? wpResponse.status : 502 });
    }

    const wpResult = wpResponse.data;
    console.log('[Tenant Created Webhook] WordPress page created', { slug: loggedSlug });
    return NextResponse.json({ success: true, wp_data: wpResult }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[Tenant Created Webhook] Unhandled error during tenant sync', redactSensitive(message));
    return NextResponse.json({ error: 'Tenant sync failed' }, { status: 500 });
  }
}
