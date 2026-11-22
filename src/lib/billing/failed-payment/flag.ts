export const FAILED_PAYMENT_FLOW_ENABLED_ENV = 'FAILED_PAYMENT_FLOW_ENABLED';

/** Default off. Production stays on the existing webhook until this is set to true. */
export function isFailedPaymentFlowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[FAILED_PAYMENT_FLOW_ENABLED_ENV] || '').trim().toLowerCase() === 'true';
}

/**
 * Runs a failed-payment step only when the flow is enabled.
 * A missing table or Stripe error is logged and replaced with `fallback`.
 */
export async function runFailedPaymentFlow<T>(
  label: string,
  run: () => Promise<T>,
  fallback: T,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  if (!isFailedPaymentFlowEnabled(env)) return fallback;
  try {
    return await run();
  } catch (error) {
    console.error(`[failed-payment] ${label}`, {
      message: error instanceof Error ? error.message : 'failed',
    });
    return fallback;
  }
}
