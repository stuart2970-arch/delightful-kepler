import { createClient } from '@supabase/supabase-js';

let cachedModel: { model: string; fetchedAt: number } | null = null;

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export const PRESET_GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Fastest, High Performance - Recommended)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Deep Reasoning & Large Context)' },
  { id: 'gemini-flash-latest', label: 'gemini-flash-latest (Auto-updates to Google\'s Latest Flash)' },
];

/**
 * Resolves the active Gemini model ID dynamically from Superadmin global settings.
 * Caches in memory for 60 seconds to maximize throughput and zero latency overhead.
 */
export async function getActiveGeminiModel(): Promise<string> {
  const now = Date.now();
  if (cachedModel && (now - cachedModel.fetchedAt < 60000)) {
    return cachedModel.model;
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceRoleKey) {
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: globalBot } = await supabaseAdmin
        .from('chatbots')
        .select('configuration_json')
        .eq('id', '00000000-0000-0000-0000-000000000000')
        .maybeSingle();

      const configuredModel = globalBot?.configuration_json?.default_gemini_model;
      if (configuredModel && typeof configuredModel === 'string' && configuredModel.trim()) {
        let resolved = configuredModel.trim().replace(/^models\//i, '');
        // Auto-upgrade deprecated Gemini model strings
        if (resolved === 'gemini-2.0-flash' || resolved === 'gemini-1.5-flash' || resolved === 'gemini-1.5-pro') {
          resolved = 'gemini-2.5-flash';
        }
        cachedModel = { model: resolved, fetchedAt: now };
        return resolved;
      }
    }
  } catch (err) {
    console.warn('[Gemini Config] Failed to fetch active model from DB, using fallback:', err);
  }

  let envModel = (process.env.DEFAULT_GEMINI_MODEL || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim().replace(/^models\//i, '');
  if (envModel === 'gemini-2.0-flash' || envModel === 'gemini-1.5-flash' || envModel === 'gemini-1.5-pro') {
    envModel = 'gemini-2.5-flash';
  }
  cachedModel = { model: envModel, fetchedAt: now };
  return envModel;
}

/**
 * Synchronously invalidates the local model cache when Superadmin updates settings.
 */
export function invalidateGeminiModelCache() {
  cachedModel = null;
}
