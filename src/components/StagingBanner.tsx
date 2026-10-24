/**
 * STYL-203: Visible STAGING marker so QA never confuses staging with production.
 * Rendered only when APP_ENV / NEXT_PUBLIC_ENV is staging (server-side).
 */
export default function StagingBanner() {
  const appEnv = (
    process.env.APP_ENV ||
    process.env.NEXT_PUBLIC_ENV ||
    ''
  )
    .trim()
    .toLowerCase();

  if (appEnv !== 'staging') return null;

  return (
    <div
      role="status"
      aria-label="Staging environment"
      data-testid="staging-banner"
      style={{
        background: '#7a1f1f',
        color: '#fff',
        textAlign: 'center',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: '12px',
        fontWeight: 700,
        letterSpacing: '0.08em',
        padding: '6px 12px',
        zIndex: 9999,
      }}
    >
      STAGING — not production. Data is synthetic / non-customer.
    </div>
  );
}
