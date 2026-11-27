import { createClient } from '@supabase/supabase-js';

let cachedModel: { model: string; fetchedAt: number } | null = null;

export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

export const PRESET_GEMINI_MODELS = [
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (Fastest, High Performance - Recommended)' },
  { id: 'gemini-flash-latest', label: 'gemini-flash-latest (Auto-updates to Google\'s Latest Flash)' },
];

const LEGACY_GEMINI_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.5-flash-lite',
]);

const FLASH_LITE_PATTERN = /flash-lite/i;

/**
 * Maps retired or unsupported Gemini model IDs to the active default (STYL-425).
 */
export function normalizeGeminiModelId(raw: string, source?: string): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return DEFAULT_GEMINI_MODEL;

  const resolved = trimmed.replace(/^models\//i, '');
  const isLegacy = LEGACY_GEMINI_MODELS.has(resolved);
  const isFlashLite = FLASH_LITE_PATTERN.test(resolved);

  if (!isLegacy && !isFlashLite) {
    return resolved;
  }

  if (resolved !== DEFAULT_GEMINI_MODEL) {
    const suffix = source ? ` (source: ${source})` : '';
    console.warn(
      `[Gemini Config] Retired or unsupported model "${resolved}"${suffix}; using ${DEFAULT_GEMINI_MODEL}`,
    );
  }

  return DEFAULT_GEMINI_MODEL;
}

/**
 * Resolves the active Gemini model ID dynamically from Superadmin global settings.
 * Caches in memory for 60 seconds to maximize throughput and zero latency overhead.
 */
export async function getActiveGeminiModel(): Promise<string> {
  const now = Date.now();
  if (cachedModel && (now - cachedModel.fetchedAt < 60000)) {
    return normalizeGeminiModelId(cachedModel.model, 'cache');
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
        const resolved = normalizeGeminiModelId(configuredModel, 'superadmin');
        cachedModel = { model: resolved, fetchedAt: now };
        return resolved;
      }
    }
  } catch (err) {
    console.warn('[Gemini Config] Failed to fetch active model from DB, using fallback:', err);
  }

  const envModel = normalizeGeminiModelId(
    process.env.DEFAULT_GEMINI_MODEL || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    'env',
  );
  cachedModel = { model: envModel, fetchedAt: now };
  return envModel;
}

/**
 * Synchronously invalidates the local model cache when Superadmin updates settings.
 */
export function invalidateGeminiModelCache() {
  cachedModel = null;
}
