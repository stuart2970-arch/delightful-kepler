/**
 * Server URL Vapi will POST call events to.
 *
 * A transient assistant created in the browser must not carry this object:
 * the secret would be visible to the page, and a client-supplied server URL
 * makes Vapi withhold the org credential. Phone-number imports and
 * server-created web calls set `headers['X-Vapi-Secret']` here instead.
 * `recordingEnabled` stays false. Recording URLs are never copied onto the assistant.
 */

export const VAPI_SERVER_MESSAGES = [
  'conversation-update',
  'end-of-call-report',
  'function-call',
  'hang',
  'speech-update',
  'status-update',
  'tool-calls',
  'transfer-destination-request',
  'handoff-destination-request',
  'user-interrupted',
  'assistant.started',
] as const;

export function vapiEndOfCallServer(
  appUrl: string,
  secret: string | undefined,
): { url: string; timeoutSeconds: number; headers: { 'X-Vapi-Secret': string } } | undefined {
  const trimmedSecret = (secret || '').trim();
  const base = (appUrl || '').trim().replace(/\/+$/, '');
  if (!trimmedSecret || !base) return undefined;
  return {
    url: `${base}/api/webhooks/vapi`,
    timeoutSeconds: 20,
    headers: { 'X-Vapi-Secret': trimmedSecret },
  };
}

const DROPPED_ASSISTANT_KEYS = new Set([
  'server',
  'serverUrl',
  'serverUrlSecret',
  'recordingUrl',
  'stereoRecordingUrl',
  'videoRecordingUrl',
  'pcapUrl',
]);

export function sealWebCallAssistant(
  input: Record<string, unknown> | null | undefined,
  webhook: { url: string; secret: string },
): Record<string, unknown> {
  const assistant: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (DROPPED_ASSISTANT_KEYS.has(key)) continue;
    assistant[key] = value;
  }
  assistant.recordingEnabled = false;
  assistant.artifactPlan = { recordingEnabled: false };
  assistant.serverMessages = [...VAPI_SERVER_MESSAGES];
  assistant.server = {
    url: webhook.url,
    timeoutSeconds: 20,
    headers: { 'X-Vapi-Secret': webhook.secret },
  };
  return assistant;
}
