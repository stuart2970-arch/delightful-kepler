import { sendSystemEmail, type SendSystemEmailResult } from '../../send-system-email'
import { isBatch2SystemEmailEnabled } from './flag'

export type Batch2SendResult =
  | { ok: true; skipped: true; reason: 'disabled' }
  | {
      ok: true
      skipped: false
      duplicate: boolean
      logId: string
      status: string
    }
  | {
      ok: false
      skipped: false
      code: string
      message: string
      logId?: string
    }

export async function sendBatch2Email(input: {
  templateKey: string
  tenantId: string
  to: string
  data: Record<string, string>
  idempotencyKey: string
}): Promise<Batch2SendResult> {
  if (!isBatch2SystemEmailEnabled()) {
    return { ok: true, skipped: true, reason: 'disabled' }
  }
  const result: SendSystemEmailResult = await sendSystemEmail({
    templateKey: input.templateKey,
    tenantId: input.tenantId,
    to: input.to,
    data: input.data,
    idempotencyKey: input.idempotencyKey,
  })
  if (!result.ok) {
    return {
      ok: false,
      skipped: false,
      code: result.code,
      message: result.message,
      logId: result.logId,
    }
  }
  return {
    ok: true,
    skipped: false,
    duplicate: result.duplicate,
    logId: result.logId,
    status: result.status,
  }
}
