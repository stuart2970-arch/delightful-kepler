/**
 * Web-call start fields for the browser Vapi SDK.
 *
 * Do not attach `server.url`, `server.secret`, or `server.headers` here.
 * Vapi's web SDK sends a transient assistant from the browser; any secret
 * or header would be visible client-side. A transient `server.url` also
 * prevents Vapi from attaching the org credential (no X-Vapi-Secret).
 *
 * Set the org-level Server URL in Vapi to `{app}/api/webhooks/vapi` with
 * an X-Vapi-Secret credential. Phone-number imports still send
 * `server.secret` from the server-side provision route.
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
