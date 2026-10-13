"use client";

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { trackPurchaseMeta, hasAdvertisingConsent, ensureFbqLoaded } from '@/lib/analytics';

function PaymentConfirmedContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const sessionId = searchParams.get('session_id') || searchParams.get('sessionId') || '';
  const paramAmount = searchParams.get('amount');
  const paramOrderId = searchParams.get('order_id') || searchParams.get('orderId');

  const [loading, setLoading] = useState(true);
  const [amountPaid, setAmountPaid] = useState<number>(() => {
    return paramAmount ? Number(paramAmount) : 9.99;
  });
  const [orderId, setOrderId] = useState<string>(() => {
    return paramOrderId || sessionId || 'sub_initial';
  });
  const [paymentVerified, setPaymentVerified] = useState(false);

  const hasFiredRef = useRef(false);

  // Helper to fire the Meta Pixel Purchase event once (direct fbq on top-level if consented, or postMessage to parent frame)
  const fireMetaPurchaseEvent = (amount: number, id: string) => {
    if (!id) return;
    const storageKey = `sf_pur_fired_${id}`;
    if (sessionStorage.getItem(storageKey) || hasFiredRef.current) {
      return;
    }

    const isFrame = typeof window !== 'undefined' && (window.self !== window.top);

    if (isFrame) {
      // In frame: unconditionally postMessage to parent (parent handles CookieYes consent check)
      trackPurchaseMeta(amount, id);
      hasFiredRef.current = true;
      sessionStorage.setItem(storageKey, 'true');
    } else {
      // Top-level direct visit: check local CookieYes advertising consent
      if (hasAdvertisingConsent()) {
        trackPurchaseMeta(amount, id);
        hasFiredRef.current = true;
        sessionStorage.setItem(storageKey, 'true');
      } else {
        console.log('[Analytics] Direct Purchase Meta event waiting for CookieYes advertising consent (ad_storage)');
      }
    }
  };

  useEffect(() => {
    let isMounted = true;

    async function loadSessionDetails() {
      if (!sessionId) {
        if (isMounted) {
          setLoading(false);
          setPaymentVerified(true);
          fireMetaPurchaseEvent(amountPaid, orderId);
        }
        return;
      }

      try {
        const res = await fetch(`/api/billing/session-details?session_id=${encodeURIComponent(sessionId)}`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            const finalAmount = Number(data.amount_paid) || amountPaid;
            const finalOrderId = data.order_id || orderId;
            setAmountPaid(finalAmount);
            setOrderId(finalOrderId);
            setPaymentVerified(true);
            setLoading(false);

            // Fire on page load, not on button click, with CookieYes consent check
            fireMetaPurchaseEvent(finalAmount, finalOrderId);
          }
        } else {
          if (isMounted) {
            setPaymentVerified(true);
            setLoading(false);
            fireMetaPurchaseEvent(amountPaid, orderId);
          }
        }
      } catch (err) {
        console.error('Failed to load session details', err);
        if (isMounted) {
          setPaymentVerified(true);
          setLoading(false);
          fireMetaPurchaseEvent(amountPaid, orderId);
        }
      }
    }

    loadSessionDetails();

    // Listen for real-time CookieYes consent updates if banner was pending
    const handleConsentUpdate = (event: any) => {
      console.log('[Analytics] Detected cookieyes_consent_update event');
      fireMetaPurchaseEvent(amountPaid, orderId);
    };

    document.addEventListener('cookieyes_consent_update', handleConsentUpdate);

    return () => {
      isMounted = false;
      document.removeEventListener('cookieyes_consent_update', handleConsentUpdate);
    };
  }, [sessionId]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center py-12 px-4 bg-[#FAF9FC] font-sans relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-[#7E5FBB]/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-[#260475]/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-lg bg-white border border-[#EBE7F2] rounded-3xl p-8 md:p-10 shadow-[0_12px_40px_rgba(74,31,82,0.08)] relative z-10 backdrop-blur-xl text-center">
        {loading ? (
          <div className="py-12 space-y-4">
            <div className="animate-spin w-10 h-10 border-4 border-[#7E5FBB] border-t-transparent rounded-full mx-auto"></div>
            <p className="text-sm font-semibold text-slate-600">Confirming your subscription payment...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Success Checkmark Icon */}
            <div className="w-20 h-20 bg-emerald-50 border-2 border-emerald-200 rounded-full flex items-center justify-center mx-auto text-emerald-600 text-3xl shadow-sm animate-in zoom-in duration-300">
              ✓
            </div>

            <div className="space-y-2">
              <span className="text-[11px] uppercase tracking-wider font-extrabold text-emerald-800 bg-emerald-100/70 px-3 py-1 rounded-full border border-emerald-200">
                Payment Confirmed
              </span>
              <h1 className="text-2xl font-black text-[#0F172A] tracking-tight pt-2">
                Welcome to StyleFlo AI!
              </h1>
              <p className="text-sm text-slate-600 max-w-sm mx-auto leading-relaxed">
                Your payment was successful and your 24/7 AI Receptionist subscription is now active.
              </p>
            </div>

            {/* Receipt / Order Summary Box */}
            <div className="bg-gradient-to-r from-[#F4EFFC] via-purple-50 to-[#FAF9FC] border border-[#7E5FBB]/30 rounded-2xl p-5 text-left space-y-3 shadow-2xs">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 font-medium">Status</span>
                <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-100/60 px-2.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Confirmed & Active
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 font-medium">Amount Paid</span>
                <span className="font-extrabold text-[#0F172A] text-sm">
                  £{amountPaid.toFixed(2)} GBP
                </span>
              </div>
              <div className="flex justify-between items-center text-xs pt-1 border-t border-purple-100">
                <span className="text-slate-500 font-medium">Payment Reference</span>
                <span className="font-mono text-[11px] text-[#7E5FBB] truncate max-w-[200px]" title={orderId}>
                  {orderId}
                </span>
              </div>
            </div>

            {/* Action Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="w-full bg-gradient-to-r from-[#260475] to-[#7E5FBB] hover:from-[#1d0359] hover:to-[#6a4ca2] text-white font-extrabold text-sm sm:text-base rounded-xl py-3.5 px-6 shadow-md shadow-[#7E5FBB]/25 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
              >
                Go to Workspace Dashboard →
              </button>
            </div>

            <p className="text-[11px] text-slate-400">
              A receipt has also been sent to your billing email address.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

export default function PaymentConfirmedPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#FAF9FC] text-slate-800 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-[#7E5FBB] border-t-transparent rounded-full"></div>
      </div>
    }>
      <PaymentConfirmedContent />
    </Suspense>
  );
}
