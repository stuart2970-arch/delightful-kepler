export type FailedPaymentStripeClient = {
  pauseCollection(subscriptionId: string): Promise<void>;
  restartBilling(subscriptionId: string, restartedAt: Date): Promise<{ nextBillingAt: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  writeOffInvoice(invoiceId: string): Promise<void>;
};
