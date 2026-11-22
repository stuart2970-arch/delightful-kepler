export type FailedPaymentTransitionKind = 'pause' | 'restart' | 'cancel' | 'write_off';

export type FailedPaymentTransitionEvent = {
  kind: FailedPaymentTransitionKind;
  tenantId: string;
  caseId: string;
  stripeInvoiceId: string;
  stripeSubscriptionId: string | null;
  occurredAt: string;
  billingRestartedAt?: string | null;
  writtenOffInvoiceId?: string | null;
};

export type FailedPaymentTransitionHandler = (event: FailedPaymentTransitionEvent) => Promise<void>;

/**
 * Single extension point for a failed-payment transition.
 * Logs only. Email is a later package and must not be sent from here.
 */
export async function onFailedPaymentTransition(event: FailedPaymentTransitionEvent): Promise<void> {
  console.info('[failed-payment] transition', {
    kind: event.kind,
    tenantId: event.tenantId,
    caseId: event.caseId,
    stripeInvoiceId: event.stripeInvoiceId,
    occurredAt: event.occurredAt,
    billingRestartedAt: event.billingRestartedAt ?? null,
    writtenOffInvoiceId: event.writtenOffInvoiceId ?? null,
  });
}
