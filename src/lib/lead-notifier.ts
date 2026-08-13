import { createClient } from '@supabase/supabase-js';
import formData from 'form-data';
import Mailgun from 'mailgun.js';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://tkoasyjvrgaglofpzduq.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrb2FzeWp2cmdhZ2xvZnB6ZHVxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU5NTcwNSwiZXhwIjoyMDk3MTcxNzA1fQ.VyWIQX2CFUUsAyDakbIEX805sz35TxHnjcAxBPWxliw';

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface LeadNotificationParams {
  tenantId: string;
  chatbotId: string;
  conversationId: string;
  newContactInfo?: string;
  channelType?: 'chat' | 'voice' | 'openclaw';
  voiceTranscript?: string;
  voiceRecordingUrl?: string;
  customerName?: string;
}

/**
 * Consolidates email and mobile phone number into 1 email notification for the chatbot involved,
 * including customer intent summary and full chat or voice conversation transcript.
 */
export async function sendConsolidatedLeadEmail(params: LeadNotificationParams): Promise<boolean> {
  const {
    tenantId,
    chatbotId,
    conversationId,
    newContactInfo,
    channelType = 'chat',
    voiceTranscript,
    voiceRecordingUrl,
    customerName,
  } = params;

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Fetch chatbot details & tenant business name
    const [{ data: chatbot }, { data: tenant }] = await Promise.all([
      supabaseAdmin.from('chatbots').select('name, configuration_json').eq('id', chatbotId).single(),
      supabaseAdmin.from('tenants').select('name').eq('id', tenantId).single(),
    ]);

    const chatbotName = chatbot?.name || 'AI Chatbot';
    const businessName = tenant?.name || 'StyleFlo Business';
    const botConfig = (chatbot?.configuration_json || {}) as Record<string, any>;

    // 2. Resolve target admin email address
    let adminEmail = botConfig.admin_email || botConfig.notification_email;

    if (!adminEmail) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('role', 'owner')
        .limit(1)
        .maybeSingle();

      if (profile) {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(profile.id);
        adminEmail = authUser?.user?.email;
      }
    }

    if (!adminEmail) {
      console.warn(`[Lead Notifier] No admin email address found for tenant ${tenantId} / chatbot ${chatbotId}`);
      return false;
    }

    // 3. Fetch conversation and message history
    const { data: conversation } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .maybeSingle();

    const { data: messages } = await supabaseAdmin
      .from('messages')
      .select('sender_type, sender_role, text_content, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    // Build list of message texts
    const allMessageTexts: string[] = [];
    const formattedTranscriptLines: string[] = [];

    if (messages && messages.length > 0) {
      messages.forEach((msg) => {
        const text = (msg.text_content || msg.content || '').trim();
        if (text) {
          allMessageTexts.push(text);
          const role = (msg.sender_type === 'user' || msg.sender_role === 'user') ? 'Customer' : 'Assistant';
          formattedTranscriptLines.push(`${role}: ${text}`);
        }
      });
    }

    if (voiceTranscript) {
      allMessageTexts.push(voiceTranscript);
    }

    if (newContactInfo) {
      allMessageTexts.push(newContactInfo);
    }

    const combinedAllText = allMessageTexts.join('\n');

    // 4. Extract and consolidate Email & Mobile Phone Number
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
    const phoneRegex = /(?:(?:\+|00)\d{1,3}[\s-]*)?(?:0|\(\d+\))?[\s-]*\d{3,4}[\s-]*\d{3,4,5}/g;

    const extractedEmails = Array.from(new Set(combinedAllText.match(emailRegex) || []));
    
    // Filter raw phone matches to valid mobile/tel numbers (min 7 digits)
    const rawPhones = combinedAllText.match(phoneRegex) || [];
    const extractedPhones = Array.from(
      new Set(
        rawPhones
          .map((p) => p.trim())
          .filter((p) => p.replace(/\D/g, '').length >= 7 && !p.includes('@'))
      )
    );

    const emailDisplay = extractedEmails.length > 0 ? extractedEmails.join(', ') : 'Not provided yet';
    const phoneDisplay = extractedPhones.length > 0 ? extractedPhones.join(', ') : 'Not provided yet';

    // 5. Derive Customer Intent Summary
    let intentCategory = 'General Inquiry / Customer Assistance';
    const lowerText = combinedAllText.toLowerCase();

    if (lowerText.includes('book') || lowerText.includes('appointment') || lowerText.includes('slot') || lowerText.includes('availability') || lowerText.includes('schedule')) {
      intentCategory = 'Appointment & Booking Inquiry';
    } else if (lowerText.includes('price') || lowerText.includes('cost') || lowerText.includes('how much') || lowerText.includes('rate') || lowerText.includes('fee')) {
      intentCategory = 'Pricing & Fee Inquiry';
    } else if (lowerText.includes('service') || lowerText.includes('treatment') || lowerText.includes('cut') || lowerText.includes('style') || lowerText.includes('colour') || lowerText.includes('color')) {
      intentCategory = 'Services Inquiry';
    } else if (lowerText.includes('cancel') || lowerText.includes('reschedule') || lowerText.includes('change')) {
      intentCategory = 'Appointment Modification';
    }

    // Extract first user inquiry as primary intent snippet
    const firstUserMsg = messages?.find((m) => m.sender_type === 'user' || m.sender_role === 'user');
    const userIntentSnippet = firstUserMsg ? (firstUserMsg.text_content || firstUserMsg.content || '').trim() : (voiceTranscript || newContactInfo || 'Customer initiated contact with chatbot');

    // 6. Build Transcript Output
    let transcriptBlock = '';
    if (channelType === 'voice' || conversation?.is_voice_call) {
      transcriptBlock = `--- VOICE CALL TRANSCRIPT ---\n${voiceTranscript || conversation?.transcript || 'Voice call completed.'}`;
      if (voiceRecordingUrl || conversation?.recording_url) {
        transcriptBlock += `\n\nCall Recording: ${voiceRecordingUrl || conversation?.recording_url}`;
      }
    } else {
      transcriptBlock = `--- CHAT TRANSCRIPT ---\n${formattedTranscriptLines.length > 0 ? formattedTranscriptLines.join('\n') : (combinedAllText || 'No transcript available.')}`;
    }

    // 7. Deduplication & Consolidation Check
    const currentContactSig = `${emailDisplay}|${phoneDisplay}`;
    const prevContactSig = conversation?.configuration_json?.last_email_contact_sig;

    if (prevContactSig === currentContactSig) {
      console.log(`[Lead Notifier] Lead email already sent for conversation ${conversationId} with exact contacts (${currentContactSig}). Skipping duplicate.`);
      return true;
    }

    // Update conversation record with metadata
    if (conversation) {
      const updatedConvConfig = {
        ...(conversation.configuration_json || {}),
        last_email_contact_sig: currentContactSig,
        captured_email: extractedEmails[0] || null,
        captured_phone: extractedPhones[0] || null,
        last_lead_notification_at: new Date().toISOString(),
      };
      await supabaseAdmin.from('conversations').update({ configuration_json: updatedConvConfig }).eq('id', conversationId);
    }

    // 8. Mailgun Sending
    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
      console.error('[Lead Notifier] Mailgun API Key or Domain missing. Cannot send lead email.');
      return false;
    }

    const mailgun = new Mailgun(formData);
    const mg = mailgun.client({
      username: 'api',
      key: process.env.MAILGUN_API_KEY,
      url: 'https://api.eu.mailgun.net',
    });

    const isUpdateNotice = Boolean(prevContactSig);
    const subjectPrefix = isUpdateNotice ? '[Lead Update]' : '[New Lead]';
    const emailSubject = `${subjectPrefix} ${intentCategory} captured by ${chatbotName}`;

    const plainTextBody = `
==================================================
NEW LEAD CAPTURED BY AI CHATBOT
==================================================
Business: ${businessName}
Chatbot: ${chatbotName}
Channel: ${channelType === 'voice' ? 'Voice Call' : 'Web Chat'}
Date & Time: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}
${customerName ? `Customer Name: ${customerName}\n` : ''}
--------------------------------------------------
CONSOLIDATED CONTACT DETAILS:
- Email Address: ${emailDisplay}
- Mobile / Telephone: ${phoneDisplay}
--------------------------------------------------
CUSTOMER INTENT:
- Category: ${intentCategory}
- Primary Inquiry: "${userIntentSnippet}"
--------------------------------------------------
${transcriptBlock}
--------------------------------------------------
Log into your StyleFlo Dashboard to view and manage this conversation.
==================================================
`.trim();

    const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">New Lead Captured</h2>
    <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">Chatbot: <strong>${chatbotName}</strong> | Business: <strong>${businessName}</strong></p>
  </div>
  
  <div style="padding: 24px;">
    <!-- Consolidated Contacts Box -->
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 20px;">
      <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 16px; color: #1e293b; border-bottom: 1px solid #cbd5e1; padding-bottom: 8px;">
        📞 Consolidated Contact Details
      </h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        ${customerName ? `<tr><td style="padding: 4px 0; color: #64748b; width: 140px;">Customer Name:</td><td style="padding: 4px 0; font-weight: 600; color: #0f172a;">${customerName}</td></tr>` : ''}
        <tr>
          <td style="padding: 4px 0; color: #64748b; width: 140px;">Email Address:</td>
          <td style="padding: 4px 0; font-weight: 600; color: #0f172a;">${emailDisplay}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #64748b; width: 140px;">Mobile Tel Number:</td>
          <td style="padding: 4px 0; font-weight: 600; color: #0f172a;">${phoneDisplay}</td>
        </tr>
      </table>
    </div>

    <!-- Intent Summary Box -->
    <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 18px; margin-bottom: 20px;">
      <h3 style="margin-top: 0; margin-bottom: 8px; font-size: 16px; color: #166534;">
        🎯 Customer Intent
      </h3>
      <p style="margin: 0 0 6px 0; font-size: 14px; font-weight: 600; color: #15803d;">Category: ${intentCategory}</p>
      <p style="margin: 0; font-size: 14px; color: #166534; font-style: italic;">"${userIntentSnippet}"</p>
    </div>

    <!-- Full Transcript Box -->
    <div style="margin-bottom: 20px;">
      <h3 style="margin-top: 0; margin-bottom: 10px; font-size: 16px; color: #1e293b;">
        💬 Conversation & Message History
      </h3>
      <div style="background-color: #f1f5f9; border-radius: 8px; padding: 16px; font-size: 13px; color: #334155; max-height: 400px; overflow-y: auto; white-space: pre-wrap; font-family: monospace;">${formattedTranscriptLines.length > 0 ? formattedTranscriptLines.join('\n\n') : (voiceTranscript || combinedAllText || 'No transcript text available.')}</div>
    </div>

    ${voiceRecordingUrl || conversation?.recording_url ? `
    <div style="margin-bottom: 20px; padding: 12px; background-color: #eff6ff; border-radius: 6px; font-size: 14px;">
      🎙️ <strong>Call Recording:</strong> <a href="${voiceRecordingUrl || conversation?.recording_url}" target="_blank" style="color: #2563eb;">Listen to Voice Call</a>
    </div>
    ` : ''}

    <div style="text-align: center; margin-top: 28px;">
      <a href="https://app.styleflo.ai" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">View in StyleFlo Dashboard</a>
    </div>
  </div>
</div>
`.trim();

    await mg.messages.create(process.env.MAILGUN_DOMAIN, {
      from: `${chatbotName} <no-reply@${process.env.MAILGUN_DOMAIN}>`,
      to: [adminEmail],
      subject: emailSubject,
      text: plainTextBody,
      html: htmlBody,
    });

    console.log(`[Lead Notifier] Successfully sent 1 consolidated lead email to ${adminEmail} (Chatbot: ${chatbotName})`);
    return true;

  } catch (err: any) {
    console.error('[Lead Notifier] Error processing lead notification:', err);
    return false;
  }
}
