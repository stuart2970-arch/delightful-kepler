import { isBoltOnMetadata } from '@/lib/billing/bolt-on'
import { stripeSubscriptionIdFrom } from '@/lib/billing/process-stripe-webhook'
import { createSystemEmailAdmin } from '../../admin'
import { isSystemEmailTenantId } from '../../data'
import { BATCH2_BOLT_ON_ADDED, formatBatch2Date } from '../../templates/batch-2'
import { loadAccountEmailContext } from './account'
import { isBatch2SystemEmailEnabled } from './flag'
import { sendBatch2Email, type Batch2SendResult } from './send'

const PACK_CATEGORIES = new Set(['voice_pack', 'sms_pack'])

export type BoltOnAddEvent = {
  tenantId: string
  addonCatalogId: string
  activationId: string
  monthlyPricePence?: string
  partMonthChargePence?: string
  nextBillingDate?: string
}

export type BoltOnAddedResult =
  | { ok: true; status: 200; email: Batch2SendResult }
  | { ok: false; status: 400 | 404 | 422; message: string }

function token(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 80)
}

function metadataRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const data: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') data[key] = entry
  }
  return data
}

function activationToken(object: Record<string, unknown>, fallback: string): string {
  const subscriptionId = stripeSubscriptionIdFrom(object as Record<string, string>)
  if (subscriptionId) return token(subscriptionId)
  if (typeof object.id === 'string' && object.id.trim()) return token(object.id)
  return token(fallback)
}

export function boltOnAddsFromStripeEvent(event: {
  type?: string | null
  data?: { object?: unknown } | null
}): BoltOnAddEvent[] {
  const type = event.type || ''
  const object = (event.data?.object || {}) as Record<string, unknown>
  const metadata = metadataRecord(object.metadata)
  const adds: BoltOnAddEvent[] = []

  if (type === 'checkout.session.completed' || type === 'direct_payload') {
    const tenantId = metadata.tenant_id || (typeof object.client_reference_id === 'string' ? object.client_reference_id : '')
    if (!isSystemEmailTenantId(tenantId)) return []
    if (isBoltOnMetadata(metadata) && metadata.addon_catalog_id && metadata.is_one_off !== 'true') {
      adds.push({
        tenantId,
        addonCatalogId: metadata.addon_catalog_id,
        activationId: activationToken(object, 'checkout'),
        monthlyPricePence: metadata.custom_price_pence || metadata.price_pence || '',
      })
      return adds
    }
    const selected = (metadata.selected_addons || '').split(',').map((item) => item.trim()).filter(Boolean)
    const activationId = activationToken(object, 'checkout')
    for (const addonCatalogId of selected) {
      adds.push({ tenantId, addonCatalogId, activationId })
    }
    return adds
  }

  if (type === 'customer.subscription.updated') {
    const tenantId = metadata.tenant_id || ''
    const status = typeof object.status === 'string' ? object.status.toLowerCase() : ''
    if (!isSystemEmailTenantId(tenantId) || !isBoltOnMetadata(metadata) || !metadata.addon_catalog_id) return []
    if (metadata.is_one_off === 'true') return []
    if (status !== 'active' && status !== 'trialing') return []
    adds.push({
      tenantId,
      addonCatalogId: metadata.addon_catalog_id,
      activationId: activationToken(object, 'subscription'),
      monthlyPricePence: metadata.custom_price_pence || metadata.price_pence || '',
    })
  }

  return adds
}

export async function notifyBoltOnAdded(input: BoltOnAddEvent): Promise<BoltOnAddedResult> {
  const activationId = token(input.activationId)
  const addonCatalogId = input.addonCatalogId.trim()
  if (!isSystemEmailTenantId(input.tenantId) || !addonCatalogId || addonCatalogId.length > 80 || !activationId) {
    return { ok: false, status: 400, message: 'A bolt-on notice needs the account, the bolt-on and the purchase.' }
  }
  if (input.nextBillingDate && !formatBatch2Date(input.nextBillingDate)) {
    return { ok: false, status: 400, message: 'The next billing date must be a calendar date.' }
  }

  const admin = createSystemEmailAdmin()
  const { data: addon, error } = await admin
    .from('addon_catalog')
    .select('id, name, category, monthly_price_pence')
    .eq('id', addonCatalogId)
    .maybeSingle()
  if (error || !addon) {
    return { ok: false, status: 404, message: 'That bolt-on was not found.' }
  }
  if (PACK_CATEGORIES.has(String(addon.category || ''))) {
    return { ok: false, status: 400, message: 'Packs are not monthly bolt-ons.' }
  }

  const account = await loadAccountEmailContext(input.tenantId)
  if (!account.ok) return account

  const monthly = input.monthlyPricePence?.trim()
    || (Number.isInteger(addon.monthly_price_pence) ? String(addon.monthly_price_pence) : '')
  const name = typeof addon.name === 'string' && addon.name.trim() ? addon.name.trim() : 'bolt-on'

  const email = await sendBatch2Email({
    templateKey: BATCH2_BOLT_ON_ADDED,
    tenantId: account.account.tenantId,
    to: account.account.email,
    idempotencyKey: `batch2:bolt-on-added:${account.account.tenantId}:${addonCatalogId}:${activationId}`,
    data: {
      businessName: account.account.businessName,
      boltOnName: name,
      monthlyPricePence: monthly,
      partMonthChargePence: input.partMonthChargePence?.trim() || '',
      nextBillingDate: input.nextBillingDate || '',
      billingUrl: account.account.billingUrl,
    },
  })
  return { ok: true, status: 200, email }
}

/**
 * Called after a successful Stripe billing event. A send failure does not
 * change the webhook result. The same activation id does not send twice.
 */
export async function notifyBoltOnsAddedFromStripeEvent(event: {
  type?: string | null
  data?: { object?: unknown } | null
}): Promise<void> {
  if (!isBatch2SystemEmailEnabled()) return
  const adds = boltOnAddsFromStripeEvent(event)
  for (const add of adds) {
    try {
      const result = await notifyBoltOnAdded(add)
      if (!result.ok) {
        console.error('[system-email] bolt-on added email was not sent')
      }
    } catch {
      console.error('[system-email] bolt-on added email was not sent')
    }
  }
}
