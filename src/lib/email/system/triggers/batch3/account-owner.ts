import { createSystemEmailAdmin } from '../../admin'
import { isSystemEmailAddress, isSystemEmailTenantId } from '../../data'

export type AccountOwner = {
  tenantId: string
  businessName: string
  email: string
}

/** Earliest owner login on an active account. */
export async function readAccountOwner(tenantId: string): Promise<AccountOwner | null> {
  if (!isSystemEmailTenantId(tenantId)) return null
  const admin = createSystemEmailAdmin()
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('id, company_name, is_active')
    .eq('id', tenantId)
    .maybeSingle()
  if (tenantError || !tenant || tenant.is_active === false) return null

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (profileError || !profile?.id) return null

  const { data, error } = await admin.auth.admin.getUserById(profile.id)
  if (error || !data?.user?.email) return null
  const email = data.user.email.trim().toLowerCase()
  if (!isSystemEmailAddress(email)) return null
  return {
    tenantId,
    businessName: String(tenant.company_name || 'Your business'),
    email,
  }
}
