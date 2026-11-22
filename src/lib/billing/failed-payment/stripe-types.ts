export type FailedPaymentStripeClient = {
  pauseCollection(subscriptionId: string): Promise<void>;
  restartBilling(subscriptionId: string): Promise<void>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  writeOffInvoice(invoiceId: string): Promise<void>;
};
