'use client';

import React, { useState } from 'react';
import { useDashboardStore } from '../../lib/store';

export default function TelephonyView() {
  const { tenantId, twilioShadowNumber, setTwilioShadowNumber } = useDashboardStore();
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleProvision = async () => {
    setIsProvisioning(true);
    setError(null);
    try {
      const res = await fetch('/api/telephony/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to provision number');
      }
      setTwilioShadowNumber(data.number);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsProvisioning(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white mb-2">Voice Receptionist</h2>
          <p className="text-gray-400">Configure your dedicated AI phone number and call forwarding settings.</p>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm">
        {!twilioShadowNumber ? (
          <div className="flex flex-col items-center justify-center text-center space-y-6 py-12">
            <div className="w-20 h-20 bg-indigo-500/20 rounded-full flex items-center justify-center mb-2">
              <svg className="w-10 h-10 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-white">Activate Your AI Phone Receptionist</h3>
            <p className="text-gray-400 max-w-lg">
              Get a dedicated local UK phone number. Your AI receptionist will instantly answer any calls forwarded to this number, 24/7.
            </p>
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm w-full max-w-md">
                {error}
              </div>
            )}
            <button
              onClick={handleProvision}
              disabled={isProvisioning}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-8 rounded-xl shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center space-x-2"
            >
              {isProvisioning ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Provisioning Number...</span>
                </>
              ) : (
                <span>Generate My AI Receptionist Number</span>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-white mb-2">Your Dedicated Number</h3>
              <div className="flex items-center space-x-4">
                <div className="bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 px-6 py-4 rounded-xl text-3xl font-mono tracking-wider shadow-inner">
                  {twilioShadowNumber}
                </div>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6">
              <h4 className="text-amber-400 font-semibold text-lg mb-3 flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Next Steps: Activate Call Forwarding
              </h4>
              <p className="text-amber-200/80 mb-4 text-sm leading-relaxed">
                To activate your AI receptionist, please contact your current phone provider (e.g., BT, Virgin, Vodafone) and ask them to set up <strong className="text-amber-300">"Conditional Call Forwarding"</strong> (specifically, <em>Forward on Busy or No-Answer</em>) to your new dedicated number above.
              </p>
              <p className="text-amber-200/80 text-sm">
                <strong>Important:</strong> Do not cancel your existing landline or main business number. The AI receptionist works by catching the calls you can't answer.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
