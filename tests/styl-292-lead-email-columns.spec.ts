import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import dotenv from 'dotenv'
import { loadConsolidatedLeadPreview } from '../src/lib/lead-notifier'

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function adminClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

test.describe('STYL-292 lead email columns', () => {
  test('preview uses the real business name and a non-empty transcript', async () => {
    expect(serviceRoleKey, 'local service role key').not.toEqual('')
    expect(supabaseUrl).not.toContain('tkoasyjvrgaglofpzduq')
    expect(supabaseUrl).not.toContain('lriugykhrfnnouexqqhm')

    const admin = adminClient()
    const suffix = `${Date.now()}`
    const businessName = `Harbour Lead ${suffix}`
    const customerLine = `Please book a trim next Friday. Reach me at lead.${suffix}@example.test`
    const assistantLine = 'I can help you book that trim.'

    const { data: tenant, error: tenantErr } = await admin
      .from('tenants')
      .insert({ company_name: businessName, slug: `harbour-lead-${suffix}` })
      .select('id')
      .single()
    expect(tenantErr).toBeNull()
    const tenantId = tenant!.id

    try {
      const { data: chatbot, error: botErr } = await admin
        .from('chatbots')
        .insert({
          tenant_id: tenantId,
          name: 'Harbour Bot',
          configuration_json: { admin_email: `owner.${suffix}@example.test` },
        })
        .select('id')
        .single()
      expect(botErr).toBeNull()

      const { data: conversation, error: convErr } = await admin
        .from('conversations')
        .insert({
          tenant_id: tenantId,
          chatbot_id: chatbot!.id,
          user_session_id: `lead-${suffix}`,
          channel: 'web_chat',
        })
        .select('id')
        .single()
      expect(convErr).toBeNull()

      const { error: msgErr } = await admin.from('messages').insert([
        {
          tenant_id: tenantId,
          conversation_id: conversation!.id,
          sender_type: 'user',
          text_content: customerLine,
        },
        {
          tenant_id: tenantId,
          conversation_id: conversation!.id,
          sender_type: 'bot',
          text_content: assistantLine,
        },
      ])
      expect(msgErr).toBeNull()

      const preview = await loadConsolidatedLeadPreview({
        tenantId,
        chatbotId: chatbot!.id,
        conversationId: conversation!.id,
        channelType: 'chat',
      })

      expect(preview.businessName).toBe(businessName)
      expect(preview.businessName).not.toBe('StyleFlo Business')
      expect(preview.plainText).toContain(`Business: ${businessName}`)
      expect(preview.formattedTranscriptLines.join('\n')).toContain(`Customer: ${customerLine}`)
      expect(preview.formattedTranscriptLines.join('\n')).toContain(`Assistant: ${assistantLine}`)
      expect(preview.transcriptBlock.trim().length).toBeGreaterThan('--- CHAT TRANSCRIPT ---'.length)
      expect(preview.plainText).toContain(customerLine)
      expect(preview.plainText).not.toContain('No transcript available')
    } finally {
      await admin.from('tenants').delete().eq('id', tenantId)
    }
  })
})
