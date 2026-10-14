import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';
import { encryptToken } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase environment variables missing');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function voiceXmlResponse(xml: string) {
  return new NextResponse(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

/**
 * Twilio Inbound Voice Webhook for WhatsApp Voice Verification Fallback
 * Gathers speech transcription, extracts 6-digit code, stores it encrypted, and deletes audio immediately.
 */
export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const step = searchParams.get('step');

    let formData: FormData | null = null;
    let urlEncoded: URLSearchParams | null = null;
    try {
      formData = await req.formData();
    } catch {
      try {
        const bodyText = await req.text();
        urlEncoded = new URLSearchParams(bodyText);
      } catch {}
    }

    const getParam = (key: string) =>
      searchParams.get(key) ||
      (formData ? (formData.get(key) as string) : null) ||
      (urlEncoded ? urlEncoded.get(key) : null) ||
      '';

    const toNumber = getParam('To');
    const callSid = getParam('CallSid');
    const recordingSid = getParam('RecordingSid');
    const speechResult = getParam('SpeechResult') || '';

    // Step 2: Speech transcription callback
    if (step === 'transcribe' || speechResult) {
      console.log(`[Twilio Voice] Received speech transcription for call ${callSid}`);

      // Extract 6-digit verification code
      const codeMatch = speechResult.match(/\b(\d{3})-?(\d{3})\b/) || speechResult.match(/\b(\d)\s*(\d)\s*(\d)\s*(\d)\s*(\d)\s*(\d)\b/);

      if (codeMatch) {
        const codeDigits = codeMatch[1].length === 3 ? `${codeMatch[1]}${codeMatch[2]}` : `${codeMatch[1]}${codeMatch[2]}${codeMatch[3]}${codeMatch[4]}${codeMatch[5]}${codeMatch[6]}`;
        const supabaseAdmin = getSupabaseAdmin();
        const digitsTo = toNumber.replace(/[^\d]/g, '');
        const tailTo = digitsTo.slice(-9);

        const { data: verifyingAccounts } = await supabaseAdmin
          .from('whatsapp_accounts')
          .select('id, tenant_id, twilio_number_sid, display_phone')
          .in('status', ['verifying', 'pending'])
          .order('updated_at', { ascending: false });

        const matchedAccount = (verifyingAccounts || []).find((acc: any) => {
          const cleanDisplay = (acc.display_phone || '').replace(/[^\d]/g, '');
          return cleanDisplay.endsWith(tailTo) || (digitsTo && cleanDisplay.includes(digitsTo));
        });

        if (matchedAccount) {
          await supabaseAdmin.from('whatsapp_verification_codes').insert({
            tenant_id: matchedAccount.tenant_id,
            twilio_number_sid: matchedAccount.twilio_number_sid || null,
            phone_number: toNumber,
            code_enc: encryptToken(codeDigits),
            method: 'VOICE',
            expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          });
          console.log(`[Twilio Voice] Successfully saved voice verification code for tenant ${matchedAccount.tenant_id}`);
        }
      }

      // GDPR Compliance: Delete recording audio immediately if recordingSid was generated
      if (recordingSid && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        try {
          const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
          await client.recordings(recordingSid).remove();
          console.log(`[Twilio Voice] GDPR Audio Purge: Successfully deleted recording ${recordingSid}`);
        } catch (delErr) {
          console.warn('[Twilio Voice] Audio deletion warning:', delErr);
        }
      }

      const VoiceResponse = twilio.twiml.VoiceResponse;
      const twiml = new VoiceResponse();
      twiml.hangup();
      return voiceXmlResponse(twiml.toString());
    }

    // Step 1: Initial call reception -> Gather speech
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    const gather = twiml.gather({
      input: ['speech'],
      timeout: 6,
      speechTimeout: 'auto',
      action: '/api/webhooks/twilio/voice?step=transcribe',
      method: 'POST',
    });
    gather.say({ voice: 'Polly.Amy' }, 'Please speak the verification code clearly.');

    return voiceXmlResponse(twiml.toString());
  } catch (err: any) {
    console.error('[Twilio Voice Webhook] Error:', err);
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    twiml.hangup();
    return voiceXmlResponse(twiml.toString());
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
