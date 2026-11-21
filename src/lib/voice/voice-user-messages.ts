import type { VoiceErrorCode } from '@/lib/voice/voice-error-codes';
import { VOICE_ERROR_CODES } from '@/lib/voice/voice-error-codes';

/** Generic customer-facing copy when no specific code is known. */
export const VOICE_UNAVAILABLE_GENERIC = 'Voice is currently unavailable.';

const FRIENDLY_BY_CODE: Record<VoiceErrorCode, string> = {
  [VOICE_ERROR_CODES.VOICE_GATE_OFF]:
    'Voice is currently unavailable. Voice has not been enabled on the server yet.',
  [VOICE_ERROR_CODES.VAPI_PLACEHOLDER]:
    'Voice is currently unavailable. The voice service is still being set up.',
  [VOICE_ERROR_CODES.VAPI_PRODUCTION_ID_BLOCKED]:
    'Voice is currently unavailable.',
  [VOICE_ERROR_CODES.NO_PRIVATE_KEY]:
    'Voice is currently unavailable. Please try again later or continue in chat.',
  [VOICE_ERROR_CODES.NO_WEBHOOK_SECRET]:
    'Voice is currently unavailable. Please try again later or continue in chat.',
  [VOICE_ERROR_CODES.VAPI_401]:
    'Voice is currently unavailable. The voice service could not sign in. Please try again later.',
  [VOICE_ERROR_CODES.VAPI_UPSTREAM]:
    'Voice is currently unavailable. We could not reach the voice service. Please try again later.',
};

const KNOWN_VOICE_CODES = new Set<string>(Object.values(VOICE_ERROR_CODES));

export function isKnownVoiceErrorCode(code?: string | null): code is VoiceErrorCode {
  if (!code || !code.trim()) return false;
  return KNOWN_VOICE_CODES.has(code.trim());
}

export function voiceUnavailableMessage(code?: string | null): string {
  if (!isKnownVoiceErrorCode(code)) return VOICE_UNAVAILABLE_GENERIC;
  return FRIENDLY_BY_CODE[code];
}

/** Web-call failures: mapped copy only for known voice codes; else keep the server error text. */
export function webCallFailureMessage(code: unknown, serverError?: unknown): string {
  const codeStr = typeof code === 'string' ? code.trim() : '';
  if (isKnownVoiceErrorCode(codeStr)) {
    return voiceUnavailableMessage(codeStr);
  }
  const err = typeof serverError === 'string' ? serverError.trim() : '';
  if (err) return err;
  return 'Could not start the voice call.';
}