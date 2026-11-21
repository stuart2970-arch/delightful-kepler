'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { publicAppPath } from '@/lib/env/public-app-url';

type ManagePayload = {
  businessName: string;
  timezone: string;
  expiresAt: string;
  appointment: {
    id: string;
    status: string;
    customerName: string;
    serviceName: string;
    staffName: string;
    startTime: string;
    endTime: string;
  };
  availability?: {
    quickDaysTag?: string;
    quickTimesTag?: string;
  } | null;
};

function ManageBookingContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [data, setData] = useState<ManagePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rescheduleStart, setRescheduleStart] = useState('');
  const [rescheduleEnd, setRescheduleEnd] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setError('This manage link is invalid or has expired. Please contact the small business directly.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(publicAppPath(`/api/public/bookings/manage/${encodeURIComponent(token)}`));
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'This manage link is invalid or has expired. Please contact the small business directly.');
        setData(null);
      } else {
        setData(json);
      }
    } catch {
      setError('We could not load your booking. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function postAction(body: Record<string, string>) {
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await fetch(publicAppPath(`/api/public/bookings/manage/${encodeURIComponent(token)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error || 'Something went wrong.');
        return;
      }
      if (body.action === 'cancel') {
        setMessage('Your booking has been cancelled.');
        await load();
      } else {
        setMessage('Your booking has been rescheduled.');
        await load();
      }
    } catch {
      setMessage('Something went wrong. Please try again.');
    } finally {
      setActionLoading(false);
    }
  }

  const formattedStart =
    data?.appointment?.startTime &&
    new Date(data.appointment.startTime).toLocaleString('en-GB', {
      timeZone: data.timezone || 'Europe/London',
      dateStyle: 'full',
      timeStyle: 'short',
    });

  const isBooked = data?.appointment?.status === 'booked';

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h1 className="text-xl font-bold text-slate-900 mb-1">Manage your booking</h1>
        {data?.businessName && (
          <p className="text-sm text-slate-600 mb-4">{data.businessName}</p>
        )}

        {loading && <p className="text-sm text-slate-600">Loading…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {data && !loading && !error && (
          <>
            <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 text-sm text-slate-800 space-y-1 mb-4">
              <p>
                <span className="font-semibold">Service:</span> {data.appointment.serviceName}
              </p>
              <p>
                <span className="font-semibold">With:</span> {data.appointment.staffName}
              </p>
              <p>
                <span className="font-semibold">When:</span> {formattedStart}
              </p>
              <p>
                <span className="font-semibold">Status:</span>{' '}
                {isBooked ? 'Confirmed' : data.appointment.status}
              </p>
            </div>

            {message && <p className="text-sm text-indigo-700 mb-3">{message}</p>}

            {isBooked && (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => {
                    if (window.confirm('Cancel this appointment?')) {
                      void postAction({ action: 'cancel' });
                    }
                  }}
                  className="w-full py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
                >
                  Cancel booking
                </button>

                <RescheduleFields
                  disabled={actionLoading}
                  start={rescheduleStart}
                  end={rescheduleEnd}
                  onStartChange={setRescheduleStart}
                  onEndChange={setRescheduleEnd}
                  onSubmit={() => {
                    if (!rescheduleStart || !rescheduleEnd) {
                      setMessage('Enter a new start and end time (ISO format from your confirmation email or staff).');
                      return;
                    }
                    void postAction({
                      action: 'reschedule',
                      startTime: rescheduleStart,
                      endTime: rescheduleEnd,
                    });
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RescheduleFields(props: {
  disabled: boolean;
  start: string;
  end: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="border border-slate-200 rounded-xl p-4 space-y-2">
      <p className="text-sm font-semibold text-slate-800">Reschedule</p>
      <p className="text-xs text-slate-500">
        Enter the new slot times in ISO format (as shown in your booking confirmation), or use the chat assistant for interactive times.
      </p>
      <input
        type="text"
        placeholder="New start (ISO)"
        value={props.start}
        onChange={(e) => props.onStartChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
      />
      <input
        type="text"
        placeholder="New end (ISO)"
        value={props.end}
        onChange={(e) => props.onEndChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
      />
      <button
        type="button"
        disabled={props.disabled}
        onClick={props.onSubmit}
        className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50"
      >
        Confirm new time
      </button>
    </div>
  );
}

export default function ManageBookingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-sm text-slate-600">
          Loading…
        </div>
      }
    >
      <ManageBookingContent />
    </Suspense>
  );
}