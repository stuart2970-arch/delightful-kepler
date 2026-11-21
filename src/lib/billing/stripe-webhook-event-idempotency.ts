export type StripeWebhookClaimAction = 'process' | 'skip' | 'locked' | 'unavailable';

export type StripeWebhookClaimResult = {
  action: StripeWebhookClaimAction;
};

function isMissingRpc(error: unknown): boolean {
  const row = error as { code?: string; message?: string } | null;
  const code = String(row?.code ?? '');
  const message = String(row?.message ?? '');
  return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(message);
}

function isMissingTable(error: unknown): boolean {
  const row = error as { code?: string; message?: string } | null;
  const code = String(row?.code ?? '');
  const message = String(row?.message ?? '');
  return code === '42P01' || /stripe_webhook_processed_events/i.test(message);
}

function normalizeClaimAction(value: unknown): StripeWebhookClaimAction {
  const action = String(value ?? '').toLowerCase();
  if (action === 'skip' || action === 'locked') return action;
  if (action === 'process') return 'process';
  return 'unavailable';
}

export async function claimStripeWebhookEvent(
  supabaseAdmin: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> } | null,
  eventId: string | undefined,
  eventType: string | undefined,
): Promise<StripeWebhookClaimResult> {
  const id = (eventId || '').trim();
  if (!id || !supabaseAdmin) return { action: 'process' };

  const { data, error } = await supabaseAdmin.rpc('claim_stripe_webhook_event', {
    p_event_id: id,
    p_event_type: eventType || 'unknown',
  });

  if (error) {
    if (isMissingRpc(error) || isMissingTable(error)) return { action: 'unavailable' };
    throw new Error((error as { message?: string }).message || 'Could not claim Stripe webhook event');
  }

  return { action: normalizeClaimAction(data) };
}

export async function completeStripeWebhookEvent(
  supabaseAdmin: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }> } | null,
  eventId: string | undefined,
  success: boolean,
): Promise<void> {
  const id = (eventId || '').trim();
  if (!id || !supabaseAdmin) return;

  const { error } = await supabaseAdmin.rpc('complete_stripe_webhook_event', {
    p_event_id: id,
    p_success: success,
  });
  if (error && !isMissingRpc(error) && !isMissingTable(error)) {
    console.error('[Stripe Webhook] Failed to record webhook event completion:', error);
  }
}