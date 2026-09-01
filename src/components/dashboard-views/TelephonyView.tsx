'use client';

import React, { useState } from 'react';
import { useDashboardStore } from '../../lib/store';

export default function TelephonyView() {
  const { tenantId, twilioShadowNumber, setTwilioShadowNumber, conversations } = useDashboardStore();
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

  const [isDeprovisioning, setIsDeprovisioning] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

  const handleDeprovision = async () => {
    setIsDeprovisioning(true);
    setError(null);
    try {
      const res = await fetch('/api/telephony/deprovision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId, confirmed_downgrade: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to release number');
      }
      setTwilioShadowNumber(null);
      setShowConfirmModal(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsDeprovisioning(false);
    }
  };

  // Phone calls strictly reflect calls routed via the dedicated phone number linked to the account
  const phoneCallLogs = conversations.filter(c => c.is_phone_call || (c.is_voice_call && c.user_session_id?.startsWith('phone_')));
  const selectedCallObj = phoneCallLogs.find(c => c.id === selectedCallId);

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl">
        <h2 className="text-2xl font-extrabold text-[var(--awb-color8)] mb-1">Phone Calls & AI Receptionist</h2>
        <p className="text-xs text-[var(--awb-color6)]">
          Manage your dedicated business phone number, view call forwarding setup instructions, and inspect phone call logs.
        </p>
      </div>

      {/* DEDICATED PHONE NUMBER & CALL FORWARDING CARD */}
      <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 md:p-8 rounded-2xl shadow-xl">
        {!twilioShadowNumber ? (
          <div className="flex flex-col items-center justify-center text-center space-y-5 py-8">
            <div className="w-16 h-16 bg-blue-50 border border-blue-200 text-[#198fd9] rounded-2xl flex items-center justify-center shadow-sm">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-[var(--awb-color8)]">Activate Your AI Phone Receptionist</h3>
            <p className="text-xs text-[var(--awb-color6)] max-w-lg leading-relaxed">
              Get a dedicated local UK phone number. Your AI receptionist will automatically answer calls forwarded from your business landline 24/7.
            </p>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-xl text-xs w-full max-w-md">
                {error}
              </div>
            )}
            <button
              onClick={handleProvision}
              disabled={isProvisioning}
              className="bg-[#198fd9] hover:bg-[#157ab9] text-white text-xs font-bold py-3 px-8 rounded-xl shadow-md transition-all flex items-center justify-center space-x-2"
            >
              {isProvisioning ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Provisioning Local Number...</span>
                </>
              ) : (
                <span>Generate My Dedicated AI Receptionist Number</span>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--awb-color6)] block mb-1">
                  Dedicated AI Phone Receptionist Number
                </span>
                <div className="bg-[var(--awb-color2)] border border-[var(--awb-color3)] text-[#260475] px-5 py-3 rounded-xl text-2xl font-mono font-bold tracking-wider inline-block shadow-inner">
                  {twilioShadowNumber}
                </div>
              </div>
              <button
                onClick={() => setShowConfirmModal(true)}
                className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
              >
                Release Phone Number
              </button>
            </div>

            <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-5 space-y-2 text-xs">
              <h4 className="text-[#260475] font-bold text-sm flex items-center gap-2">
                ℹ️ Next Steps: Activate Call Forwarding
              </h4>
              <p className="text-[var(--awb-color7)] leading-relaxed">
                Contact your phone provider (e.g., BT, Virgin, Vodafone) and enable <strong className="text-[#260475]">"Conditional Call Forwarding"</strong> (Forward on Busy or No-Answer) to your dedicated number above: <strong className="font-mono text-[#198fd9]">{twilioShadowNumber}</strong>.
              </p>
              <p className="text-[var(--awb-color6)] text-[11px] pt-1 border-t border-blue-200/60">
                <strong>Note:</strong> Do not cancel your existing business phone number. The AI receptionist catches missed calls automatically.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* PHONE CALL HISTORY INDEX */}
      <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 md:p-8 rounded-2xl shadow-xl space-y-6">
        <div>
          <h3 className="text-base font-bold text-[var(--awb-color8)]">Phone Call History & Transcripts</h3>
          <p className="text-xs text-[var(--awb-color6)] mt-0.5">
            Log of incoming calls received on your dedicated business phone number.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Phone Call List */}
          <div className="bg-[var(--awb-color2)] border border-[var(--awb-color3)] p-4 rounded-xl h-[500px] flex flex-col">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--awb-color8)] mb-3">
              Incoming Phone Calls ({phoneCallLogs.length})
            </h4>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 styleflo-scrollbar">
              {phoneCallLogs.length === 0 ? (
                <div className="text-center text-xs text-[var(--awb-color6)] py-16 px-4 space-y-2">
                  <p className="font-semibold text-[var(--awb-color7)]">No incoming phone calls logged yet.</p>
                  <p className="text-[11px]">Calls made to your dedicated number ({twilioShadowNumber || 'unprovisioned'}) will appear here with full audio recordings and transcripts.</p>
                </div>
              ) : (
                phoneCallLogs.map((call) => (
                  <button
                    key={call.id}
                    onClick={() => setSelectedCallId(call.id)}
                    className={`w-full text-left p-3 rounded-xl border text-xs transition-all flex flex-col gap-1.5 ${
                      selectedCallId === call.id
                        ? 'bg-blue-50 border-blue-300 text-[var(--awb-color8)] shadow-sm'
                        : 'bg-white border-[var(--awb-color3)] hover:bg-gray-50 text-[var(--awb-color7)]'
                    }`}
                  >
                    <div className="flex justify-between items-center w-full">
                      <span className="font-bold font-mono text-sm text-[#260475]">
                        📞 {call.user_session_id?.replace('phone_', '') || 'Incoming Call'}
                      </span>
                      <span className="text-[10px] text-[var(--awb-color6)] font-mono">
                        {call.created_at && !isNaN(new Date(call.created_at).getTime()) ? new Date(call.created_at).toLocaleDateString() : 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center w-full mt-1">
                      <span className="text-[10px] text-[var(--awb-color6)]">
                        {call.created_at && !isNaN(new Date(call.created_at).getTime()) ? new Date(call.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                      <div className="flex gap-1">
                        {call.resulted_in_booking && (
                          <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[9px] font-bold">📅 Booked</span>
                        )}
                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded text-[9px] font-bold">📞 Phone Call</span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Call Details & Audio Transcript Viewer */}
          <div className="bg-[var(--awb-color2)] border border-[var(--awb-color3)] p-4 rounded-xl h-[500px] flex flex-col">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--awb-color8)] mb-3">
              Call Recording & Transcript
            </h4>

            <div className="flex-1 overflow-y-auto p-4 bg-white border border-[var(--awb-color3)] rounded-xl styleflo-scrollbar">
              {selectedCallObj ? (
                <div className="space-y-4">
                  {selectedCallObj.recording_url && (
                    <div className="bg-[var(--awb-color2)] border border-[var(--awb-color3)] p-3.5 rounded-xl">
                      <h5 className="text-xs font-bold text-[var(--awb-color8)] mb-2">Voice Recording</h5>
                      <audio controls src={selectedCallObj.recording_url} className="w-full h-10" />
                    </div>
                  )}
                  <div className="bg-[var(--awb-color2)] border border-[var(--awb-color3)] p-3.5 rounded-xl">
                    <h5 className="text-xs font-bold text-[var(--awb-color8)] mb-2">Call Transcript</h5>
                    {selectedCallObj.transcript ? (
                      <div className="text-xs text-[var(--awb-color7)] whitespace-pre-wrap leading-relaxed">
                        {selectedCallObj.transcript}
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--awb-color6)] italic">No transcript recorded for this call.</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-[var(--awb-color6)] text-center italic px-4">
                  Select a phone call session from the list to listen to the audio recording and inspect transcripts.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Downgrade & Release Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="w-10 h-10 bg-rose-100 text-rose-700 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-[var(--awb-color8)]">Release Dedicated Phone Number?</h3>
            <p className="text-[var(--awb-color7)] text-xs leading-relaxed">
              Releasing your dedicated phone number <strong className="text-[#260475] font-mono">{twilioShadowNumber}</strong> is <strong>permanent</strong> and cannot be undone.
            </p>
            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-xs">
                {error}
              </div>
            )}
            <div className="flex space-x-3 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 bg-[var(--awb-color2)] hover:bg-[var(--awb-color3)] text-[var(--awb-color8)] font-semibold py-2 px-4 rounded-xl text-xs transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleDeprovision}
                disabled={isDeprovisioning}
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-semibold py-2 px-4 rounded-xl text-xs transition-all flex items-center justify-center space-x-2"
              >
                {isDeprovisioning ? (
                  <span>Releasing...</span>
                ) : (
                  <span>Yes, Release Number</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
