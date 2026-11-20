import { createBookingOptions, handleCreateBooking } from '@/lib/booking/create-booking';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v3/CreateBooking
 *
 * Callers (11 Nov 2026): no in-repo HTTP client fetches this URL.
 * - Reserve with Google is the documented external caller (Google → this route).
 *   It is not accepted anonymously.
 * - Vapi server tool calls: X-Vapi-Secret, verified with the existing
 *   VAPI_WEBHOOK_SECRET helper (constant-time). Tenant comes from the assistant id.
 * - Widget: existing signed chat session (x-session-token). Tenant comes from the
 *   chatbot id in that token (the widget key).
 * The appointment insert uses the service role only after those checks.
 * Chat and voice still book through bookMeeting(), not this route.
 */
export async function POST(request: Request) {
  return handleCreateBooking(request);
}

export async function OPTIONS() {
  return createBookingOptions();
}
