export function buildWebCallVapiStartFields(webhookHost: string): {
  recordingEnabled: false;
  artifactPlan: { recordingEnabled: false };
  server: { url: string };
} {
  const host = webhookHost.replace(/\/+$/, '');
  return {
    recordingEnabled: false,
    artifactPlan: {
      recordingEnabled: false,
    },
    server: {
      url: `${host}/api/webhooks/vapi`,
    },
  };
}
