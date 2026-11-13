'use client';

import React, { useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useDashboardStore } from '@/lib/store';
import { stripCalendarTags } from '@/lib/calendar/availability';

interface PreviewTurn {
  role: 'user' | 'assistant';
  text: string;
}

const GLOBAL_BOT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Owner-only text preview of the salon's real receptionist.
 * Uses the same /api/chat/stream path as the widget, with preview mode so
 * bookings and customer notifications stay off. No voice.
 */
export default function ReceptionistPreview() {
  const { role, isSuperAdmin, chatbots, tenantName } = useDashboardStore();
  const bots = useMemo(
    () => (chatbots || []).filter((bot) => bot.id && bot.id !== GLOBAL_BOT_ID),
    [chatbots],
  );
  const [botId, setBotId] = useState(bots[0]?.id || '');
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<PreviewTurn[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId] = useState(() => `owner-${Date.now()}`);

  const canPreview = isSuperAdmin || role === 'owner' || role === 'admin';
  if (!canPreview) return null;

  const selected = bots.find((bot) => bot.id === botId) || bots[0];

  const send = async () => {
    const text = draft.trim();
    if (!text || !selected || sending) return;
    setDraft('');
    setError(null);
    const history = [...turns, { role: 'user' as const, text }];
    setTurns(history);
    setSending(true);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setError('Sign in again to test your receptionist.');
        return;
      }

      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          chatbotId: selected.id,
          sessionId,
          preview: true,
          messages: history.slice(0, -1).map((turn) => ({
            role: turn.role,
            content: turn.text,
          })),
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error || 'The preview could not reach your receptionist.');
        return;
      }

      const raw = await response.text();
      const reply = stripCalendarTags(raw).replace(/\s+\n/g, '\n').trim();
      setTurns([...history, { role: 'assistant', text: reply || 'No reply.' }]);
    } catch (err) {
      console.error(err);
      setError('The preview could not reach your receptionist.');
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      className="bg-white border border-[#f2f3f5] p-6 rounded-2xl shadow-sm space-y-4"
      data-testid="receptionist-preview"
      aria-label="Test your receptionist"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider font-bold text-amber-800">Preview</p>
          <h3 className="text-lg font-bold text-[#260475]">Test your receptionist</h3>
          <p className="text-xs text-[#434549] mt-1 max-w-xl">
            Text chat with {tenantName || 'your salon'}&apos;s receptionist, using the same knowledge as the website widget.
            Booking is turned off. This preview does not email, text, or WhatsApp anyone, and it does not start a voice call.
          </p>
        </div>
        {bots.length > 1 && (
          <label className="text-xs font-semibold text-[#212326]">
            Receptionist
            <select
              value={selected?.id || ''}
              onChange={(event) => {
                setBotId(event.target.value);
                setTurns([]);
              }}
              className="mt-1 block bg-white border border-[#f2f3f5] rounded-lg px-3 py-2 text-sm"
            >
              {bots.map((bot) => (
                <option key={bot.id} value={bot.id}>{bot.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!selected ? (
        <p className="text-sm text-[#434549]">Create a receptionist first, then you can test it here.</p>
      ) : (
        <>
          <div
            className="min-h-[180px] max-h-[360px] overflow-y-auto rounded-xl border border-[#f2f3f5] bg-[#f9f9fb] p-4 space-y-3"
            data-testid="receptionist-preview-transcript"
          >
            {turns.length === 0 && (
              <p className="text-sm text-[#434549]">
                {selected.configuration_json?.welcome_message || 'Ask a question your customers might ask.'}
              </p>
            )}
            {turns.map((turn, index) => (
              <p
                key={`${turn.role}-${index}`}
                className={`text-sm whitespace-pre-wrap ${turn.role === 'user' ? 'text-[#260475] font-semibold' : 'text-[#212326]'}`}
              >
                <span className="block text-[10px] uppercase tracking-wide text-[#434549] mb-0.5">
                  {turn.role === 'user' ? 'You' : 'Preview'}
                </span>
                {turn.text}
              </p>
            ))}
            {sending && <p className="text-xs text-[#434549]">Receptionist is replying…</p>}
          </div>
          {error && <p className="text-xs text-rose-700">{error}</p>}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="receptionist-preview-input">Message</label>
            <input
              id="receptionist-preview-input"
              data-testid="receptionist-preview-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask about opening hours or a service"
              className="flex-1 h-[46px] bg-white border border-[#f2f3f5] rounded-[6px] px-3 text-sm text-[#212326]"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="px-4 h-[46px] rounded-[6px] bg-[#260475] text-white text-sm font-bold disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </>
      )}
    </section>
  );
}
