export const VOICE_ERROR_CODES = {
  VOICE_GATE_OFF: 'voice_gate_off',
  VAPI_PLACEHOLDER: 'vapi_placeholder',
  VAPI_PRODUCTION_ID_BLOCKED: 'vapi_production_id_blocked',
  NO_PRIVATE_KEY: 'no_private_key',
  NO_WEBHOOK_SECRET: 'no_webhook_secret',
  VAPI_401: 'vapi_401',
  VAPI_UPSTREAM: 'vapi_upstream',
} as const;

export type VoiceErrorCode = (typeof VOICE_ERROR_CODES)[keyof typeof VOICE_ERROR_CODES];