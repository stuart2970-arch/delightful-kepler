/** Staff columns a signed-in tenant member may read. Token columns stay off this list. */
export type StaffPublicRow = {
  id: string
  tenant_id?: string
  name?: string
  google_calendar_id?: string | null
  google_connected?: boolean
  working_days?: Record<string, {
    unavailable?: boolean
    am?: { start?: string; end?: string } | null
    pm?: { start?: string; end?: string } | null
  }> | null
}

export const STAFF_PUBLIC_COLUMNS = [
  'id',
  'tenant_id',
  'chatbot_id',
  'user_id',
  'name',
  'email',
  'role',
  'bio',
  'avatar_url',
  'image_url',
  'specialist_product',
  'calendar_provider',
  'google_calendar_id',
  'google_connected',
  'microsoft_calendar_id',
  'working_days',
  'created_at',
].join(', ')
