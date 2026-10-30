/**
 * STYL-226: Vapi credentials come from env only.
 * Never fall back to the production public key or assistant id.
 */

export function getVapiPublicKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEXT_PUBLIC_VAPI_PUBLIC_KEY || env.VAPI_PUBLIC_KEY || '').trim();
}

export function getVapiMasterAssistantId(env: NodeJS.ProcessEnv = process.env): string {
  return (env.VAPI_MASTER_ASSISTANT_ID || '').trim();
}

export function getVapiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): {
  vapiPublicKey: string;
  vapiAssistantId: string;
  voiceConfigured: boolean;
} {
  const vapiPublicKey = getVapiPublicKey(env);
  const vapiAssistantId = getVapiMasterAssistantId(env);
  return {
    vapiPublicKey,
    vapiAssistantId,
    voiceConfigured: Boolean(vapiPublicKey && vapiAssistantId),
  };
}
