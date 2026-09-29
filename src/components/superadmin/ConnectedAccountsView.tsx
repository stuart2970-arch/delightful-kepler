'use client';

import React, { useState, useEffect } from 'react';

type ProviderData = {
  configured: boolean;
  keyMasked?: string;
  accountSidMasked?: string;
  projectId?: string;
  status: 'active' | 'degraded' | 'error' | 'unconfigured' | 'unknown';
  tier?: string;
  characterCount?: number;
  characterLimit?: number;
  charactersRemaining?: number;
  percentRemaining?: number;
  estimatedVoiceMinutesRemaining?: number;
  nextResetDate?: string | null;
  orgName?: string;
  orgId?: string;
  creditBalance?: number | null;
  currency?: string;
  concurrencyLimit?: number;
  accountType?: string;
  balance?: number | null;
  estimatedSmsRemaining?: number;
  activeModel?: string;
  tokensUsedThisMonth?: number;
  messagesProcessedThisMonth?: number;
  estimatedCostUsd?: number;
  rateLimitTpm?: string;
  rateLimitRpd?: string;
  isLow: boolean;
  warningReason: string | null;
  rawError: string | null;
};

type ConnectedAccountsPayload = {
  success: boolean;
  timestamp: string;
  lowServicesCount: number;
  providers: {
    elevenlabs: ProviderData;
    vapi: ProviderData;
    twilio: ProviderData;
    googleCloud: ProviderData;
  };
  savedKeysConfigured: {
    elevenlabs: boolean;
    vapi: boolean;
    twilio: boolean;
    gemini: boolean;
    gcpProject: boolean;
  };
};

