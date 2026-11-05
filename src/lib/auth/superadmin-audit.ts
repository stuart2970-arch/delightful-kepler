export type SuperadminAuditEntry = {
  action: string;
  userId: string;
  tenantId: string;
  claimedTenantId?: string | null;
  detail?: Record<string, unknown>;
};

const entries: SuperadminAuditEntry[] = [];

/** In-process sink so tests can assert an audited superadmin path without a live DB write. */
export function recordSuperadminAudit(entry: SuperadminAuditEntry): void {
  entries.push(entry);
  console.info('[superadmin-audit]', JSON.stringify(entry));
}

export function getSuperadminAuditEntries(): SuperadminAuditEntry[] {
  return [...entries];
}

export function resetSuperadminAuditForTests(): void {
  entries.length = 0;
}
