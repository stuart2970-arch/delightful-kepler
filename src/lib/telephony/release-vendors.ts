import twilio from 'twilio';
import { secretsEqual } from '@/lib/security/secrets-equal';

export { secretsEqual };

export const telephonyReleaseCallLog = {
  twilio: 0,
  vapi: 0,
  dbClear: 0,
  reset() {
    this.twilio = 0;
    this.vapi = 0;
    this.dbClear = 0;
  },
};

export async function releaseTwilioNumber(numberToRelease: string): Promise<void> {
  telephonyReleaseCallLog.twilio += 1;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return;

  const client = twilio(accountSid, authToken);
  const incomingNumbers = await client.incomingPhoneNumbers.list({
    phoneNumber: numberToRelease,
    limit: 1,
  });
  if (incomingNumbers && incomingNumbers.length > 0) {
    const sid = incomingNumbers[0].sid;
    await client.incomingPhoneNumbers(sid).remove();
    console.log(`[Telephony Deprovisioning] Successfully released Twilio number SID: ${sid}`);
  } else {
    console.warn(`[Telephony Deprovisioning] Number ${numberToRelease} not found in Twilio account.`);
  }
}

export async function releaseVapiNumber(numberToRelease: string): Promise<void> {
  telephonyReleaseCallLog.vapi += 1;
  const vapiPrivateKey = process.env.VAPI_PRIVATE_API_KEY;
  if (!vapiPrivateKey) return;

  const listRes = await fetch('https://api.vapi.ai/phone-number', {
    headers: { Authorization: `Bearer ${vapiPrivateKey}` },
  });
  if (!listRes.ok) return;
  const vapiNumbers: any[] = await listRes.json();
  const target = vapiNumbers.find(
    (n: any) => n.number === numberToRelease || n.number === numberToRelease.replace('+', ''),
  );
  if (!target?.id) return;
  const delRes = await fetch(`https://api.vapi.ai/phone-number/${target.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${target ? vapiPrivateKey : ''}` },
  });
  if (delRes.ok) {
    console.log(`[Telephony Deprovisioning] Successfully deleted number ${target.id} from Vapi.`);
  } else {
    console.error('[Telephony Deprovisioning] Failed to delete number from Vapi:', await delRes.text());
  }
}

export function isInternalCronRequest(req: Request): boolean {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice('Bearer '.length).trim();
  return secretsEqual(token, cronSecret);
}
