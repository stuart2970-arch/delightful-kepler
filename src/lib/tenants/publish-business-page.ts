import type { SupabaseClient } from '@supabase/supabase-js';
import { getWordpressPublishConfig } from '@/lib/env/wordpress-publish';
import { postWordpressCreateBusiness } from '@/lib/wordpress/wordpress-api';

export type PublishBusinessPageResult =
  | { ok: true; finalSlug: string; cleanName: string; wordpressPublished: boolean; pageUrl?: string; wpData?: unknown; disabledReason?: string }
  | { ok: false; status: number; error: string; wordpressError?: string };

async function persistTenantRename(
  supabase: SupabaseClient,
  tenantId: string,
  cleanName: string,
  finalSlug: string,
  wordpressOrphanContext?: { wpPageCreated: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const payload = { company_name: cleanName, slug: finalSlug };

  const attemptUpdate = () =>
    supabase.from('tenants').update(payload).eq('id', tenantId).select('id').maybeSingle();

  let { data: updated, error: updateErr } = await attemptUpdate();
  if (!updateErr && updated?.id) {
    return { ok: true };
  }

  if (wordpressOrphanContext?.wpPageCreated) {
    console.warn('[Publish Business Page] DB update failed after WordPress page was created; retrying once', {
      tenantId,
      slug: finalSlug,
      detail: updateErr?.message || 'no row returned',
    });
    ({ data: updated, error: updateErr } = await attemptUpdate());
    if (!updateErr && updated?.id) {
      return { ok: true };
    }
    console.error('[Publish Business Page] ORPHAN: WordPress page exists but tenant rename did not persist', {
      tenantId,
      slug: finalSlug,
      detail: updateErr?.message || 'no row returned',
    });
  }

  return {
    ok: false,
    error: updateErr?.message || 'Tenant update did not change a row',
  };
}

export async function publishBusinessPageForTenant(
  supabase: SupabaseClient,
  tenantId: string,
  businessName: string,
): Promise<PublishBusinessPageResult> {
  const { data: existingTenant, error: existingErr } = await supabase
    .from('tenants')
    .select('slug, company_name')
    .eq('id', tenantId)
    .maybeSingle();

  if (existingErr || !existingTenant) {
    return { ok: false, status: 404, error: 'Tenant not found' };
  }

  const cleanName = businessName.trim();
  let baseSlug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!baseSlug) baseSlug = 'business';

  let finalSlug = baseSlug;
  let counter = 1;
  while (true) {
    const { data: conflicting } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', finalSlug)
      .neq('id', tenantId)
      .maybeSingle();

    if (!conflicting) break;
    finalSlug = `${baseSlug}-${counter}`;
    counter++;
  }

  const wpConfig = getWordpressPublishConfig();
  if (!wpConfig.enabled) {
    const persisted = await persistTenantRename(supabase, tenantId, cleanName, finalSlug);
    if (!persisted.ok) {
      return { ok: false, status: 500, error: persisted.error };
    }

    return {
      ok: true,
      finalSlug,
      cleanName,
      wordpressPublished: false,
      disabledReason: wpConfig.reason,
    };
  }

  const wpResult = await postWordpressCreateBusiness(wpConfig, finalSlug, cleanName);
  if (!wpResult.ok) {
    return {
      ok: false,
      status: wpResult.status > 0 ? wpResult.status : 502,
      error: wpResult.message,
      wordpressError: wpResult.kind,
    };
  }

  const persisted = await persistTenantRename(supabase, tenantId, cleanName, finalSlug, {
    wpPageCreated: true,
  });
  if (!persisted.ok) {
    return { ok: false, status: 500, error: persisted.error };
  }

  return {
    ok: true,
    finalSlug,
    cleanName,
    wordpressPublished: true,
    pageUrl: `${wpConfig.wordpressSiteUrl}/business/${finalSlug}`,
    wpData: wpResult.data,
  };
}