import { createClient } from '@supabase/supabase-js';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { buildBrandedEmailHtml } from '@/lib/email/branded-email-layout';
import { isEnquiryDetailsEmailEnabled } from '@/lib/email/tenant-email-toggles';
import { resolveServerPublicAppOrigin } from '@/lib/env/public-app-url';
import { escapeHtml } from '@/lib/email/escape-html';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  customerName?: string;
}

/** Columns that exist on public.tenants and public.messages (init schema). */
export const LEAD_TENANT_SELECT = 'company_name';
export const LEAD_MESSAGE_SELECT = 'sender_type, text_content, created_at';

export interface ConsolidatedLeadPreview {
  businessName: string;
  chatbotName: string;
  adminEmail: string | null;
  emailDisplay: string;
  phoneDisplay: string;
  intentCategory: string;
  userIntentSnippet: string;
  formattedTranscriptLines: string[];
  transcriptBlock: string;
  plainText: string;
  capturedEmail: string | null;
  capturedPhone: string | null;
  conversation: Record<string, any> | null;
  currentContactSig: string;
}

/**
 * Loads the lead email body from columns that exist.
 * Does not send mail and does not write the conversation row.
 */
export async function loadConsolidatedLeadPreview(params: LeadNotificationParams): Promise<ConsolidatedLeadPreview> {
  const {
    tenantId,
    chatbotId,
    conversationId,
    newContactInfo,
    channelType = 'chat',
    voiceTranscript,
    customerName,
  } = params;

  const supabaseAdmin = getSupabaseAdmin();

  const [{ data: chatbot, error: chatbotError }, { data: tenant, error: tenantError }] = await Promise.all([
    supabaseAdmin.from('chatbots').select('name, configuration_json').eq('id', chatbotId).single(),
    supabaseAdmin.from('tenants').select(LEAD_TENANT_SELECT).eq('id', tenantId).single(),
  ]);

  if (chatbotError) {
    throw new Error(chatbotError.message);
  }
  if (tenantError) {
    throw new Error(tenantError.message);
  }

  const chatbotName = chatbot?.name || 'AI Chatbot';
  const businessName = (tenant as { company_name?: string | null } | null)?.company_name?.trim() || 'StyleFlo Business';
  const botConfig = (chatbot?.configuration_json || {}) as Record<string, any>;

  let adminEmail: string | null = botConfig.admin_email || botConfig.notification_email || null;

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
      adminEmail = authUser?.user?.email || null;
    }
  }

  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .maybeSingle();

  const { data: messages, error: messageError } = await supabaseAdmin
    .from('messages')
    .select(LEAD_MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (messageError) {
    throw new Error(messageError.message);
  }

  const allMessageTexts: string[] = [];
  const formattedTranscriptLines: string[] = [];

  if (messages && messages.length > 0) {
    messages.forEach((msg) => {
      const text = (msg.text_content || '').trim();
      if (text) {
        allMessageTexts.push(text);
        const role = msg.sender_type === 'user' ? 'Customer' : 'Assistant';
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

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
  const phoneRegex = /(?:(?:\+|00)\d{1,3}[\s-]*)?(?:0|\(\d+\))?[\s-]*\d{3,4}[\s-]*\d{3,4,5}/g;

  const extractedEmails = Array.from(new Set(combinedAllText.match(emailRegex) || []));
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

  let intentCategory = 'General Enquiry / Customer Assistance';
  const lowerText = combinedAllText.toLowerCase();

  if (lowerText.includes('book') || lowerText.includes('appointment') || lowerText.includes('slot') || lowerText.includes('availability') || lowerText.includes('schedule')) {
    intentCategory = 'Appointment & Booking Enquiry';
  } else if (lowerText.includes('price') || lowerText.includes('cost') || lowerText.includes('how much') || lowerText.includes('rate') || lowerText.includes('fee')) {
    intentCategory = 'Pricing & Fee Enquiry';
  } else if (lowerText.includes('service') || lowerText.includes('treatment') || lowerText.includes('cut') || lowerText.includes('style') || lowerText.includes('colour') || lowerText.includes('color')) {
    intentCategory = 'Services Enquiry';
  } else if (lowerText.includes('cancel') || lowerText.includes('reschedule') || lowerText.includes('change')) {
    intentCategory = 'Appointment Modification';
  }

  const firstUserMsg = messages?.find((m) => m.sender_type === 'user');
  const userIntentSnippet = firstUserMsg
    ? (firstUserMsg.text_content || '').trim()
    : (voiceTranscript || newContactInfo || 'Customer initiated contact with chatbot');

  let transcriptBlock = '';
  if (channelType === 'voice' || conversation?.is_voice_call) {
    transcriptBlock = `--- VOICE CALL TRANSCRIPT ---\n${voiceTranscript || conversation?.transcript || 'Voice call completed.'}`;
  } else {
    transcriptBlock = `--- CHAT TRANSCRIPT ---\n${formattedTranscriptLines.length > 0 ? formattedTranscriptLines.join('\n') : (combinedAllText || 'No transcript available.')}`;
  }

  const plainText = `
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
- Primary Enquiry: "${userIntentSnippet}"
--------------------------------------------------
${transcriptBlock}
--------------------------------------------------
Log into your StyleFlo Dashboard to view and manage this conversation.
==================================================
`.trim();

  return {
    businessName,
    chatbotName,
    adminEmail,
    emailDisplay,
    phoneDisplay,
    intentCategory,
    userIntentSnippet,
    formattedTranscriptLines,
    transcriptBlock,
    plainText,
    capturedEmail: extractedEmails[0] || null,
    capturedPhone: extractedPhones[0] || null,
    conversation: conversation as Record<string, any> | null,
    currentContactSig: `${emailDisplay}|${phoneDisplay}`,
  };
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
    customerName,
  } = params;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const draft = await loadConsolidatedLeadPreview(params);
    const {
      businessName,
      chatbotName,
      adminEmail,
      emailDisplay,
      phoneDisplay,
      intentCategory,
      userIntentSnippet,
      formattedTranscriptLines,
      transcriptBlock,
      plainText: plainTextBody,
      capturedEmail,
      capturedPhone,
      conversation,
      currentContactSig,
    } = draft;

    if (!adminEmail) {
      console.warn(`[Lead Notifier] No admin email address found for tenant ${tenantId} / chatbot ${chatbotId}`);
      return false;
    }

    const enquiryEmailOn = await isEnquiryDetailsEmailEnabled(tenantId);
    if (!enquiryEmailOn) {
      console.log(`[Lead Notifier] Enquiry details email is turned off for tenant ${tenantId}.`);
      return false;
    }

    // Deduplication & Consolidation Check
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
        captured_email: capturedEmail,
        captured_phone: capturedPhone,
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

    const dashboardUrl = `${resolveServerPublicAppOrigin().replace(/\/+$/, '')}/dashboard`;
    const channelLabel = channelType === 'voice' ? 'Voice call' : 'Web chat';
    const safeChatbot = escapeHtml(chatbotName);
    const safeBusiness = escapeHtml(businessName);
    const safeCustomer = customerName ? escapeHtml(customerName) : '';
    const safeEmail = escapeHtml(emailDisplay);
    const safePhone = escapeHtml(phoneDisplay);
    const safeIntent = escapeHtml(intentCategory);
    const safeSnippet = escapeHtml(userIntentSnippet);
    const transcriptHtml = escapeHtml(
      formattedTranscriptLines.length > 0
        ? formattedTranscriptLines.join('\n\n')
        : (voiceTranscript || transcriptBlock || 'No transcript text available.'),
    );
    const htmlBody = buildBrandedEmailHtml({
      title: 'New Lead Captured',
      subtitle: `Chatbot: ${safeChatbot} | Business: ${safeBusiness} | ${channelLabel}`,
      bodyHtml: `
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 20px;">
      <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 16px; color: #1e293b;">Consolidated contact details</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        ${safeCustomer ? `<tr><td style="padding: 4px 0; color: #64748b; width: 140px;">Customer name:</td><td style="padding: 4px 0; font-weight: 600; color: #0f172a;">${safeCustomer}</td></tr>` : ''}
        <tr>
          <td style="padding: 4px 0; color: #64748b; width: 140px;">Email:</td>
          <td style="padding: 4px 0; font-weight: 600; color: #0f172a;">${safeEmail}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #64748b; width: 140px;">Mobile:</td>
          <td style="padding: 4px 0; font-weight: 600; color: #0f172a;">${safePhone}</td>
        </tr>
      </table>
    </div>
    <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 18px; margin-bottom: 20px;">
      <p style="margin: 0 0 6px 0; font-size: 14px; font-weight: 600; color: #15803d;">Category: ${safeIntent}</p>
      <p style="margin: 0; font-size: 14px; color: #166534; font-style: italic;">&quot;${safeSnippet}&quot;</p>
    </div>
    <div style="background-color: #f1f5f9; border-radius: 8px; padding: 16px; font-size: 13px; color: #334155; max-height: 400px; overflow-y: auto; white-space: pre-wrap; font-family: monospace;">${transcriptHtml}</div>`,
      ctaHref: dashboardUrl,
      ctaLabel: 'View in StyleFlo Dashboard',
    });

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

export interface GdprNotificationParams {
  tenantId: string;
  businessName: string;
  tenantSlug?: string;
  customerIdentifier: string;
  requestedByEmail?: string;
  additionalNotes?: string;
}

/**
 * Sends a GDPR Right to be Forgotten notification email to StyleFlo Admin (admin@styleflo.ai)
 * containing the business details and customer identifier to be deleted by Superadmin.
 */
export async function sendGdprErasureRequestEmail(params: GdprNotificationParams): Promise<boolean> {
  const { tenantId, businessName, tenantSlug, customerIdentifier, requestedByEmail, additionalNotes } = params;

  const stylefloAdminEmail = process.env.STYLEFLO_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'admin@styleflo.ai';
  console.log(`[GDPR Notifier] Processing GDPR erasure request for tenant '${businessName}' (${tenantId}), target customer: '${customerIdentifier}'. Notifying ${stylefloAdminEmail}...`);

  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
    console.warn('[GDPR Notifier] Mailgun API credentials missing. Logging request locally: ', params);
    return true;
  }

  try {
    const mailgun = new Mailgun(formData);
    const mg = mailgun.client({
      username: 'api',
      key: process.env.MAILGUN_API_KEY,
      url: 'https://api.eu.mailgun.net',
    });

    const emailSubject = `[GDPR REQUEST] Right to be Forgotten - ${businessName}`;

    const plainTextBody = `
==================================================
GDPR RIGHT TO BE FORGOTTEN REQUEST SUBMITTED
==================================================
Business Name: ${businessName}
Tenant Slug: ${tenantSlug || 'N/A'}
Tenant ID: ${tenantId}
Requested By: ${requestedByEmail || 'B2B Admin via FloBot'}
Date & Time: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}

--------------------------------------------------
TARGET CUSTOMER TO ERASE / EXPORT:
Customer Identifier: ${customerIdentifier}
--------------------------------------------------
${additionalNotes ? `Notes: ${additionalNotes}\n--------------------------------------------------\n` : ''}

INSTRUCTIONS FOR SUPERADMIN:
1. Log into StyleFlo Platform God Mode: https://app.styleflo.ai/superadmin
2. Navigate to the 'Right to Forget' tab.
3. Select B2B Account '${businessName}' (${tenantSlug || tenantId}).
4. Enter '${customerIdentifier}' into the search field to inspect, export, or execute data erasure.
==================================================
`.trim();

    const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">🛡️ GDPR Right to be Forgotten Request</h2>
    <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">Business: <strong>${businessName}</strong></p>
  </div>
  
  <div style="padding: 24px;">
    <div style="background-color: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 18px; margin-bottom: 20px;">
      <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 16px; color: #991b1b;">
        🚨 Target Customer Details for Erasure
      </h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="padding: 6px 0; color: #64748b; width: 160px;">Target Customer:</td>
          <td style="padding: 6px 0; font-weight: 700; color: #991b1b; font-family: monospace;">${customerIdentifier}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Business Account:</td>
          <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${businessName} (${tenantSlug || tenantId})</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Requested By:</td>
          <td style="padding: 6px 0; color: #0f172a;">${requestedByEmail || 'B2B Admin via FloBot'}</td>
        </tr>
      </table>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; font-size: 14px; color: #334155; margin-bottom: 20px;">
      <h4 style="margin-top: 0; margin-bottom: 8px; font-size: 15px; color: #0f172a;">Action Required by StyleFlo Superadmin:</h4>
      <ol style="margin: 0; padding-left: 20px; line-height: 1.6;">
        <li>Log into <a href="https://app.styleflo.ai/superadmin" style="color: #2563eb; font-weight: 600;">StyleFlo Superadmin Portal</a>.</li>
        <li>Open the <strong>Right to Forget</strong> tab.</li>
        <li>Select B2B Business: <strong>${businessName}</strong>.</li>
        <li>Search for <strong>${customerIdentifier}</strong> to review, export, or execute safe data deletion.</li>
      </ol>
    </div>
  </div>
</div>
`.trim();

    await mg.messages.create(process.env.MAILGUN_DOMAIN, {
      from: `StyleFlo GDPR Bot <no-reply@${process.env.MAILGUN_DOMAIN}>`,
      to: [stylefloAdminEmail],
      subject: emailSubject,
      text: plainTextBody,
      html: htmlBody,
    });

    console.log(`[GDPR Notifier] Successfully sent GDPR erasure notification email to StyleFlo Admin (${stylefloAdminEmail})`);
    return true;
  } catch (err: any) {
    console.error('[GDPR Notifier] Error sending GDPR request email:', err);
    return false;
  }
}

