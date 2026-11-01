/**
 * STYL-226: Vapi credentials come from env only.
 * Never fall back to the production public key or assistant id.
 * Voice stays off unless VOICE_ENABLED is explicitly on and every Vapi
 * value is a non-placeholder, non-production credential.
 */

export const KNOWN_PRODUCTION_VAPI_IDS = [
  '1bb95940-1cb9-4c54-9b16-ba5bc11daae2',
  '3648bdcb-ccac-4acc-aee6-a4f9384743de',
] as const;

const VAPI_ENV_KEYS = [
  'VAPI_API_KEY',
  'VAPI_PRIVATE_API_KEY',
  'VAPI_PRIVATE_KEY',
  'VAPI_SECRET_KEY',
  'NEXT_PUBLIC_VAPI_PUBLIC_KEY',
  'VAPI_PUBLIC_KEY',
  'VAPI_MASTER_ASSISTANT_ID',
] as const;

const PLACEHOLDER_EXACT = new Set([
  '',
  'mock-vapi-key',
  'mock-vapi-public-key',
  'your-vapi-key',
  'changeme',
  'placeholder',
  'example',
  'dummy',
  'todo',
  'xxx',
  'test-key',
]);

export function getVapiPublicKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEXT_PUBLIC_VAPI_PUBLIC_KEY || env.VAPI_PUBLIC_KEY || '').trim();
}

export function getVapiMasterAssistantId(env: NodeJS.ProcessEnv = process.env): string {
  return (env.VAPI_MASTER_ASSISTANT_ID || '').trim();
}

export function getVapiPrivateKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env.VAPI_API_KEY || env.VAPI_PRIVATE_API_KEY || env.VAPI_PRIVATE_KEY || '').trim();
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

export function isVoiceFlagEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.VOICE_ENABLED || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes';
}

export function isPlaceholderVapiValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_EXACT.has(trimmed.toLowerCase())) return true;
  if (/^00000000-0000-0000-0000-0000000000/i.test(trimmed)) return true;
  if (/^(mock|placeholder|changeme|example|dummy|todo|xxx+|replace)[-_]/i.test(trimmed)) return true;
  if (/your[-_ ].+/i.test(trimmed)) return true;
  return false;
}

export function isKnownProductionVapiId(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return KNOWN_PRODUCTION_VAPI_IDS.some((id) => id.toLowerCase() === trimmed);
}

export function findUnsafeVapiEnvValues(
  env: NodeJS.ProcessEnv = process.env,
): { key: string; reason: 'placeholder' | 'production' }[] {
  const unsafe: { key: string; reason: 'placeholder' | 'production' }[] = [];
  for (const key of VAPI_ENV_KEYS) {
    const value = (env[key] || '').trim();
    if (!value) continue;
    if (isKnownProductionVapiId(value)) {
      unsafe.push({ key, reason: 'production' });
    } else if (isPlaceholderVapiValue(value)) {
      unsafe.push({ key, reason: 'placeholder' });
    }
  }
  return unsafe;
}

export type VoiceGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export function evaluateVoiceGate(env: NodeJS.ProcessEnv = process.env): VoiceGateResult {
  if (!isVoiceFlagEnabled(env)) {
    return { allowed: false, reason: 'Voice is currently unavailable.' };
  }
  const unsafe = findUnsafeVapiEnvValues(env);
  if (unsafe.length > 0) {
    const first = unsafe[0];
    return {
      allowed: false,
      reason:
        first.reason === 'production'
          ? 'Voice is currently unavailable: a Vapi value matches a known production ID.'
          : 'Voice is currently unavailable: a Vapi value is a placeholder.',
    };
  }
  return { allowed: true };
}

export function requireConfiguredAppUrl(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; url: string } | { ok: false; error: string } {
  const raw = (env.APP_URL || env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (!raw) {
    return { ok: false, error: 'APP_URL is not configured.' };
  }
  return { ok: true, url: raw };
}

export function publicVoiceFields(
  env: NodeJS.ProcessEnv = process.env,
): { vapiPublicKey: string; vapiAssistantId: string; voiceRuntimeAllowed: boolean } {
  const gate = evaluateVoiceGate(env);
  const config = getVapiRuntimeConfig(env);
  if (!gate.allowed) {
    return { vapiPublicKey: '', vapiAssistantId: '', voiceRuntimeAllowed: false };
  }
  return {
    vapiPublicKey: config.vapiPublicKey,
    vapiAssistantId: config.vapiAssistantId,
    voiceRuntimeAllowed: true,
  };
}

export function warnOrRefuseUnsafeVoiceAtStartup(
  env: NodeJS.ProcessEnv = process.env,
  logger: Pick<Console, 'warn' | 'error'> = console,
): VoiceGateResult {
  const gate = evaluateVoiceGate(env);
  if (!gate.allowed) {
    logger.warn(`[Voice] Refusing voice at start-up: ${gate.reason}`);
  }
  return gate;
}
