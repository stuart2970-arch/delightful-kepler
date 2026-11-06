export const VOICE_UNAVAILABLE_MESSAGE = 'Voice is currently unavailable.';

export function voiceUnavailableAssistantResponse(message = VOICE_UNAVAILABLE_MESSAGE) {
  const assistant = {
    firstMessage: message,
    endCallMessage: message,
    maxDurationSeconds: 8,
    recordingEnabled: false,
    artifactPlan: {
      recordingEnabled: false,
    },
  };
  return {
    assistant,
    assistantOverrides: assistant,
    messageResponse: {
      assistant,
      assistantOverrides: assistant,
    },
  };
}
