import type { SupabaseClient } from '@supabase/supabase-js'
import { assessName, stricterDecision, type NameOverride } from '@/lib/moderation/assess-name'
import type { NamePolicyContext, NamePolicyDecision } from '@/lib/moderation/messages'

async function loadOverrides(admin: SupabaseClient): Promise<NameOverride[]> {
  const { data, error } = await admin
    .from('moderation_terms')
    .select('term, kind, severity, action')
    .eq('source', 'superadmin')
  if (error) {
    throw new Error('Name check is unavailable.')
  }
  return (data || []) as NameOverride[]
}

export async function assessStoredName(
  admin: SupabaseClient,
  value: string,
  context: NamePolicyContext,
): Promise<NamePolicyDecision> {
  const overrides = await loadOverrides(admin)
  return assessName(value, context, overrides)
}

export async function assessPersonaNames(
  admin: SupabaseClient,
  name: unknown,
  configuration: unknown,
): Promise<NamePolicyDecision> {
  const overrides = await loadOverrides(admin)
  const config = configuration && typeof configuration === 'object'
    ? configuration as Record<string, unknown>
    : {}
  const agentName = typeof config.agent_name === 'string' ? config.agent_name : ''
  const botName = typeof name === 'string' ? name : ''
  return stricterDecision(
    assessName(botName, 'persona', overrides),
    assessName(agentName, 'persona', overrides),
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
