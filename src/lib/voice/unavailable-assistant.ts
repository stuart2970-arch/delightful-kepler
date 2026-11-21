import { VAPI_SERVER_MESSAGES } from '@/lib/voice/vapi-server';

export const VOICE_UNAVAILABLE_MESSAGE = 'Voice is currently unavailable.';

export function voiceUnavailableAssistantResponse(
  message = VOICE_UNAVAILABLE_MESSAGE,
  server?: { url: string; timeoutSeconds: number; headers: { 'X-Vapi-Secret': string } },
) {
  const assistant = {
    firstMessage: message,
    endCallMessage: message,
    maxDurationSeconds: 8,
    recordingEnabled: false,
    artifactPlan: {
      recordingEnabled: false,
    },
    serverMessages: [...VAPI_SERVER_MESSAGES],
    ...(server ? { server } : {}),
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
