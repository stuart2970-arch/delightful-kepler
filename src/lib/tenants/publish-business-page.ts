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

const SLUG_CLAIM_TABLE = 'tenant_publish_slug_claims';
const MAX_SLUG_RESERVE_ATTEMPTS = 64;

async function releasePublishSlugClaim(
  supabase: SupabaseClient,
  tenantId: string,
  slug: string,
): Promise<void> {
  await supabase.from(SLUG_CLAIM_TABLE).delete().eq('tenant_id', tenantId).eq('slug', slug);
}

async function reservePublishSlug(
  supabase: SupabaseClient,
  tenantId: string,
  baseSlug: string,
): Promise<{ ok: true; finalSlug: string } | { ok: false; error: string }> {
  let finalSlug = baseSlug;
  let counter = 1;

  for (let attempt = 0; attempt < MAX_SLUG_RESERVE_ATTEMPTS; attempt++) {
    const { data: tenantConflict } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', finalSlug)
      .neq('id', tenantId)
      .maybeSingle();

    if (tenantConflict) {
      finalSlug = `${baseSlug}-${counter}`;
      counter++;
      continue;
    }

    const { error: claimErr } = await supabase
      .from(SLUG_CLAIM_TABLE)
      .insert({ slug: finalSlug, tenant_id: tenantId });

    if (!claimErr) {
      return { ok: true, finalSlug };
    }

    if (claimErr.code === '23505') {
      finalSlug = `${baseSlug}-${counter}`;
      counter++;
      continue;
    }

    return { ok: false, error: claimErr.message };
  }

  return { ok: false, error: 'Could not reserve a unique publish slug' };
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

  const reserved = await reservePublishSlug(supabase, tenantId, baseSlug);
  if (!reserved.ok) {
    return { ok: false, status: 500, error: reserved.error };
  }
  const { finalSlug } = reserved;

  const wpConfig = getWordpressPublishConfig();
  if (!wpConfig.enabled) {
    const persisted = await persistTenantRename(supabase, tenantId, cleanName, finalSlug);
    if (!persisted.ok) {
      await releasePublishSlugClaim(supabase, tenantId, finalSlug);
      return { ok: false, status: 500, error: persisted.error };
    }

    await releasePublishSlugClaim(supabase, tenantId, finalSlug);

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
    await releasePublishSlugClaim(supabase, tenantId, finalSlug);
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

  await releasePublishSlugClaim(supabase, tenantId, finalSlug);

  return {
    ok: true,
    finalSlug,
    cleanName,
    wordpressPublished: true,
    pageUrl: `${wpConfig.wordpressSiteUrl}/business/${finalSlug}`,
    wpData: wpResult.data,
  };
}