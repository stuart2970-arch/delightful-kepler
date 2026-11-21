import { VAPI_NO_RECORDING_ASSISTANT_FLAGS } from '@/lib/voice/vapi-recording-policy';

/**
 * Browser-safe fields for a web call. The widget posts these to
 * `/api/voice/web-call`, which creates the Vapi call with the webhook
 * header attached. Do not put `server.url`, `server.secret`, or
 * `server.headers` in the browser payload.
 */
export function buildWebCallVapiStartFields(_webhookHost?: string): typeof VAPI_NO_RECORDING_ASSISTANT_FLAGS {
  return {
    recordingEnabled: false,
    videoRecordingEnabled: false,
    artifactPlan: {
      recordingEnabled: false,
      videoRecordingEnabled: false,
    },
  };
}
