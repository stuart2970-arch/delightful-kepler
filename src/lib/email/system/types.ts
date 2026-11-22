export type SystemEmailContent = {
  subject: string
  html: string
  text: string
}

export type SystemEmailTemplate = {
  key: string
  sampleData: Record<string, string>
  render: (data: Record<string, string>) => SystemEmailContent
}

export type SystemEmailStatus = 'queued' | 'sent' | 'failed'

export type SystemEmailLogRow = {
  id: string
  created_at: string
  updated_at: string
  recipient: string
  template_key: string
  tenant_id: string | null
  status: SystemEmailStatus
  provider_id: string | null
  idempotency_key: string
  template_data: Record<string, string> | null
  error_message: string | null
  resend_of_id: string | null
}
