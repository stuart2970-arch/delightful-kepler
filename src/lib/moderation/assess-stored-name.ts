import type { SupabaseClient } from '@supabase/supabase-js'
import { assessName, stricterDecision, type AssessNameOptions, type NameOverride } from '@/lib/moderation/assess-name'
import type { NamePolicyContext, NamePolicyDecision } from '@/lib/moderation/messages'

export async function loadNameOverrides(admin: SupabaseClient): Promise<NameOverride[]> {
  const { data, error } = await admin
    .from('moderation_terms')
    .select('term, kind, severity, action')
    .eq('source', 'superadmin')
  if (error) {
    throw new Error('Name check is unavailable.')
  }
  return (data || []) as NameOverride[]
}

export async function tenantIsHouse(
  admin: SupabaseClient,
  tenantId: string | null | undefined,
): Promise<boolean> {
  if (!tenantId) return false
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('id, slug')
    .eq('id', tenantId)
    .maybeSingle()
  if (tenantError) throw new Error('Name check is unavailable.')
  const { data: rows, error } = await admin
    .from('moderation_house_allowlist')
    .select('tenant_id, slug')
  if (error) throw new Error('Name check is unavailable.')
  const slug = typeof tenant?.slug === 'string' ? tenant.slug.trim().toLowerCase() : ''
  return (rows || []).some((row) => {
    if (row.tenant_id && row.tenant_id === tenantId) return true
    const allowed = typeof row.slug === 'string' ? row.slug.trim().toLowerCase() : ''
    return allowed.length > 0 && allowed === slug
  })
}

export async function assessStoredName(
  admin: SupabaseClient,
  value: string,
  context: NamePolicyContext,
  options: AssessNameOptions = {},
): Promise<NamePolicyDecision> {
  const overrides = await loadNameOverrides(admin)
  return assessName(value, context, overrides, options)
}

export async function assessPersonaNames(
  admin: SupabaseClient,
  name: unknown,
  configuration: unknown,
  options: AssessNameOptions = {},
): Promise<NamePolicyDecision> {
  const overrides = await loadNameOverrides(admin)
  const config = configuration && typeof configuration === 'object'
    ? configuration as Record<string, unknown>
    : {}
  const agentName = typeof config.agent_name === 'string' ? config.agent_name : ''
  const botName = typeof name === 'string' ? name : ''
  return stricterDecision(
    assessName(botName, 'persona', overrides, options),
    assessName(agentName, 'persona', overrides, options),
  )
}

export async function recordNameDecision(
  admin: SupabaseClient,
  input: {
    context: NamePolicyContext
    decision: NamePolicyDecision
    value: string
    tenantId?: string | null
  },
): Promise<void> {
  if (input.decision.action === 'allow') return
  const { error } = await admin.from('moderation_events').insert({
    context: input.context,
    action: input.decision.action,
    term: input.decision.term,
    value_text: input.value.slice(0, 500),
    tenant_id: input.tenantId ?? null,
  })
  if (error) {
    console.error('[moderation] event log failed:', error.message)
  }
}
