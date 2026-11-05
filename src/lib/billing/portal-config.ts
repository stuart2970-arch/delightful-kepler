export type PortalActor = {
  role: string;
  isSuperAdmin: boolean;
};

export function resolvePortalConfigurationId(
  actor: PortalActor,
  env: NodeJS.ProcessEnv = process.env,
): { configurationId: string | undefined; fellBackToAdmin: boolean } {
  const ownerId = (env.STRIPE_PORTAL_CONFIG_OWNER || '').trim() || undefined;
  const adminId = (env.STRIPE_PORTAL_CONFIG_ADMIN || '').trim() || undefined;
  const wantsOwnerConfig = actor.isSuperAdmin || actor.role === 'owner';

  if (wantsOwnerConfig) {
    if (ownerId) return { configurationId: ownerId, fellBackToAdmin: false };
    console.error(
      '[Billing] STRIPE_PORTAL_CONFIG_OWNER is missing; using the admin (no-cancel) configuration. Never fail open.',
    );
    return { configurationId: adminId, fellBackToAdmin: true };
  }

  return { configurationId: adminId, fellBackToAdmin: false };
}
