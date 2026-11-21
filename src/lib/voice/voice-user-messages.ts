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

export function voiceUnavailableMessage(code?: string | null): string {
  if (!code) return VOICE_UNAVAILABLE_GENERIC;
  const friendly = FRIENDLY_BY_CODE[code as VoiceErrorCode];
  return friendly || VOICE_UNAVAILABLE_GENERIC;
}