export default function ConnectedAccountsView() {
  const [data, setData] = useState<ConnectedAccountsPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Key configuration modal / inline editor state
  const [showKeyEditor, setShowKeyEditor] = useState<boolean>(false);
  const [isSavingKeys, setIsSavingKeys] = useState<boolean>(false);
  const [keyForm, setKeyForm] = useState({
    elevenlabs_api_key: '',
    vapi_api_key: '',
    twilio_account_sid: '',
    twilio_auth_token: '',
    gemini_api_key: '',
    gcp_project_id: '',
  });
  const [keySaveMessage, setKeySaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchConnectedAccounts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/superadmin/connected-accounts', { cache: 'no-store' });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const json: ConnectedAccountsPayload = await res.json();
      setData(json);
    } catch (err: any) {
      console.error('[ConnectedAccountsView] Fetch error:', err);
      setError(err.message || 'Failed to fetch connected accounts status.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConnectedAccounts();
  }, []);

  const handleSaveKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingKeys(true);
    setKeySaveMessage(null);
    try {
      const res = await fetch('/api/superadmin/connected-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(keyForm),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to save API keys');
      }
      setKeySaveMessage({ type: 'success', text: 'API keys updated successfully! Reloading telemetry...' });
      fetchConnectedAccounts();
      setTimeout(() => setShowKeyEditor(false), 1500);
    } catch (err: any) {
      setKeySaveMessage({ type: 'error', text: err.message || 'Error saving keys' });
    } finally {
      setIsSavingKeys(false);
    }
  };

  const getStatusBadge = (provider: ProviderData) => {
    if (provider.isLow || provider.status === 'error') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/30 animate-pulse">
          <span className="w-2 h-2 rounded-full bg-red-400"></span>
          {provider.status === 'error' ? 'Error / Disconnected' : 'Low Quota / Credit Alert'}
        </span>
      );
    }
    if (provider.status === 'degraded') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
          <span className="w-2 h-2 rounded-full bg-amber-400"></span>
          Degraded
        </span>
      );
    }
    if (provider.configured) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          Active & Connected
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-800 text-gray-400 border border-gray-700">
        <span className="w-2 h-2 rounded-full bg-gray-500"></span>
        Unconfigured
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>💳 Connected Accounts, Balances & Quota Monitor</span>
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Real-time telemetry for ElevenLabs, Vapi, Twilio, and Google Cloud. Automatically highlights services with low credits, tokens, or minutes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowKeyEditor(!showKeyEditor)}
            className="px-4 py-2 bg-gray-900 hover:bg-gray-800 border border-gray-700 text-gray-200 text-xs font-semibold rounded-xl transition-all shadow-sm flex items-center gap-2"
          >
            <span>🔑 {showKeyEditor ? 'Close Credentials Editor' : 'Manage API Credentials'}</span>
          </button>
          <button
            onClick={fetchConnectedAccounts}
            disabled={isLoading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-indigo-600/20 flex items-center gap-2 disabled:opacity-50"
          >
            <svg className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{isLoading ? 'Syncing...' : 'Refresh Telemetry'}</span>
          </button>
        </div>
      </div>

      {/* Global Alert Bar if services are low */}
      {data && data.lowServicesCount > 0 && (
        <div className="bg-red-950/40 border border-red-700/60 rounded-2xl p-4 flex items-center justify-between shadow-lg shadow-red-950/30 text-red-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-900/50 rounded-xl border border-red-700/50 text-red-300">
              <svg className="w-6 h-6 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-bold text-red-300">
                Action Required: {data.lowServicesCount} Connected Account{data.lowServicesCount > 1 ? 's' : ''} Getting Low or Disconnected!
              </h4>
              <p className="text-xs text-red-400 mt-0.5">
                Review highlighted cards below to top up credit balances or update API quota limits before service interruptions occur.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* API Key Credentials Drawer / Form */}
      {showKeyEditor && (
        <div className="bg-gray-900 border border-indigo-500/40 rounded-2xl p-6 shadow-2xl space-y-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>🔐 Connected Provider Credentials (Override Settings)</span>
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Enter API keys here to override or supplement environment variables. Saved securely in global system settings.
            </p>
          </div>

          <form onSubmit={handleSaveKeys} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">ElevenLabs API Key</label>
              <input
                type="password"
                placeholder="sk_..."
                value={keyForm.elevenlabs_api_key}
                onChange={e => setKeyForm({ ...keyForm, elevenlabs_api_key: e.target.value })}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Vapi API Key (Private Key)</label>
              <input
                type="password"
                placeholder="vapi-..."
                value={keyForm.vapi_api_key}
                onChange={e => setKeyForm({ ...keyForm, vapi_api_key: e.target.value })}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Twilio Account SID</label>
              <input
                type="text"
                placeholder="AC..."
                value={keyForm.twilio_account_sid}
                onChange={e => setKeyForm({ ...keyForm, twilio_account_sid: e.target.value })}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Twilio Auth Token</label>
              <input
                type="password"
                placeholder="Auth Token"
                value={keyForm.twilio_auth_token}
                onChange={e => setKeyForm({ ...keyForm, twilio_auth_token: e.target.value })}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Google Gemini API Key</label>
              <input
                type="password"
                placeholder="AIzaSy..."
                value={keyForm.gemini_api_key}
                onChange={e => setKeyForm({ ...keyForm, gemini_api_key: e.target.value })}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Google Cloud Project ID</label>
              <input
                type="text"
                placeholder="styleflo-ai-prod"
                value={keyForm.gcp_project_id}
                onChange={e => setKeyForm({ ...keyForm, gcp_project_id: e.target.value })}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="md:col-span-2 flex items-center justify-between pt-2">
              {keySaveMessage && (
                <p className={`text-xs font-semibold ${keySaveMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {keySaveMessage.text}
                </p>
              )}
              <button
                type="submit"
                disabled={isSavingKeys}
                className="ml-auto bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-2.5 px-5 rounded-xl transition-all shadow-md disabled:opacity-50"
              >
                {isSavingKeys ? 'Saving...' : 'Save Provider Credentials'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Loading Skeleton State */}
      {isLoading && !data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 h-64 animate-pulse space-y-4">
              <div className="h-6 bg-gray-800 rounded w-1/3"></div>
              <div className="h-10 bg-gray-800 rounded w-1/2"></div>
              <div className="h-4 bg-gray-800 rounded w-full"></div>
              <div className="h-4 bg-gray-800 rounded w-2/3"></div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-950/20 border border-red-800 rounded-2xl p-6 text-red-300">
          <p className="font-bold">Failed to load connected accounts</p>
          <p className="text-xs font-mono mt-1">{error}</p>
        </div>
      )}

      {/* Provider Cards Grid */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* 1. ELEVENLABS CARD */}
          {(() => {
            const p = data.providers.elevenlabs;
            const isHighAlert = p.isLow || p.status === 'error';
            return (
              <div className={`bg-gray-900 border rounded-2xl p-6 shadow-xl relative overflow-hidden transition-all duration-300 ${
                isHighAlert ? 'border-red-600/80 ring-2 ring-red-500/20' : 'border-gray-800 hover:border-gray-700'
              }`}>
                {/* Provider Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-indigo-950/60 border border-indigo-500/30 rounded-xl text-indigo-300 text-xl font-bold">
                      🎙️
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-lg flex items-center gap-2">
                        ElevenLabs
                      </h3>
                      <p className="text-xs text-gray-400">Voice Synthesis & Character Quota</p>
                    </div>
                  </div>
                  {getStatusBadge(p)}
                </div>

                {/* Main Remaining Metric */}
                <div className="mt-5 space-y-3">
                  <div>
                    <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Remaining Characters</span>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className={`text-3xl font-extrabold ${isHighAlert ? 'text-red-400' : 'text-white'}`}>
                        {(p.charactersRemaining || 0).toLocaleString()}
                      </span>
                      <span className="text-sm text-gray-400 font-medium">
                        / {(p.characterLimit || 0).toLocaleString()} chars ({p.percentRemaining || 0}%)
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-gray-950 h-2.5 rounded-full overflow-hidden border border-gray-800">
                    <div 
                      className={`h-full transition-all duration-500 ${
                        (p.percentRemaining || 0) < 15 ? 'bg-red-500' : (p.percentRemaining || 0) < 30 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, p.percentRemaining || 0))}%` }}
                    />
                  </div>

                  {/* Secondary Metrics */}
                  <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                    <div className="bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                      <span className="text-gray-400">Estimated Voice Time:</span>
                      <p className="font-bold text-gray-100 text-sm mt-0.5">
                        ~{(p.estimatedVoiceMinutesRemaining || 0).toLocaleString()} mins
                      </p>
                    </div>
                    <div className="bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                      <span className="text-gray-400">Subscription Tier:</span>
                      <p className="font-bold text-gray-100 text-sm mt-0.5 capitalize">{p.tier || 'Standard'}</p>
                    </div>
                  </div>

                  {p.nextResetDate && (
                    <p className="text-[11px] text-gray-500 font-medium">
                      📅 Quota resets on: <span className="text-gray-300">{p.nextResetDate}</span>
                    </p>
                  )}

                  {/* Warning Message Box if low */}
                  {p.warningReason && (
                    <div className="mt-3 p-3 bg-red-950/40 border border-red-800/80 rounded-xl text-xs text-red-300 font-semibold flex items-center gap-2">
                      <span className="text-base">⚠️</span>
                      <span>{p.warningReason}</span>
                    </div>
                  )}

                  {p.rawError && (
                    <div className="mt-3 p-3 bg-red-950/40 border border-red-900 rounded-xl text-xs text-red-400 font-mono">
                      Error: {p.rawError}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* 2. VAPI CARD */}
          {(() => {
            const p = data.providers.vapi;
            const isHighAlert = p.isLow || p.status === 'error';
            return (
              <div className={`bg-gray-900 border rounded-2xl p-6 shadow-xl relative overflow-hidden transition-all duration-300 ${
                isHighAlert ? 'border-red-600/80 ring-2 ring-red-500/20' : 'border-gray-800 hover:border-gray-700'
              }`}>
                {/* Provider Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-purple-950/60 border border-purple-500/30 rounded-xl text-purple-300 text-xl font-bold">
                      🗣️
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-lg flex items-center gap-2">
                        Vapi Voice AI
                      </h3>
                      <p className="text-xs text-gray-400">Voice Assistant & Call Minutes</p>
                    </div>
                  </div>
                  {getStatusBadge(p)}
                </div>

                {/* Main Remaining Metric */}
                <div className="mt-5 space-y-3">
                  <div>
                    <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Account Credit Balance</span>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className={`text-3xl font-extrabold ${isHighAlert ? 'text-red-400' : 'text-white'}`}>
                        {p.creditBalance !== null && p.creditBalance !== undefined 
                          ? `$${p.creditBalance.toFixed(2)}` 
                          : p.configured ? 'Active' : '$0.00'}
                      </span>
                      {p.currency && <span className="text-sm text-gray-400 uppercase">{p.currency}</span>}
                    </div>
                  </div>

                  {/* Secondary Metrics */}
                  <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                    <div className="bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                      <span className="text-gray-400">Est. Voice Time Remaining:</span>
                      <p className="font-bold text-gray-100 text-sm mt-0.5">
                        ~{(p.estimatedVoiceMinutesRemaining || 0).toLocaleString()} mins
                      </p>
                    </div>
                    <div className="bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                      <span className="text-gray-400">Concurrency Limit:</span>
                      <p className="font-bold text-gray-100 text-sm mt-0.5">
                        {p.concurrencyLimit || 10} concurrent calls
                      </p>
                    </div>
                  </div>

                  <div className="bg-gray-950/40 p-2.5 rounded-xl border border-gray-800 text-xs flex items-center justify-between">
                    <span className="text-gray-400">Organization:</span>
                    <span className="text-gray-200 font-medium">{p.orgName || 'Vapi Connected Org'}</span>
                  </div>

                  {/* Warning Box */}
                  {p.warningReason && (
                    <div className="mt-3 p-3 bg-red-950/40 border border-red-800/80 rounded-xl text-xs text-red-300 font-semibold flex items-center gap-2">
                      <span className="text-base">⚠️</span>
                      <span>{p.warningReason}</span>
                    </div>
                  )}

                  {p.rawError && (
                    <div className="mt-3 p-3 bg-red-950/40 border border-red-900 rounded-xl text-xs text-red-400 font-mono">
                      Error: {p.rawError}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* 3. TWILIO CARD */}
          {(() => {
            const p = data.providers.twilio;
            const isHighAlert = p.isLow || p.status === 'error';
            const currSymbol = p.currency === 'GBP' ? '£' : p.currency === 'EUR' ? '€' : '$';
            return (
              <div className={`bg-gray-900 border rounded-2xl p-6 shadow-xl relative overflow-hidden transition-all duration-300 ${
                isHighAlert ? 'border-red-600/80 ring-2 ring-red-500/20' : 'border-gray-800 hover:border-gray-700'
              }`}>
                {/* Provider Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-red-950/60 border border-red-500/30 rounded-xl text-red-300 text-xl font-bold">
                      💬
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-lg flex items-center gap-2">
                        Twilio Telephony & SMS
                      </h3>
                      <p className="text-xs text-gray-400">SMS Gateway & Telephony Account Balance</p>
                    </div>
                  </div>
                  {getStatusBadge(p)}
                </div>

                {/* Main Remaining Metric */}
                <div className="mt-5 space-y-3">
                  <div>
                    <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Account Balance</span>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className={`text-3xl font-extrabold ${isHighAlert ? 'text-red-400' : 'text-white'}`}>
                        {p.balance !== null && p.balance !== undefined 
                          ? `${currSymbol}${p.balance.toFixed(2)}` 
                          : p.configured ? 'Active' : `${currSymbol}0.00`}
                      </span>
                      <span className="text-sm text-gray-400 uppercase">{p.currency || 'USD'}</span>
                    </div>
                  </div>

                  {/* Secondary Metrics */}
                  <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                    <div className="bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                      <span className="text-gray-400">Estimated SMS Credits:</span>
                      <p className="font-bold text-gray-100 text-sm mt-0.5">
                        ~{(p.estimatedSmsRemaining || 0).toLocaleString()} SMS
                      </p>
                    </div>
                    <div className="bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                      <span className="text-gray-400">Est. Voice Call Mins:</span>
                      <p className="font-bold text-gray-100 text-sm mt-0.5">
                        ~{(p.estimatedVoiceMinutesRemaining || 0).toLocaleString()} mins
                      </p>
                    </div>
                  </div>

                  <div className="bg-gray-950/40 p-2.5 rounded-xl border border-gray-800 text-xs flex items-center justify-between font-mono">
                    <span className="text-gray-400 font-sans">Account SID:</span>
                    <span className="text-gray-300">{p.accountSidMasked || 'N/A'}</span>
                  </div>

                  {/* Warning Box */}
                  {p.warningReason && (
                    <div className="mt-3 p-3 bg-red-950/40 border border-red-800/80 rounded-xl text-xs text-red-300 font-semibold flex items-center gap-2">
                      <span className="text-base">⚠️</span>
                      <span>{p.warningReason}</span>
                    </div>
                  )}

                  {p.rawError && (
                    <div className="mt-3 p-3 bg-red-950/40 border border-red-900 rounded-xl text-xs text-red-400 font-mono">
                      Error: {p.rawError}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* 4. GOOGLE CLOUD & GEMINI CARD */}
          {(() => {
            const p = data.providers.googleCloud;
            const isHighAlert = p.isLow || p.status === 'error';
            return (
              <div className={`bg-gray-900 border rounded-2xl p-6 shadow-xl relative overflow-hidden transition-all duration-300 ${
                isHighAlert ? 'border-red-600/80 ring-2 ring-red-500/20' : 'border-gray-800 hover:border-gray-700'
              }`}>
                {/* Provider Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-teal-950/60 border border-teal-500/30 rounded-xl text-teal-300 text-xl font-bold">
                      ✨
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-lg flex items-center gap-2">
                        Google Cloud & Gemini
                      </h3>
                      <p className="text-xs text-gray-400">LLM Tokens, Quota & API Health</p>
                    </div>
                  </div>
                  {getStatusBadge(p)}
                </div>

                {/* Main Remaining Metric */}
                <div className="mt-5 space-y-3">
                  <div>
                    <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Monthly Tokens Consumed</span>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-3xl font-extrabold text-white">
                        {(p.tokensUsedThisMonth || 0).toLocaleString()}
                      </span>
                      <span className="text-sm text-gray-400">tokens</span>
                    </div>
                  </div>

                  {/* Secondary Metrics */}
                  <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                    <div className="bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                      <span className="text-gray-400">Active Engine Model:</span>
                      <p className="font-bold text-indigo-400 font-mono text-xs mt-0.5 truncate">
                        {p.activeModel || 'gemini-3.6-flash'}
                      </p>
                    </div>
                    <div className="bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                      <span className="text-gray-400">Est. API Cost (Month):</span>
                      <p className="font-bold text-emerald-400 text-sm mt-0.5">
                        ${(p.estimatedCostUsd || 0).toFixed(4)} USD
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                    <div className="bg-gray-950/40 p-2.5 rounded-xl border border-gray-800">
                      <span className="text-gray-400 font-sans">GCP Project:</span>
                      <p className="text-gray-300 font-bold truncate mt-0.5">{p.projectId || 'styleflo-ai-prod'}</p>
                    </div>
                    <div className="bg-gray-950/40 p-2.5 rounded-xl border border-gray-800">
                      <span className="text-gray-400 font-sans">Processed Messages:</span>
                      <p className="text-gray-300 font-bold mt-0.5">{(p.messagesProcessedThisMonth || 0).toLocaleString()}</p>
                    </div>
                  </div>

                  {/* Warning Box */}
                  {p.warningReason && (
                    <div className="mt-3 p-3 bg-red-950/40 border border-red-800/80 rounded-xl text-xs text-red-300 font-semibold flex items-center gap-2">
                      <span className="text-base">⚠️</span>
                      <span>{p.warningReason}</span>
                    </div>
                  )}

                  {p.rawError && (
                    <div className="mt-3 p-3 bg-red-950/40 border border-red-900 rounded-xl text-xs text-red-400 font-mono">
                      Error: {p.rawError}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

        </div>
      )}
    </div>
  );
}
