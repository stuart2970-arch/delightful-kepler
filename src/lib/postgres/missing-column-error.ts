export type PostgresLikeError = {
  code?: string | null;
  message?: string | null;
};

export function isPostgresMissingColumnError(error: PostgresLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  const message = String(error.message ?? '');
  return code === '42703' || code === 'PGRST204' || /column.*does not exist/i.test(message);
}

const MISSING_COLUMN_PATTERNS: RegExp[] = [
  /column\s+[\w.]+\.(\w+)\s+does not exist/i,
  /column\s+"([^"]+)"\s+of\s+relation\s+"[^"]+"\s+does not exist/i,
  /column\s+"([^"]+)"\s+does not exist/i,
  /Could not find the '([^']+)' column/i,
  /Could not find the "([^"]+)" column/i,
];

/**
 * Extracts a single missing column name from Postgres / PostgREST errors.
 * Returns null when the error is a missing-column class but the name cannot be parsed safely.
 */
export function missingPostgresColumnName(error: PostgresLikeError | null | undefined): string | null {
  const message = String(error?.message ?? '');
  for (const pattern of MISSING_COLUMN_PATTERNS) {
    const match = message.match(pattern);
    const name = match?.[1];
    if (name && /^[a-z][a-z0-9_]*$/i.test(name)) {
      return name;
    }
  }
  return null;
}

export const MINIMAL_TENANT_ACTIVE_ADDON_COLUMNS = [
  'id',
  'addon_catalog_id',
  'quantity',
  'is_active',
] as const;