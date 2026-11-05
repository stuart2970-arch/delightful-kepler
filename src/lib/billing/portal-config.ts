export type PortalActor = {
  role: string;
  isSuperAdmin: boolean;
};

export type PortalConfigResult = {
  configurationId: string | null;
  fellBackToAdmin: boolean;
};

function readConfigId(env: NodeJS.ProcessEnv, name: 'STRIPE_PORTAL_CONFIG_OWNER' | 'STRIPE_PORTAL_CONFIG_ADMIN'): string | undefined {
  return (env[name] || '').trim() || undefined;
}

/**
 * Playwright-only: let request tests force missing portal env without
 * restarting the server. Ignored unless PLAYWRIGHT_TEST=true.
 */
export function portalEnvFromRequest(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (env.PLAYWRIGHT_TEST !== 'true') return env;
  const mode = (req.headers.get('x-test-stripe-portal-env') || '').trim();
  if (mode === 'missing-both') {
    return { ...env, STRIPE_PORTAL_CONFIG_OWNER: '', STRIPE_PORTAL_CONFIG_ADMIN: '' };
  }
  if (mode === 'missing-admin') {
    return { ...env, STRIPE_PORTAL_CONFIG_ADMIN: '' };
  }
  if (mode === 'missing-owner') {
    return { ...env, STRIPE_PORTAL_CONFIG_OWNER: '' };
  }
  return env;
}

/**
 * Never return a missing id for a session. Callers must 503 when
 * configurationId is null — Stripe's default config must not be used.
 */
export function resolvePortalConfigurationId(
  actor: PortalActor,
  env: NodeJS.ProcessEnv = process.env,
): PortalConfigResult {
  const ownerId = readConfigId(env, 'STRIPE_PORTAL_CONFIG_OWNER');
  const adminId = readConfigId(env, 'STRIPE_PORTAL_CONFIG_ADMIN');
  const wantsOwnerConfig = actor.isSuperAdmin || actor.role === 'owner';

  if (wantsOwnerConfig) {
    if (ownerId) return { configurationId: ownerId, fellBackToAdmin: false };
    console.error(
      '[Billing] STRIPE_PORTAL_CONFIG_OWNER is missing; using the admin (no-cancel) configuration. Never fail open.',
    );
    if (adminId) return { configurationId: adminId, fellBackToAdmin: true };
    console.error(
      '[Billing] STRIPE_PORTAL_CONFIG_ADMIN is also missing; refusing to create a portal session.',
    );
    return { configurationId: null, fellBackToAdmin: false };
  }

  if (adminId) return { configurationId: adminId, fellBackToAdmin: false };
  console.error(
    '[Billing] STRIPE_PORTAL_CONFIG_ADMIN is missing; refusing to create a portal session for an admin.',
  );
  return { configurationId: null, fellBackToAdmin: false };
}
