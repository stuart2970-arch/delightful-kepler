/**
 * Browser-safe fields for a web call. The widget posts these to
 * `/api/voice/web-call`, which creates the Vapi call with the webhook
 * header attached. Do not put `server.url`, `server.secret`, or
 * `server.headers` in the browser payload.
 */
export function buildWebCallVapiStartFields(_webhookHost?: string): {
  recordingEnabled: false;
  artifactPlan: { recordingEnabled: false };
} {
  return {
    recordingEnabled: false,
    artifactPlan: {
      recordingEnabled: false,
    },
  };
}
