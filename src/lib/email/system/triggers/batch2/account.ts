import { createSystemEmailAdmin } from '../../admin'
import { isSystemEmailTenantId } from '../../data'
import { embedAwarePublicPath } from '@/lib/env/embed-parent'

export type AccountEmailContext = {
  tenantId: string
  businessName: string
  email: string
  billingUrl: string
}

export type AccountEmailFailure = {
  ok: false
  status: 400 | 404 | 422
  message: string
}

export function billingUrl(): string {
  return embedAwarePublicPath('/dashboard?tab=billing')
}

export async function loadAccountEmailContext(tenantId: string): Promise<
  { ok: true; account: AccountEmailContext } | AccountEmailFailure
> {
  if (!isSystemEmailTenantId(tenantId)) {
    return { ok: false, status: 400, message: 'A tenant id is required.' }
  }
  const admin = createSystemEmailAdmin()
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('id, company_name')
    .eq('id', tenantId)
    .maybeSingle()
  if (tenantError || !tenant) {
    return { ok: false, status: 404, message: 'That account was not found.' }
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (profileError || !profile?.id) {
    return { ok: false, status: 422, message: 'This account has no owner email for notices.' }
  }

  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(profile.id)
  const email = authUser?.user?.email?.trim().toLowerCase() || ''
  if (authError || !email) {
    return { ok: false, status: 422, message: 'This account has no owner email for notices.' }
  }

  const businessName = typeof tenant.company_name === 'string' && tenant.company_name.trim()
    ? tenant.company_name.trim()
    : 'your business'

  return {
    ok: true,
    account: {
      tenantId,
      businessName,
      email,
      billingUrl: billingUrl(),
    },
  }
}
