import { type WordpressPublishConfig } from '@/lib/env/wordpress-publish';

export type WordpressFailureKind =
  | 'auth_forbidden'
  | 'token_mismatch'
  | 'not_found'
  | 'network'
  | 'unknown';

export type WordpressCreateBusinessResult =
  | { ok: true; data: unknown }
  | { ok: false; kind: WordpressFailureKind; status: number; message: string; logDetail: string };

function redactWordpressBody(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b[0-9a-fA-F]{24,}\b/g, '[redacted]')
    .replace(/(token|authorization|secret|password|api[_-]?key)(\s*[:=]\s*)(\S+)/gi, '$1$2[redacted]')
    .slice(0, 200);
}

export function classifyWordpressHttpFailure(status: number, bodyText: string): {
  kind: WordpressFailureKind;
  message: string;
  logDetail: string;
} {
  const logDetail = redactWordpressBody(bodyText);
  const lower = bodyText.toLowerCase();

  if (status === 401 || status === 403) {
    if (lower.includes('rest_forbidden') || lower.includes('rest_cannot')) {
      return {
        kind: 'auth_forbidden',
        message: 'WordPress refused the request (permission denied).',
        logDetail,
      };
    }
    if (lower.includes('invalid') && lower.includes('token')) {
      return {
        kind: 'token_mismatch',
        message: 'WordPress rejected the publish token.',
        logDetail,
      };
    }
    return {
      kind: 'token_mismatch',
      message: 'WordPress authentication failed.',
      logDetail,
    };
  }

  if (status === 404) {
    return {
      kind: 'not_found',
      message: 'WordPress publish endpoint was not found.',
      logDetail,
    };
  }

  if (status >= 500) {
    return {
      kind: 'network',
      message: 'WordPress returned a server error.',
      logDetail,
    };
  }

  return {
    kind: 'unknown',
    message: 'WordPress publishing failed.',
    logDetail,
  };
}

export function buildWordpressCreateBusinessBody(slug: string, title: string, token: string) {
  return JSON.stringify({ slug, title, token });
}

export async function postWordpressCreateBusiness(
  wpConfig: Extract<WordpressPublishConfig, { enabled: true }>,
  slug: string,
  title: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WordpressCreateBusinessResult> {
  const wpApiUrl = `${wpConfig.wordpressSiteUrl}/wp-json/styleflo/v1/create-business`;

  try {
    const wpRes = await fetchImpl(wpApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildWordpressCreateBusinessBody(slug, title, wpConfig.token),
    });

    if (!wpRes.ok) {
      const errText = await wpRes.text();
      const classified = classifyWordpressHttpFailure(wpRes.status, errText);
      return {
        ok: false,
        kind: classified.kind,
        status: wpRes.status,
        message: classified.message,
        logDetail: classified.logDetail,
      };
    }

    const data = await wpRes.json();
    return { ok: true, data };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'network error';
    return {
      ok: false,
      kind: 'network',
      status: 0,
      message: 'Could not reach WordPress.',
      logDetail: redactWordpressBody(message),
    };
  }
}
