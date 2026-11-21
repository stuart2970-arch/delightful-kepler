import { VAPI_SERVER_MESSAGES } from '@/lib/voice/vapi-server';
import { applyVapiNoRecordingFlags } from '@/lib/voice/vapi-recording-policy';

export const VOICE_UNAVAILABLE_MESSAGE = 'Voice is currently unavailable.';

export function voiceUnavailableAssistantResponse(
  message = VOICE_UNAVAILABLE_MESSAGE,
  server?: { url: string; timeoutSeconds: number; headers: { 'X-Vapi-Secret': string } },
) {
  const assistant = applyVapiNoRecordingFlags({
    firstMessage: message,
    endCallMessage: message,
    maxDurationSeconds: 8,
    serverMessages: [...VAPI_SERVER_MESSAGES],
    ...(server ? { server } : {}),
  });
  return {
    assistant,
    assistantOverrides: assistant,
    messageResponse: {
      assistant,
      assistantOverrides: assistant,
    },
  };
}
