'use client';

import React, { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useDashboardStore } from '../../lib/store';
import AddOnUpsellModal from '../AddOnUpsellModal';

interface AvailableNumber {
  phoneNumber: string;
  displayNumber: string;
  friendlyName: string;
  locality: string;
  numberType: 'local' | 'mobile';
}

export default function TelephonyView() {
  const { 
    tenantId, 
    twilioShadowNumber, 
    setTwilioShadowNumber, 
    twilioMobileNumber, 
    setTwilioMobileNumber, 
    conversations, 
    billingData 
  } = useDashboardStore();

  const channelFlags = billingData?.channelFlags || { has_landline: false, has_mobile: false, has_whatsapp: false };
  const hasPhoneAddon = channelFlags.has_landline || channelFlags.has_mobile;

  // Active channel view tab: 'landline' or 'mobile'
  const [activeChannelTab, setActiveChannelTab] = useState<'landline' | 'mobile'>('landline');

  useEffect(() => {
    if (!channelFlags.has_landline && channelFlags.has_mobile) {
      setActiveChannelTab('mobile');
    } else {
      setActiveChannelTab('landline');
    }
  }, [channelFlags.has_landline, channelFlags.has_mobile]);

  const [isProvisioning, setIsProvisioning] = useState(false);
  const [provisioningNumber, setProvisioningNumber] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<AvailableNumber[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [areaCode, setAreaCode] = useState('');
  const [upsellCategory, setUpsellCategory] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = supabaseUrl && supabaseAnonKey ? createBrowserClient(supabaseUrl, supabaseAnonKey) : null;

  const getAuthHeaders = async (baseHeaders: Record<string, string> = {}) => {
    const headers: Record<string, string> = { ...baseHeaders };
    if (supabase) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }
      } catch (e) {
        console.warn('Could not get session for auth header:', e);
      }
    }
    return headers;
  };

  // Search available numbers from Twilio
  const handleSearchNumbers = async () => {
    setIsSearching(true);
    setError(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/telephony/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          number_type: activeChannelTab,
          area_code: activeChannelTab === 'landline' ? areaCode || undefined : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to search available numbers');
      }
      setSearchResults(data.numbers || []);
      setHasSearched(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSearching(false);
    }
  };

  // Provision either a specifically selected number or the first available
  const handleProvision = async (chosenNumber?: string) => {
    setIsProvisioning(true);
    setProvisioningNumber(chosenNumber || 'quick_assign');
    setError(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/telephony/provision', {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          tenant_id: tenantId, 
          area_code: activeChannelTab === 'landline' ? areaCode || undefined : undefined,
          number_type: activeChannelTab,
          phone_number: chosenNumber || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to provision number');
      }

      if (activeChannelTab === 'mobile') {
        setTwilioMobileNumber(data.number);
      } else {
        setTwilioShadowNumber(data.number);
      }
      setSearchResults([]);
      setHasSearched(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsProvisioning(false);
      setProvisioningNumber(null);
    }
  };

  const [isDeprovisioning, setIsDeprovisioning] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

  const handleDeprovision = async () => {
    setIsDeprovisioning(true);
    setError(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/telephony/deprovision', {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          tenant_id: tenantId, 
          number_type: activeChannelTab,
          confirmed_downgrade: true 
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to release number');
      }

      if (activeChannelTab === 'mobile') {
        setTwilioMobileNumber(null);
      } else {
        setTwilioShadowNumber(null);
      }
      setShowConfirmModal(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsDeprovisioning(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(text);
    setTimeout(() => setCopyFeedback(null), 3000);
  };

  // Determine active number for currently selected channel
  const currentActiveNumber = activeChannelTab === 'mobile' ? twilioMobileNumber : twilioShadowNumber;
  const isChannelUnlocked = activeChannelTab === 'mobile' ? channelFlags.has_mobile : channelFlags.has_landline;

  // Phone calls strictly reflect calls routed via the dedicated phone numbers linked to the account
  const phoneCallLogs = conversations.filter(c => c.is_phone_call || (c.is_voice_call && c.user_session_id?.startsWith('phone_')));
  const selectedCallObj = phoneCallLogs.find(c => c.id === selectedCallId);

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header Banner */}
      <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-[var(--awb-color8)] mb-1">Phone Calls & AI Receptionist</h2>
          <p className="text-xs text-[var(--awb-color6)]">
            Manage your dedicated business phone numbers, search & select available numbers, set up call forwarding, and review call transcripts.
          </p>
        </div>
      </div>

      {/* BOLT-ON GATING: Require landline or mobile add-on */}
      {!hasPhoneAddon && !twilioShadowNumber && !twilioMobileNumber ? (
        <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 md:p-8 rounded-2xl shadow-xl">
          <div className="flex flex-col items-center justify-center text-center space-y-5 py-8">
            <div className="w-16 h-16 bg-amber-50 border border-amber-200 text-amber-600 rounded-2xl flex items-center justify-center shadow-sm text-2xl">
              🔒
            </div>
            <h3 className="text-xl font-bold text-[var(--awb-color8)]">Phone Channel Required</h3>
            <p className="text-xs text-[var(--awb-color6)] max-w-lg leading-relaxed">
              To activate your AI Phone Receptionist and select a dedicated business phone number, you need an active <strong className="text-[#260475]">Landline</strong> or <strong className="text-[#260475]">Mobile</strong> channel add-on.
            </p>
            <div className="flex gap-3 flex-wrap justify-center">
              <button
                onClick={() => setUpsellCategory('landline')}
                className="bg-[#198fd9] hover:bg-[#157ab9] text-white text-xs font-bold py-3 px-6 rounded-xl shadow-md transition-all"
              >
                📞 Add Landline (from £8.99/mo)
              </button>
              <button
                onClick={() => setUpsellCategory('mobile')}
                className="bg-[#260475] hover:bg-[#1e035e] text-white text-xs font-bold py-3 px-6 rounded-xl shadow-md transition-all"
              >
                📱 Add Mobile (from £10.99/mo)
              </button>
            </div>
          </div>
        </div>
      ) : (
      <>
      {/* CHANNEL TABS SELECTOR */}
      <div className="flex border-b border-[var(--awb-color3)] gap-3">
        <button
          onClick={() => { setActiveChannelTab('landline'); setSearchResults([]); setHasSearched(false); setError(null); }}
          className={`pb-3 px-4 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeChannelTab === 'landline'
              ? 'border-[#198fd9] text-[#198fd9]'
              : 'border-transparent text-[var(--awb-color6)] hover:text-[var(--awb-color8)]'
          }`}
        >
          <span>📞 Local Landline Number</span>
          {twilioShadowNumber ? (
            <span className="bg-emerald-500/10 text-emerald-600 text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold">
              ✓ Active
            </span>
          ) : channelFlags.has_landline ? (
            <span className="bg-amber-500/10 text-amber-600 text-[10px] px-2 py-0.5 rounded-full font-semibold">
              Setup Required
            </span>
          ) : (
            <span className="bg-gray-100 text-gray-500 text-[10px] px-2 py-0.5 rounded-full">
              Add-on Available
            </span>
          )}
        </button>

        <button
          onClick={() => { setActiveChannelTab('mobile'); setSearchResults([]); setHasSearched(false); setError(null); }}
          className={`pb-3 px-4 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeChannelTab === 'mobile'
              ? 'border-[#260475] text-[#260475]'
              : 'border-transparent text-[var(--awb-color6)] hover:text-[var(--awb-color8)]'
          }`}
        >
          <span>📱 Mobile Number</span>
          {twilioMobileNumber ? (
            <span className="bg-emerald-500/10 text-emerald-600 text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold">
              ✓ Active
            </span>
          ) : channelFlags.has_mobile ? (
            <span className="bg-amber-500/10 text-amber-600 text-[10px] px-2 py-0.5 rounded-full font-semibold">
              Setup Required
            </span>
          ) : (
            <span className="bg-gray-100 text-gray-500 text-[10px] px-2 py-0.5 rounded-full">
              Add-on Available
            </span>
          )}
        </button>
      </div>

      {/* DEDICATED PHONE NUMBER & SETUP CARD */}
      <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 md:p-8 rounded-2xl shadow-xl">
        
        {/* Cross-sell for non-active channel */}
        {!isChannelUnlocked && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-bold text-[#260475]">
                {activeChannelTab === 'mobile' ? '📱 Mobile Add-on Not Active' : '📞 Landline Add-on Not Active'}
              </h4>
              <p className="text-xs text-[var(--awb-color6)] mt-1">
                {activeChannelTab === 'mobile' 
                  ? 'Add a dedicated mobile number with 50–250 SMS messages and voice minutes.'
                  : 'Add a dedicated local UK landline number with 10–30 shared voice minutes.'}
              </p>
            </div>
            <button
              onClick={() => setUpsellCategory(activeChannelTab)}
              className="bg-[#260475] hover:bg-[#1e035e] text-white text-xs font-bold py-2.5 px-5 rounded-xl shadow-md transition-all whitespace-nowrap"
            >
              {activeChannelTab === 'mobile' ? 'Add Mobile (from £10.99/mo)' : 'Add Landline (from £8.99/mo)'}
            </button>
          </div>
        )}

        {/* CHANNEL NUMBER NOT YET PROVISIONED: SEARCH & SELECT UI */}
        {isChannelUnlocked && !currentActiveNumber ? (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--awb-color3)] pb-4">
              <div>
                <h3 className="text-lg font-bold text-[var(--awb-color8)]">
                  {activeChannelTab === 'landline' ? '📞 Select Your Local Landline Number' : '📱 Select Your Dedicated Mobile Number'}
                </h3>
                <p className="text-xs text-[var(--awb-color6)] mt-0.5">
                  {activeChannelTab === 'landline'
                    ? 'Search by your local area code (e.g. 0151, 0161, 020) to view available numbers and choose your preferred one.'
                    : 'Search and choose an authentic UK mobile number (07xxx) for your AI assistant.'}
                </p>
              </div>

              {/* Quick Assign fallback button */}
              <button
                onClick={() => handleProvision()}
                disabled={isProvisioning || isSearching}
                className="bg-[var(--awb-color2)] hover:bg-[var(--awb-color3)] text-[var(--awb-color8)] border border-[var(--awb-color3)] text-xs font-semibold py-2 px-4 rounded-xl shadow-sm transition-all whitespace-nowrap self-start sm:self-auto"
              >
                {isProvisioning && provisioningNumber === 'quick_assign' ? 'Assigning...' : '⚡ Quick Assign Next Available'}
              </button>
            </div>

            {/* Search Controls */}
            <div className="bg-[var(--awb-color2)] border border-[var(--awb-color3)] p-5 rounded-xl space-y-4">
              <div className="flex flex-col sm:flex-row items-end gap-3">
                {activeChannelTab === 'landline' && (
                  <div className="w-full sm:w-64">
                    <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--awb-color6)] mb-1.5 text-left">
                      Area Code (Optional)
                    </label>
                    <input
                      type="text"
                      value={areaCode}
                      onChange={(e) => setAreaCode(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="e.g. 0151, 0161, 020"
                      maxLength={5}
                      className="w-full bg-white border border-[var(--awb-color3)] text-[var(--awb-color8)] text-sm rounded-xl px-4 py-2.5 outline-none focus:border-[#198fd9] focus:ring-1 focus:ring-[#198fd9]/20 placeholder:text-[var(--awb-color6)]/50 font-mono"
                    />
                  </div>
                )}

                <button
                  onClick={handleSearchNumbers}
                  disabled={isSearching || isProvisioning}
                  className="w-full sm:w-auto bg-[#198fd9] hover:bg-[#157ab9] text-white text-xs font-bold py-3 px-6 rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
                >
                  {isSearching ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Searching UK Numbers...</span>
                    </>
                  ) : (
                    <span>🔍 {activeChannelTab === 'landline' ? 'Search Available Landline Numbers' : 'Search Available Mobile Numbers'}</span>
                  )}
                </button>
              </div>

              {activeChannelTab === 'landline' && (
                <p className="text-[11px] text-[var(--awb-color6)]">
                  Enter your local prefix (e.g. 0151 for Liverpool, 0161 for Manchester, 01925 for Warrington, 020 for London) or leave blank for general UK allocation.
                </p>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs">
                ⚠️ {error}
              </div>
            )}

            {/* SEARCH RESULTS LIST */}
            {hasSearched && (
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--awb-color8)]">
                  Available Numbers ({searchResults.length} Found)
                </h4>

                {searchResults.length === 0 ? (
                  <div className="text-center p-8 bg-[var(--awb-color2)] border border-[var(--awb-color3)] rounded-xl text-xs text-[var(--awb-color6)]">
                    No numbers currently available matching that area code. Try leaving the area code blank or searching a nearby town code.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {searchResults.map((item) => (
                      <div
                        key={item.phoneNumber}
                        className="bg-white border border-[var(--awb-color3)] p-4 rounded-xl shadow-sm hover:border-[#198fd9]/50 transition-all flex items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{item.numberType === 'mobile' ? '📱' : '📞'}</span>
                            <span className="font-mono text-base font-extrabold text-[#260475] tracking-wide">
                              {item.displayNumber}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] bg-blue-50 text-[#198fd9] px-2 py-0.5 rounded font-medium">
                              {item.locality || (item.numberType === 'mobile' ? 'UK Mobile' : 'UK Local')}
                            </span>
                            <span className="text-[10px] text-[var(--awb-color6)] font-mono">
                              {item.phoneNumber}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleProvision(item.phoneNumber)}
                          disabled={isProvisioning}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow transition-all whitespace-nowrap flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {isProvisioning && provisioningNumber === item.phoneNumber ? (
                            <span>Activating...</span>
                          ) : (
                            <>
                              <span>✓</span>
                              <span>Select Number</span>
                            </>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : isChannelUnlocked && currentActiveNumber ? (
          /* CHANNEL NUMBER IS PROVISIONED & ACTIVE */
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[var(--awb-color3)] pb-5">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-600 block mb-1">
                  ● Active Dedicated {activeChannelTab === 'mobile' ? 'Mobile' : 'Landline'} Number
                </span>
                <div className="flex items-center gap-3">
                  <div className="bg-[var(--awb-color2)] border border-[var(--awb-color3)] text-[#260475] px-5 py-2.5 rounded-xl text-2xl font-mono font-bold tracking-wider inline-block shadow-inner">
                    {currentActiveNumber}
                  </div>
                  <button
                    onClick={() => copyToClipboard(currentActiveNumber)}
                    className="p-2.5 rounded-xl border border-[var(--awb-color3)] hover:bg-gray-100 text-xs text-[var(--awb-color7)] transition-colors"
                    title="Copy Phone Number"
                  >
                    {copyFeedback === currentActiveNumber ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
              </div>

              <button
                onClick={() => setShowConfirmModal(true)}
                className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
              >
                Release / Change Number
              </button>
            </div>

            {/* Call Divert & Forwarding Guide */}
            <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-5 space-y-3 text-xs">
              <h4 className="text-[#260475] font-bold text-sm flex items-center gap-2">
                ℹ️ Call Forwarding & Divert Setup
              </h4>
              
              {activeChannelTab === 'landline' ? (
                <div className="space-y-2 text-[var(--awb-color7)] leading-relaxed">
                  <p>
                    Divert incoming calls from your existing salon telephone line to your dedicated AI receptionist number <strong className="font-mono text-[#198fd9]">{currentActiveNumber}</strong>:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                    <div className="bg-white p-2.5 rounded-lg border border-blue-100">
                      <strong className="block text-[#260475] font-sans">BT / Plusnet:</strong>
                      Divert all: <code>*21*{currentActiveNumber}#</code><br />
                      On no reply: <code>*61*{currentActiveNumber}#</code>
                    </div>
                    <div className="bg-white p-2.5 rounded-lg border border-blue-100">
                      <strong className="block text-[#260475] font-sans">Virgin Media:</strong>
                      Divert all: <code>*70{currentActiveNumber}</code><br />
                      On busy: <code>*76{currentActiveNumber}</code>
                    </div>
                    <div className="bg-white p-2.5 rounded-lg border border-blue-100">
                      <strong className="block text-[#260475] font-sans">Sky Talk:</strong>
                      Divert all: <code>*21*{currentActiveNumber}#</code><br />
                      Cancel divert: <code>#21#</code>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-[var(--awb-color7)] leading-relaxed">
                  <p>
                    Divert calls from your mobile handset to your AI receptionist number <strong className="font-mono text-[#260475]">{currentActiveNumber}</strong>:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                    <div className="bg-white p-2.5 rounded-lg border border-blue-100">
                      <strong className="block text-[#260475] font-sans">Divert When Unanswered:</strong>
                      Dial from handset: <code>**61*{currentActiveNumber}#</code>
                    </div>
                    <div className="bg-white p-2.5 rounded-lg border border-blue-100">
                      <strong className="block text-[#260475] font-sans">Divert All Calls:</strong>
                      Dial from handset: <code>**21*{currentActiveNumber}#</code>
                    </div>
                  </div>
                </div>
              )}

              <p className="text-[var(--awb-color6)] text-[11px] pt-1 border-t border-blue-200/60">
                <strong>Note:</strong> You do not need to cancel your existing telephone contract. Call divert ensures you never miss a client booking while working with other customers.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {/* PHONE CALL HISTORY INDEX */}
      <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 md:p-8 rounded-2xl shadow-xl space-y-6">
        <div>
          <h3 className="text-base font-bold text-[var(--awb-color8)]">Phone Call History & Transcripts</h3>
          <p className="text-xs text-[var(--awb-color6)] mt-0.5">
            Log of incoming calls received on your dedicated business phone numbers.
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
                  <p className="text-[11px]">Calls made to your dedicated numbers will appear here with full audio recordings and transcripts.</p>
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
      </>
      )}

      {/* Release Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="w-10 h-10 bg-rose-100 text-rose-700 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-[var(--awb-color8)]">
              Release Dedicated {activeChannelTab === 'mobile' ? 'Mobile' : 'Landline'} Number?
            </h3>
            <p className="text-[var(--awb-color7)] text-xs leading-relaxed">
              Releasing your dedicated number <strong className="text-[#260475] font-mono">{currentActiveNumber}</strong> is <strong>permanent</strong> and cannot be undone. The number will be returned to the pool and cannot be recovered.
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

      {/* Add-On Upsell Modal */}
      {upsellCategory && (
        <AddOnUpsellModal
          isOpen={true}
          onClose={() => setUpsellCategory(null)}
          category={upsellCategory as any}
          tenantId={tenantId}
        />
      )}
    </div>
  );
}
