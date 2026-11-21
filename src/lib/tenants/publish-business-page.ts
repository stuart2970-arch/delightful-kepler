import type { SupabaseClient } from '@supabase/supabase-js';
import { getWordpressPublishConfig } from '@/lib/env/wordpress-publish';
import { postWordpressCreateBusiness } from '@/lib/wordpress/wordpress-api';

export type PublishBusinessPageResult =
  | { ok: true; finalSlug: string; cleanName: string; wordpressPublished: boolean; pageUrl?: string; wpData?: unknown; disabledReason?: string }
  | { ok: false; status: number; error: string; wordpressError?: string };

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
    const { error: updateErr } = await supabase
      .from('tenants')
      .update({
        company_name: cleanName,
        slug: finalSlug,
      })
      .eq('id', tenantId);

    if (updateErr) {
      return { ok: false, status: 500, error: updateErr.message };
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

  const { error: updateErr } = await supabase
    .from('tenants')
    .update({
      company_name: cleanName,
      slug: finalSlug,
    })
    .eq('id', tenantId);

  if (updateErr) {
    return { ok: false, status: 500, error: updateErr.message };
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