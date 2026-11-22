export const ACCOUNT_RECORD_RETENTION_MAX_DAYS = 365
export const MESSAGE_RETENTION_MAX_DAYS = 90

export type RetentionSetting = {
  accountRecordRetentionDays: number
  messageRetentionDays: number
  accountRecordRetentionMaximumDays: number
  messageRetentionMaximumDays: number
}

export const defaultRetentionSetting = (): RetentionSetting => ({
  accountRecordRetentionDays: ACCOUNT_RECORD_RETENTION_MAX_DAYS,
  messageRetentionDays: MESSAGE_RETENTION_MAX_DAYS,
  accountRecordRetentionMaximumDays: ACCOUNT_RECORD_RETENTION_MAX_DAYS,
  messageRetentionMaximumDays: MESSAGE_RETENTION_MAX_DAYS,
})

export const parseRetentionDays = (value: unknown, maximum: number): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed)) return null
  if (parsed < 1 || parsed > maximum) return null
  return parsed
}
