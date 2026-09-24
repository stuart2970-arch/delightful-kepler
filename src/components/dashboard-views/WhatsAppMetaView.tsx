'use client';

import React, { useState, useEffect } from 'react';
import { useDashboardStore } from '../../lib/store';

export default function WhatsAppMetaView() {
  const { tenantId, tenantName, twilioMobileNumber, chatbots } = useDashboardStore();

  const [activeSubTab, setActiveSubTab] = useState<'whatsapp' | 'instagram' | 'messenger' | 'webhook' | 'simulator'>('webhook');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Settings state
  const [webhookUrl, setWebhookUrl] = useState('https://app.styleflo.ai/api/webhooks/meta');
  const [verifyToken, setVerifyToken] = useState('styleflo_meta_verify_2026');

  // WhatsApp
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [whatsappPhoneNumber, setWhatsappPhoneNumber] = useState(twilioMobileNumber || '');
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState('');
  const [whatsappWabaId, setWhatsappWabaId] = useState('');
  const [metaAccessToken, setMetaAccessToken] = useState('');
  const [metaAccessTokenMasked, setMetaAccessTokenMasked] = useState('');
  const [metaAppSecret, setMetaAppSecret] = useState('');

  // Instagram
  const [instagramEnabled, setInstagramEnabled] = useState(false);
  const [instagramHandle, setInstagramHandle] = useState('');
  const [instagramAccountId, setInstagramAccountId] = useState('');

  // Messenger
  const [messengerEnabled, setMessengerEnabled] = useState(false);
  const [messengerPageId, setMessengerPageId] = useState('');

  // Simulator state
  const [simChannel, setSimChannel] = useState<'whatsapp' | 'instagram' | 'messenger'>('whatsapp');
  const [simCustomerName, setSimCustomerName] = useState('Alex Morgan');
  const [simCustomerPhone, setSimCustomerPhone] = useState('+44 7999 888777');
  const [simMessageText, setSimMessageText] = useState('Hi! What services do you offer and what are your opening hours?');
  const [isSimulating, setIsSimulating] = useState(false);
  const [simLog, setSimLog] = useState<any[]>([]);

  // Webhook Tester State
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Copy feedback
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2500);
  };

  // Load existing settings
  useEffect(() => {
    async function loadSettings() {
      if (!tenantId) return;
      setIsLoading(true);
      try {
        const res = await fetch(`/api/integrations/meta/settings?tenantId=${tenantId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.webhookUrl) setWebhookUrl(data.webhookUrl);
          if (data.verifyToken) setVerifyToken(data.verifyToken);
          setWhatsappEnabled(data.whatsappEnabled ?? true);
          setWhatsappPhoneNumber(data.whatsappPhoneNumber || twilioMobileNumber || '');
          setWhatsappPhoneNumberId(data.whatsappPhoneNumberId || '');
          setWhatsappWabaId(data.whatsappWabaId || '');
          setMetaAccessTokenMasked(data.metaAccessTokenMasked || '');
          setInstagramEnabled(data.instagramEnabled ?? false);
          setInstagramHandle(data.instagramHandle || '');
          setInstagramAccountId(data.instagramAccountId || '');
          setMessengerEnabled(data.messengerEnabled ?? false);
          setMessengerPageId(data.messengerPageId || '');
        }
      } catch (err) {
        console.error('Failed to load Meta settings:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadSettings();
  }, [tenantId, twilioMobileNumber]);

  // Save Settings
  const handleSaveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setSaveSuccessMsg(null);

    try {
      const payload: Record<string, any> = {
        tenantId,
        whatsappEnabled,
        whatsappPhoneNumber,
        whatsappPhoneNumberId,
        whatsappWabaId,
        instagramEnabled,
        instagramHandle,
        instagramAccountId,
        messengerEnabled,
        messengerPageId,
        metaVerifyToken: verifyToken,
      };

      if (metaAccessToken.trim()) {
        payload.metaAccessToken = metaAccessToken.trim();
      }
      if (metaAppSecret.trim()) {
        payload.metaAppSecret = metaAppSecret.trim();
      }

      const res = await fetch('/api/integrations/meta/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to save settings');
      }

      setSaveSuccessMsg('Configuration saved successfully! Meta channels are updated.');
      if (metaAccessToken.trim()) {
        setMetaAccessTokenMasked('••••••••' + metaAccessToken.trim().slice(-6));
        setMetaAccessToken('');
      }
      setTimeout(() => setSaveSuccessMsg(null), 4000);
    } catch (err: any) {
      alert('Error saving settings: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Test Webhook Handshake Live
  const handleTestWebhookHandshake = async () => {
    setIsTestingWebhook(true);
    setWebhookTestResult(null);
    try {
      const testChallenge = 'styleflo_test_' + Math.floor(Math.random() * 100000);
      const testUrl = `/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=${testChallenge}`;
      const res = await fetch(testUrl);
      const text = await res.text();

      if (res.ok && text === testChallenge) {
        setWebhookTestResult({
          success: true,
          message: `✓ Webhook Verification Passed! Meta's challenge handshake responded with 200 OK and valid challenge string ("${text}").`,
        });
      } else {
        setWebhookTestResult({
          success: false,
          message: `Verification check returned status ${res.status}: "${text}". Verify your token matches.`,
        });
      }
    } catch (err: any) {
      setWebhookTestResult({
        success: false,
        message: 'Network error contacting webhook: ' + err.message,
      });
    } finally {
      setIsTestingWebhook(false);
    }
  };

  // Execute Journey Simulator
  const handleRunJourneySimulator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simMessageText.trim()) return;

    setIsSimulating(true);
    const userMsg = simMessageText.trim();
    setSimMessageText('');

    // Add user bubble
    const userEntry = {
      id: Date.now(),
      sender: 'user',
      name: simCustomerName,
      text: userMsg,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setSimLog((prev) => [...prev, userEntry]);

    try {
      const res = await fetch('/api/integrations/meta/test-journey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          channel: simChannel,
          messageText: userMsg,
          customerIdentifier: simCustomerPhone,
          customerName: simCustomerName,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Simulator failed');
      }

      // Add assistant bubble
      const botEntry = {
        id: Date.now() + 1,
        sender: 'assistant',
        name: data.botName || 'AI Assistant',
        text: data.replyText,
        chunksCount: data.contextChunksCount,
        latencyMs: data.latencyMs,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setSimLog((prev) => [...prev, botEntry]);
    } catch (err: any) {
      const errorEntry = {
        id: Date.now() + 1,
        sender: 'system',
        name: 'System Error',
        text: 'Simulation failed: ' + err.message,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setSimLog((prev) => [...prev, errorEntry]);
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* HEADER SECTION */}
      <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-400"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <h2 className="text-2xl font-extrabold text-[var(--awb-color8)] tracking-tight">
              Meta Messaging Channels
            </h2>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
              Native Graph API v21.0
            </span>
          </div>
          <p className="text-xs text-[var(--awb-color6)] mt-1 max-w-2xl">
            Direct two-way messaging connection for <strong>WhatsApp Cloud API</strong>, <strong>Instagram Messaging</strong>, and <strong>Facebook Messenger</strong>. Seamlessly integrated with your AI agent and RAG knowledge base.
          </p>
        </div>

        {/* Channel Status Pills (Unavailable) */}
        <div className="flex flex-wrap gap-2 opacity-50 filter grayscale pointer-events-none select-none">
          <div className="px-3 py-1.5 rounded-xl border border-gray-200 bg-gray-100 text-gray-500 text-xs font-bold flex items-center gap-1.5">
            <span>💬 WhatsApp</span>
            <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">Unavailable</span>
          </div>
          <div className="px-3 py-1.5 rounded-xl border border-gray-200 bg-gray-100 text-gray-500 text-xs font-bold flex items-center gap-1.5">
            <span>📸 Instagram</span>
            <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">Unavailable</span>
          </div>
          <div className="px-3 py-1.5 rounded-xl border border-gray-200 bg-gray-100 text-gray-500 text-xs font-bold flex items-center gap-1.5">
            <span>⚡ Messenger</span>
            <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">Unavailable</span>
          </div>
        </div>
      </div>

      {/* Advisory Notice */}
      <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs font-semibold flex items-center gap-2.5">
        <span className="text-base">⚠️</span>
        <span>Meta messaging channels (WhatsApp, Instagram, and Messenger) are currently unavailable and unclickable for the foreseeable future.</span>
      </div>

      {saveSuccessMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm font-semibold flex items-center gap-2 animate-in fade-in">
          <span>✓</span>
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {/* NAVIGATION SUB-TABS */}
      <div className="flex border-b border-[var(--awb-color3)] gap-2 overflow-x-auto pb-1">
        <button
          disabled
          type="button"
          className="px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 opacity-40 filter grayscale pointer-events-none cursor-not-allowed select-none bg-gray-100 text-gray-400 border border-transparent"
        >
          <span>💬</span>
          <span>WhatsApp Setup</span>
          <span className="text-[9px] uppercase tracking-wider font-bold px-1 py-0.5 rounded bg-gray-200 text-gray-600">Unavailable</span>
        </button>

        <button
          disabled
          type="button"
          className="px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 opacity-40 filter grayscale pointer-events-none cursor-not-allowed select-none bg-gray-100 text-gray-400 border border-transparent"
        >
          <span>📸</span>
          <span>Instagram Setup</span>
          <span className="text-[9px] uppercase tracking-wider font-bold px-1 py-0.5 rounded bg-gray-200 text-gray-600">Unavailable</span>
        </button>

        <button
          disabled
          type="button"
          className="px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 opacity-40 filter grayscale pointer-events-none cursor-not-allowed select-none bg-gray-100 text-gray-400 border border-transparent"
        >
          <span>⚡</span>
          <span>Messenger Setup</span>
          <span className="text-[9px] uppercase tracking-wider font-bold px-1 py-0.5 rounded bg-gray-200 text-gray-600">Unavailable</span>
        </button>

        <button
          onClick={() => setActiveSubTab('webhook')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 flex items-center gap-2 shrink-0 ${
            activeSubTab === 'webhook'
              ? 'bg-[#198fd9] text-white shadow-md'
              : 'text-[var(--awb-color6)] hover:text-[var(--awb-color8)] hover:bg-[var(--awb-color1)]'
          }`}
        >
          <span>🔗</span>
          <span>Webhook & Verification</span>
        </button>

        <button
          onClick={() => setActiveSubTab('simulator')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 flex items-center gap-2 shrink-0 ${
            activeSubTab === 'simulator'
              ? 'bg-purple-600 text-white shadow-md'
              : 'text-purple-600 hover:text-purple-800 hover:bg-purple-50'
          }`}
        >
          <span>🧪</span>
          <span>Journey Simulator</span>
        </button>
      </div>

      {/* SUB-TAB 1: WHATSAPP SETUP */}
      {activeSubTab === 'whatsapp' && (
        <div className="bg-white border border-[#f2f3f5] p-6 rounded-2xl shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-[#f2f3f5] pb-4">
            <div>
              <h3 className="text-lg font-bold text-[#260475] flex items-center gap-2">
                <span>💬 WhatsApp Cloud API Connection</span>
              </h3>
              <p className="text-xs text-[#434549] mt-0.5">
                Connect your WhatsApp Business Number to enable 24/7 AI conversational responses.
              </p>
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <span className="text-xs font-bold text-[#212326]">
                {whatsappEnabled ? 'Channel Active' : 'Channel Disabled'}
              </span>
              <input
                type="checkbox"
                checked={whatsappEnabled}
                onChange={(e) => setWhatsappEnabled(e.target.checked)}
                className="w-5 h-5 rounded text-[#198fd9] focus:ring-[#198fd9]"
              />
            </label>
          </div>

          {/* Setup Guide Accordion */}
          <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-4 text-xs text-blue-900 space-y-2">
            <p className="font-bold flex items-center gap-1.5 text-[#198fd9]">
              📘 Step-by-Step Meta Developer Guide for WhatsApp
            </p>
            <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed text-blue-800">
              <li>In <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="underline font-bold hover:text-blue-900">Meta for Developers</a>, open your App and select <strong>WhatsApp &gt; API Setup</strong>.</li>
              <li>Copy the <strong>Phone number ID</strong> and <strong>WhatsApp Business Account ID</strong> and paste them into the fields below.</li>
              <li>In your Meta Business Suite &gt; System Users, generate a <strong>Permanent Access Token</strong> with the <code className="bg-blue-100 px-1 py-0.5 rounded font-mono">whatsapp_business_messaging</code> permission.</li>
              <li>In WhatsApp &gt; Configuration, set the Webhook URL to <code className="bg-blue-100 px-1 py-0.5 rounded font-mono">https://app.styleflo.ai/api/webhooks/meta</code> and verify with your token.</li>
            </ol>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#212326] mb-1.5">
                  WhatsApp Phone Number ID <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={whatsappPhoneNumberId}
                  onChange={(e) => setWhatsappPhoneNumberId(e.target.value)}
                  placeholder="e.g. 102938475610293"
                  className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] font-mono focus:outline-none focus:border-[#198fd9]"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">
                  Found on the WhatsApp &gt; API Setup page in Meta Developer Portal.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#212326] mb-1.5">
                  WhatsApp Business Account ID (WABA)
                </label>
                <input
                  type="text"
                  value={whatsappWabaId}
                  onChange={(e) => setWhatsappWabaId(e.target.value)}
                  placeholder="e.g. 987654321098765"
                  className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] font-mono focus:outline-none focus:border-[#198fd9]"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">
                  Your WhatsApp Business Account ID under API Setup.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#212326] mb-1.5">
                  Connected Mobile / WhatsApp Number
                </label>
                <input
                  type="text"
                  value={whatsappPhoneNumber}
                  onChange={(e) => setWhatsappPhoneNumber(e.target.value)}
                  placeholder="e.g. +44 7446 900875"
                  className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] font-mono focus:outline-none focus:border-[#198fd9]"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">
                  The visible international phone number associated with this WhatsApp account.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#212326] mb-1.5">
                  Meta Permanent System User Access Token {metaAccessTokenMasked && <span className="text-emerald-800 font-bold">({metaAccessTokenMasked})</span>}
                </label>
                <input
                  type="password"
                  value={metaAccessToken}
                  onChange={(e) => setMetaAccessToken(e.target.value)}
                  placeholder={metaAccessTokenMasked ? 'Enter new token to overwrite' : 'EAAB... (Permanent System User Token)'}
                  className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] font-mono focus:outline-none focus:border-[#198fd9]"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">
                  Required to send outbound replies. Never expires when created via System User.
                </span>
              </div>
            </div>

            <div className="pt-3 border-t border-[#f2f3f5] flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="awb-btn text-sm shadow-md disabled:opacity-50 flex items-center gap-2"
              >
                {isSaving ? 'Saving WhatsApp Settings...' : 'Save WhatsApp Settings'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SUB-TAB 2: INSTAGRAM SETUP */}
      {activeSubTab === 'instagram' && (
        <div className="bg-white border border-[#f2f3f5] p-6 rounded-2xl shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-[#f2f3f5] pb-4">
            <div>
              <h3 className="text-lg font-bold text-[#260475] flex items-center gap-2">
                <span>📸 Instagram Messaging Connection</span>
              </h3>
              <p className="text-xs text-[#434549] mt-0.5">
                Respond to Direct Messages (DMs) automatically with your StyleFlo AI assistant.
              </p>
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <span className="text-xs font-bold text-[#212326]">
                {instagramEnabled ? 'Channel Active' : 'Channel Disabled'}
              </span>
              <input
                type="checkbox"
                checked={instagramEnabled}
                onChange={(e) => setInstagramEnabled(e.target.checked)}
                className="w-5 h-5 rounded text-[#198fd9] focus:ring-[#198fd9]"
              />
            </label>
          </div>

          <div className="bg-pink-50/70 border border-pink-200 rounded-xl p-4 text-xs text-pink-900 space-y-2">
            <p className="font-bold flex items-center gap-1.5 text-pink-800">
              📘 Instagram Messaging Requirements
            </p>
            <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed text-pink-800">
              <li>Ensure your Instagram account is a <strong>Business or Creator</strong> profile connected to a Facebook Page.</li>
              <li>In Instagram mobile app: <strong>Settings &gt; Privacy &gt; Messages &gt; Connected Tools</strong>, turn ON <strong>Allow Access to Messages</strong>.</li>
              <li>In your Meta App, add the <strong>Instagram Graph API</strong> and subscribe to <code className="bg-pink-100 px-1 py-0.5 rounded font-mono">messages</code> under Webhooks.</li>
            </ol>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#212326] mb-1.5">
                  Instagram Handle
                </label>
                <input
                  type="text"
                  value={instagramHandle}
                  onChange={(e) => setInstagramHandle(e.target.value)}
                  placeholder="e.g. @styleflo.ai"
                  className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] font-mono focus:outline-none focus:border-[#198fd9]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#212326] mb-1.5">
                  Instagram Business Account ID
                </label>
                <input
                  type="text"
                  value={instagramAccountId}
                  onChange={(e) => setInstagramAccountId(e.target.value)}
                  placeholder="e.g. 17841400000000000"
                  className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] font-mono focus:outline-none focus:border-[#198fd9]"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">
                  Found via Graph API or Meta Business Manager connected accounts.
                </span>
              </div>
            </div>

            <div className="pt-3 border-t border-[#f2f3f5] flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="awb-btn text-sm shadow-md disabled:opacity-50"
              >
                {isSaving ? 'Saving Instagram Settings...' : 'Save Instagram Settings'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SUB-TAB 3: MESSENGER SETUP */}
      {activeSubTab === 'messenger' && (
        <div className="bg-white border border-[#f2f3f5] p-6 rounded-2xl shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-[#f2f3f5] pb-4">
            <div>
              <h3 className="text-lg font-bold text-[#260475] flex items-center gap-2">
                <span>⚡ Facebook Messenger Connection</span>
              </h3>
              <p className="text-xs text-[#434549] mt-0.5">
                Automatically reply to customers messaging your Facebook Page.
              </p>
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <span className="text-xs font-bold text-[#212326]">
                {messengerEnabled ? 'Channel Active' : 'Channel Disabled'}
              </span>
              <input
                type="checkbox"
                checked={messengerEnabled}
                onChange={(e) => setMessengerEnabled(e.target.checked)}
                className="w-5 h-5 rounded text-[#198fd9] focus:ring-[#198fd9]"
              />
            </label>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#212326] mb-1.5">
                  Facebook Page ID
                </label>
                <input
                  type="text"
                  value={messengerPageId}
                  onChange={(e) => setMessengerPageId(e.target.value)}
                  placeholder="e.g. 109876543210987"
                  className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] font-mono focus:outline-none focus:border-[#198fd9]"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">
                  Found on your Facebook Page &gt; About &gt; Page Transparency / Page ID.
                </span>
              </div>
            </div>

            <div className="pt-3 border-t border-[#f2f3f5] flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="awb-btn text-sm shadow-md disabled:opacity-50"
              >
                {isSaving ? 'Saving Messenger Settings...' : 'Save Messenger Settings'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SUB-TAB 4: WEBHOOK & VERIFICATION */}
      {activeSubTab === 'webhook' && (
        <div className="bg-white border border-[#f2f3f5] p-6 rounded-2xl shadow-sm space-y-6">
          <div className="border-b border-[#f2f3f5] pb-4">
            <h3 className="text-lg font-bold text-[#260475]">
              🔗 Webhook Configuration & Meta App Verification
            </h3>
            <p className="text-xs text-[#434549] mt-0.5">
              These are the exact credentials and callback URLs required by Meta to verify your App.
            </p>
          </div>

          {/* Webhook URL & Token Card */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#f9f9fb] border border-[#f2f3f5] p-4 rounded-xl space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-[#212326]">Meta Webhook Callback URL</label>
                <button
                  type="button"
                  onClick={() => copyToClipboard(webhookUrl, 'url')}
                  className="text-xs font-bold text-[#198fd9] hover:underline cursor-pointer"
                >
                  {copiedField === 'url' ? '✓ Copied!' : 'Copy URL'}
                </button>
              </div>
              <div className="bg-white p-3 rounded-lg border border-[#f2f3f5] font-mono text-xs text-[#212326] break-all select-all shadow-sm">
                {webhookUrl}
              </div>
              <p className="text-[11px] text-gray-500">
                Paste this into Meta for Developers under <strong>WhatsApp &gt; Configuration &gt; Callback URL</strong> (and Instagram/Messenger Webhooks).
              </p>
            </div>

            <div className="bg-[#f9f9fb] border border-[#f2f3f5] p-4 rounded-xl space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-[#212326]">Webhook Verify Token</label>
                <button
                  type="button"
                  onClick={() => copyToClipboard(verifyToken, 'token')}
                  className="text-xs font-bold text-[#198fd9] hover:underline cursor-pointer"
                >
                  {copiedField === 'token' ? '✓ Copied!' : 'Copy Token'}
                </button>
              </div>
              <input
                type="text"
                value={verifyToken}
                onChange={(e) => setVerifyToken(e.target.value)}
                className="w-full bg-white p-3 rounded-lg border border-[#f2f3f5] font-mono text-xs text-[#212326] focus:outline-none focus:border-[#198fd9] shadow-sm"
              />
              <p className="text-[11px] text-gray-500">
                Paste this into Meta under <strong>Verify Token</strong>. Must match what is configured here.
              </p>
            </div>
          </div>

          {/* Test Webhook Handshake Live */}
          <div className="bg-emerald-50/60 border border-emerald-200 p-5 rounded-xl space-y-3">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
              <div>
                <h4 className="text-sm font-bold text-emerald-900 flex items-center gap-2">
                  <span>⚡ Instant Webhook Verification Test</span>
                </h4>
                <p className="text-xs text-emerald-800 mt-0.5">
                  Simulate Meta's verification challenge locally to ensure your server responds with 200 OK before submitting to Meta.
                </p>
              </div>
              <button
                type="button"
                onClick={handleTestWebhookHandshake}
                disabled={isTestingWebhook}
                className="awb-btn text-xs shadow-md disabled:opacity-50 shrink-0"
              >
                {isTestingWebhook ? 'Testing...' : 'Test Webhook Verification'}
              </button>
            </div>

            {webhookTestResult && (
              <div className={`p-3.5 rounded-lg text-xs font-semibold ${
                webhookTestResult.success ? 'bg-emerald-100 text-emerald-900 border border-emerald-300' : 'bg-rose-100 text-rose-900 border border-rose-300'
              }`}>
                {webhookTestResult.message}
              </div>
            )}
          </div>

          {/* Meta App Review Compliance URLs */}
          <div className="bg-[#f9f9fb] border border-[#f2f3f5] p-5 rounded-xl space-y-4">
            <h4 className="text-sm font-bold text-[#260475]">
              🛡️ Meta App Review &amp; Verification URLs
            </h4>
            <p className="text-xs text-[#434549]">
              Meta requires these live public links in your App Review submission before granting access to live user messaging:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="bg-white p-3 rounded-lg border border-[#f2f3f5] shadow-sm space-y-1">
                <span className="font-bold text-[#212326] block">Privacy Policy URL</span>
                <a href="https://styleflo.ai/privacy" target="_blank" rel="noreferrer" className="text-[#198fd9] font-mono break-all hover:underline block">
                  https://styleflo.ai/privacy
                </a>
                <span className="text-[10px] text-emerald-800 font-bold block">✓ Verified Active</span>
              </div>

              <div className="bg-white p-3 rounded-lg border border-[#f2f3f5] shadow-sm space-y-1">
                <span className="font-bold text-[#212326] block">Terms of Service URL</span>
                <a href="https://styleflo.ai/terms" target="_blank" rel="noreferrer" className="text-[#198fd9] font-mono break-all hover:underline block">
                  https://styleflo.ai/terms
                </a>
                <span className="text-[10px] text-emerald-800 font-bold block">✓ Verified Active</span>
              </div>

              <div className="bg-white p-3 rounded-lg border border-[#f2f3f5] shadow-sm space-y-1">
                <span className="font-bold text-[#212326] block">User Data Deletion Callback</span>
                <span className="text-[#198fd9] font-mono break-all block">
                  https://app.styleflo.ai/api/data-deletion
                </span>
                <span className="text-[10px] text-emerald-800 font-bold block">✓ Compliant &amp; Active</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 5: INTERACTIVE JOURNEY SIMULATOR */}
      {activeSubTab === 'simulator' && (
        <div className="bg-white border border-[#f2f3f5] p-6 rounded-2xl shadow-sm space-y-6">
          <div className="border-b border-[#f2f3f5] pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h3 className="text-lg font-bold text-[#260475] flex items-center gap-2">
                <span>🧪 Meta Conversational Journey Simulator</span>
              </h3>
              <p className="text-xs text-[#434549] mt-0.5">
                Test the complete customer journey for WhatsApp, Instagram, or Messenger with live Gemini AI responses and RAG knowledge retrieval.
              </p>
            </div>
            <div className="flex gap-2 bg-[#f9f9fb] p-1 rounded-xl border border-[#f2f3f5] opacity-40 filter grayscale pointer-events-none select-none">
              {(['whatsapp', 'instagram', 'messenger'] as const).map((ch) => (
                <button
                  disabled
                  key={ch}
                  type="button"
                  className="px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition bg-gray-200 text-gray-500 cursor-not-allowed"
                >
                  {ch} (Unavailable)
                </button>
              ))}
            </div>
          </div>

          {/* Quick Preset Buttons */}
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="text-gray-400 py-1 font-semibold">Try sample questions:</span>
            {[
              'What services do you offer and how much are they?',
              'What are your opening hours on Saturday?',
              'Can I book an appointment tomorrow at 3pm?',
              'Where is your business located?',
            ].map((preset, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setSimMessageText(preset)}
                className="bg-[#f9f9fb] hover:bg-gray-100 border border-[#f2f3f5] px-2.5 py-1 rounded-lg text-gray-700 text-[11px] font-medium transition"
              >
                "{preset}"
              </button>
            ))}
          </div>

          {/* Simulated Chat Feed */}
          <div className="bg-[#f9f9fb] border border-[#f2f3f5] rounded-2xl p-4 h-[380px] overflow-y-auto space-y-4 styleflo-scrollbar">
            {simLog.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-white border border-[#f2f3f5] flex items-center justify-center text-xl shadow-sm">
                  💬
                </div>
                <p className="text-xs font-semibold text-gray-500">
                  No simulated messages yet.
                </p>
                <p className="text-[11px] text-gray-400 max-w-sm">
                  Type a question below or click a sample question to test the conversational journey on {simChannel.toUpperCase()}.
                </p>
              </div>
            ) : (
              simLog.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex flex-col ${
                    entry.sender === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-gray-400">
                    <span className="font-semibold">{entry.name}</span>
                    <span>•</span>
                    <span>{entry.timestamp}</span>
                    {entry.latencyMs && (
                      <span className="text-emerald-600 font-mono">({entry.latencyMs}ms)</span>
                    )}
                  </div>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm ${
                      entry.sender === 'user'
                        ? 'bg-[#198fd9] text-white rounded-tr-none'
                        : entry.sender === 'assistant'
                        ? 'bg-white border border-[#f2f3f5] text-[#212326] rounded-tl-none whitespace-pre-wrap'
                        : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}
                  >
                    {entry.text}
                  </div>
                  {entry.chunksCount !== undefined && (
                    <span className="text-[9px] text-gray-400 mt-1 px-1">
                      📚 {entry.chunksCount} knowledge chunks retrieved
                    </span>
                  )}
                </div>
              ))
            )}
            {isSimulating && (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                <span className="animate-spin text-[#198fd9]">⏳</span>
                <span>Generating AI response with Gemini &amp; Knowledge Base...</span>
              </div>
            )}
          </div>

          {/* Simulator Input Box */}
          <form onSubmit={handleRunJourneySimulator} className="flex gap-2">
            <input
              type="text"
              value={simMessageText}
              onChange={(e) => setSimMessageText(e.target.value)}
              placeholder={`Type a test message as a ${simChannel} customer...`}
              disabled={isSimulating}
              className="flex-1 h-[50px] bg-white border border-[#f2f3f5] rounded-xl px-4 text-xs text-[#212326] focus:outline-none focus:border-[#198fd9] shadow-sm disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isSimulating || !simMessageText.trim()}
              className="awb-btn px-6 shadow-md disabled:opacity-50 flex items-center gap-2"
            >
              <span>Send</span>
              <span>→</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
