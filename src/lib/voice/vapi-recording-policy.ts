/**
 * STYL-384: every Vapi assistant/call payload must refuse recordings.
 * Overrides win over client or dashboard defaults.
 */

export const VAPI_NO_RECORDING_ASSISTANT_FLAGS = {
  recordingEnabled: false,
  videoRecordingEnabled: false,
  artifactPlan: {
    recordingEnabled: false,
    videoRecordingEnabled: false,
  },
} as const;

export type VapiAssistantLike = Record<string, unknown>;

export function applyVapiNoRecordingFlags(assistant: VapiAssistantLike): VapiAssistantLike {
  const artifactPlan =
    assistant.artifactPlan && typeof assistant.artifactPlan === 'object' && !Array.isArray(assistant.artifactPlan)
      ? (assistant.artifactPlan as Record<string, unknown>)
      : {};
  return {
    ...assistant,
    recordingEnabled: false,
    videoRecordingEnabled: false,
    artifactPlan: {
      ...artifactPlan,
      recordingEnabled: false,
      videoRecordingEnabled: false,
    },
  };
}

const RECORDING_URL_KEYS = ['recordingUrl', 'stereoRecordingUrl', 'videoRecordingUrl'] as const;

export function endOfCallReportContainsRecordingArtifact(
  message: Record<string, unknown>,
  call: Record<string, unknown>,
): boolean {
  const bags: unknown[] = [
    message?.artifact,
    call?.artifact,
    message,
    call,
  ];
  for (const bag of bags) {
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
    for (const key of RECORDING_URL_KEYS) {
      const value = (bag as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim()) return true;
    }
  }
  return false;
}