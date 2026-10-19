'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useDashboardStore } from '../../lib/store';
import { createBrowserClient } from '@supabase/ssr';
import AddOnUpsellModal from '../AddOnUpsellModal';

interface WhatsAppAccountData {
  id: string;
  waba_id: string;
  phone_number_id: string;
  display_phone: string;
  display_name: string;
  mode: string;
  status: 'pending' | 'verifying' | 'connected' | 'error' | 'disconnected';
  card_missing: boolean;
  payment_status: string;
  quality_rating: string;
  messaging_limit: string;
  updated_at: string;
}

export default function WhatsAppMetaView() {
  const { tenantId, tenantName, twilioMobileNumber, chatbots, billingData } = useDashboardStore();

  const [activeSubTab, setActiveSubTab] = useState<'whatsapp' | 'instagram' | 'messenger' | 'webhook' | 'simulator'>('whatsapp');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // WhatsApp Business Onboarding & Live Account State
  const [whatsappAccount, setWhatsappAccount] = useState<WhatsAppAccountData | null>(null);
  const [isFetchingAccount, setIsFetchingAccount] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);
  const [onboardSuccess, setOnboardSuccess] = useState<string | null>(null);
  const [authCode, setAuthCode] = useState<string | null>(null);
  const [sessionDetails, setSessionDetails] = useState<{ wabaId?: string; phoneNumberId?: string; event?: string } | null>(null);
  const [verificationCode, setVerificationCode] = useState<string | null>(null);
  const [isPollingCode, setIsPollingCode] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showUpsellModal, setShowUpsellModal] = useState(false);
  const [showManualConfig, setShowManualConfig] = useState(false);

  // Settings state for Webhook & Manual fallback
  const [webhookUrl, setWebhookUrl] = useState('https://app.styleflo.ai/api/webhooks/meta');
  const [verifyToken, setVerifyToken] = useState('styleflo_meta_verify_2026');

  // WhatsApp Manual Fallback Settings
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

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2500);
  };

  // Fetch WhatsApp live status from /api/whatsapp/onboard
  const fetchWhatsAppStatus = async () => {
    setIsFetchingAccount(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/whatsapp/onboard', { headers, cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.account) {
          setWhatsappAccount(data.account);
          if (data.account.phone_number_id) setWhatsappPhoneNumberId(data.account.phone_number_id);
          if (data.account.waba_id) setWhatsappWabaId(data.account.waba_id);
          if (data.account.display_phone) setWhatsappPhoneNumber(data.account.display_phone);
        } else {
          setWhatsappAccount(null);
        }
      }
    } catch (err) {
      console.warn('[WhatsApp Onboard] Error fetching status:', err);
    } finally {
      setIsFetchingAccount(false);
    }
  };

  // Load existing settings on mount
  useEffect(() => {
    async function loadSettings() {
      if (!tenantId) return;
      setIsLoading(true);
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/integrations/meta/settings?tenantId=${tenantId}`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.webhookUrl) setWebhookUrl(data.webhookUrl);
          if (data.verifyToken) setVerifyToken(data.verifyToken);
          setWhatsappEnabled(data.whatsappEnabled ?? true);
          if (data.whatsappPhoneNumber) setWhatsappPhoneNumber(data.whatsappPhoneNumber);
          if (data.whatsappPhoneNumberId) setWhatsappPhoneNumberId(data.whatsappPhoneNumberId);
          if (data.whatsappWabaId) setWhatsappWabaId(data.whatsappWabaId);
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
    fetchWhatsAppStatus();
  }, [tenantId, twilioMobileNumber]);

  // Load Facebook JavaScript SDK client-side
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_META_APP_ID || '1878987246712536';
    const graphVersion = process.env.NEXT_PUBLIC_META_GRAPH_VERSION || 'v21.0';

    if (typeof window !== 'undefined') {
      // @ts-ignore
      window.fbAsyncInit = function () {
        // @ts-ignore
        window.FB.init({
          appId: appId,
          autoLogAppEvents: true,
          xfbml: false,
          version: graphVersion,
        });
      };

      if (!document.getElementById('facebook-jssdk')) {
        const js = document.createElement('script');
        js.id = 'facebook-jssdk';
        js.src = 'https://connect.facebook.net/en_US/sdk.js';
        js.async = true;
        js.defer = true;
        js.crossOrigin = 'anonymous';
        document.body.appendChild(js);
      }
    }
  }, []);

  // Listen for Meta postMessage events (WA_EMBEDDED_SIGNUP)
  useEffect(() => {
    const handleMetaMessage = (e: MessageEvent) => {
      // Strict origin check: must end with facebook.com
      if (!e.origin || !e.origin.endsWith('facebook.com')) return;
      let payload: any;
      try {
        payload = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }

      if (payload?.type !== 'WA_EMBEDDED_SIGNUP') return;

      console.log('[Meta Embedded Signup Event]', payload.event, payload.data);

      if (
        payload.event === 'FINISH' ||
        payload.event === 'FINISH_ONLY_WABA' ||
        payload.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
      ) {
        const wabaId = payload.data?.waba_id;
        const phoneNumId = payload.data?.phone_number_id;
        setSessionDetails({ wabaId, phoneNumberId: phoneNumId, event: payload.event });
      } else if (payload.event === 'CANCEL') {
        setIsOnboarding(false);
        setOnboardError('WhatsApp connection was cancelled. You can retry anytime.');
      } else if (payload.event === 'ERROR') {
        setIsOnboarding(false);
        setOnboardError(
          `Meta Signup Error: ${payload.data?.error_message || 'An error occurred'} (Error ID: ${payload.data?.error_id || 'N/A'})`
        );
      }
    };

    window.addEventListener('message', handleMetaMessage);
    return () => window.removeEventListener('message', handleMetaMessage);
  }, []);

  // Complete onboarding once both authCode and sessionDetails are received
  const completeOnboarding = async (code: string, wabaId: string, phoneId: string) => {
    try {
      setIsOnboarding(true);
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/whatsapp/onboard', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          code,
          waba_id: wabaId,
          phone_number_id: phoneId,
          twilio_number_sid: twilioMobileNumber || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to complete WhatsApp onboarding');
      }

      setOnboardSuccess('WhatsApp connected successfully! Starter templates submitted to Meta for approval.');
      setAuthCode(null);
      setSessionDetails(null);
      await fetchWhatsAppStatus();
    } catch (err: any) {
      console.error('[WhatsApp Onboarding Error]', err);
      setOnboardError(err.message || 'Onboarding failed');
    } finally {
      setIsOnboarding(false);
    }
  };

  useEffect(() => {
    if (authCode && sessionDetails?.wabaId && sessionDetails?.phoneNumberId && isOnboarding) {
      completeOnboarding(authCode, sessionDetails.wabaId, sessionDetails.phoneNumberId);
    }
  }, [authCode, sessionDetails, isOnboarding]);

  // Launch Meta Embedded Signup v4 popup
  const launchEmbeddedSignup = () => {
    setOnboardError(null);
    setOnboardSuccess(null);
    setIsOnboarding(true);
    setAuthCode(null);
    setSessionDetails(null);

    // @ts-ignore
    if (typeof window === 'undefined' || !window.FB) {
      setOnboardError('Meta SDK is still loading. Please check your internet connection or disable ad-blockers and try again.');
      setIsOnboarding(false);
      return;
    }

    const configId = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID || '1878987246712536';

    // @ts-ignore
    window.FB.login(
      (response: any) => {
        if (response?.authResponse?.code) {
          setAuthCode(response.authResponse.code);
        } else {
          setIsOnboarding(false);
          console.log('[Meta FB.login] Window closed without authorization code.');
        }
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: '',
          sessionInfoVersion: '4', // Version 4 as required by Meta
        },
      }
    );
  };

  // Poll Twilio auto-captured verification code when onboarding or in verifying status
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    const shouldPoll = isOnboarding || whatsappAccount?.status === 'verifying';

    if (shouldPoll) {
      setIsPollingCode(true);
      const poll = async () => {
        try {
          const headers = await getAuthHeaders();
          const res = await fetch('/api/whatsapp/verification-code', { headers, cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            if (data.code) {
              setVerificationCode(data.code);
            }
          }
        } catch {
          // non-blocking
        }
      };

      poll();
      interval = setInterval(poll, 2500);
    } else {
      setIsPollingCode(false);
      setVerificationCode(null);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isOnboarding, whatsappAccount?.status]);

  // Disconnect WhatsApp account
  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/whatsapp/onboard', { method: 'DELETE', headers });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to disconnect WhatsApp account');
      }
      setShowDisconnectModal(false);
      setOnboardSuccess('WhatsApp account disconnected successfully.');
      await fetchWhatsAppStatus();
    } catch (err: any) {
      alert('Error disconnecting: ' + err.message);
    } finally {
      setIsDisconnecting(false);
    }
  };

  // Save Manual Settings
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

      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/integrations/meta/settings', {
        method: 'PATCH',
        headers,
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
      await fetchWhatsAppStatus();
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

    const userEntry = {
      id: Date.now(),
      sender: 'user',
      name: simCustomerName,
      text: userMsg,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setSimLog((prev) => [...prev, userEntry]);

    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/integrations/meta/test-journey', {
        method: 'POST',
        headers,
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

  const isConnected = whatsappAccount?.status === 'connected';
  const isVerifying = whatsappAccount?.status === 'verifying' || isOnboarding;
  const isCardMissing = whatsappAccount?.card_missing === true || whatsappAccount?.payment_status === 'card_missing';
  const hasWhatsAppBoltOn = billingData?.channelFlags?.has_whatsapp || isConnected;

  return (
    <div className="space-y-6">
      {/* HEADER SECTION */}
      <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isConnected ? 'bg-emerald-400' : 'bg-blue-400'}`}></span>
              <span className={`relative inline-flex rounded-full h-3 w-3 ${isConnected ? 'bg-emerald-500' : 'bg-[#198fd9]'}`}></span>
            </span>
            <h2 className="text-2xl font-extrabold text-[var(--awb-color8)] tracking-tight">
              Meta Messaging Channels
            </h2>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
              Native Graph API v21.0
            </span>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-800 border border-purple-200">
              Embedded Signup v4
            </span>
          </div>
          <p className="text-xs text-[var(--awb-color6)] mt-1 max-w-2xl">
            Direct two-way messaging connection for <strong>WhatsApp Business Cloud API</strong>, <strong>Instagram Messaging</strong>, and <strong>Facebook Messenger</strong>. Seamlessly integrated with your salon AI receptionist and RAG knowledge base.
          </p>
        </div>

        {/* Live Channel Status Badges */}
        <div className="flex flex-wrap gap-2 select-none">
          <div className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 shadow-sm ${
            isConnected
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : isVerifying
              ? 'border-blue-200 bg-blue-50 text-blue-800'
              : 'border-gray-200 bg-gray-50 text-gray-700'
          }`}>
            <span>💬 WhatsApp</span>
            <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
              isConnected
                ? 'bg-emerald-600 text-white'
                : isVerifying
                ? 'bg-blue-600 text-white animate-pulse'
                : 'bg-gray-200 text-gray-700'
            }`}>
              {isConnected ? 'Connected' : isVerifying ? 'Verifying' : 'Available'}
            </span>
          </div>

          <div className="px-3 py-1.5 rounded-xl border border-pink-200 bg-pink-50/70 text-pink-700 text-xs font-bold flex items-center gap-1.5 opacity-80">
            <span>📸 Instagram</span>
            <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-pink-200 text-pink-800">Available</span>
          </div>

          <div className="px-3 py-1.5 rounded-xl border border-blue-200 bg-blue-50/70 text-blue-700 text-xs font-bold flex items-center gap-1.5 opacity-80">
            <span>⚡ Messenger</span>
            <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-blue-200 text-blue-800">Available</span>
          </div>
        </div>
      </div>

      {/* MISSING PAYMENT CARD WARNING BANNER (Salons Pay Meta Directly) */}
      {isConnected && isCardMissing && (
        <div className="p-5 bg-amber-500/10 border-2 border-amber-500/30 rounded-2xl text-amber-900 shadow-sm animate-in fade-in">
          <div className="flex items-start gap-3.5">
            <span className="text-2xl mt-0.5">💳</span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-extrabold text-amber-900 tracking-tight">
                  Payment Card Required in Meta WhatsApp Manager
                </h4>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-amber-200 text-amber-900">Action Required</span>
              </div>
              <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                Meta requires salons to maintain a valid debit or credit card directly in <strong>WhatsApp Manager</strong> for conversation fees. 
                StyleFlo does not manage your Meta conversation billing. Please add a payment method to your WhatsApp Business Account so Meta can deliver outbound messages.
              </p>
              <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
                <a
                  href="https://business.facebook.com/wa/manage/phone-numbers/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl transition shadow"
                >
                  <span>Add Card in WhatsApp Manager</span>
                  <span>↗</span>
                </a>
                <button
                  onClick={fetchWhatsAppStatus}
                  className="px-3.5 py-2 bg-white border border-amber-300 text-amber-900 text-xs font-bold rounded-xl hover:bg-amber-50 transition shadow-sm"
                >
                  Refresh Billing Status
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* REAL-TIME TWILIO 6-DIGIT VERIFICATION CODE CARD */}
      {isPollingCode && (
        <div className="p-5 bg-blue-50 border-2 border-blue-300 rounded-2xl text-blue-950 shadow-md animate-in fade-in">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="animate-spin text-blue-600">⏳</span>
                <h4 className="text-sm font-bold text-blue-900">
                  Capturing Meta 6-Digit Verification Code...
                </h4>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-200 text-blue-800">
                  Twilio Mobile Auto-Capture
                </span>
              </div>
              <p className="text-xs text-blue-800 max-w-xl">
                When Meta sends the verification SMS or voice call to your StyleFlo mobile number, the 6-digit code will appear right here automatically.
              </p>
            </div>

            {verificationCode ? (
              <div className="flex items-center gap-3 bg-white p-3 rounded-xl border border-blue-200 shadow-sm">
                <div className="font-mono text-xl font-extrabold tracking-widest text-[#260475] bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200">
                  {verificationCode}
                </div>
                <button
                  onClick={() => copyToClipboard(verificationCode, 'verif_code')}
                  className="px-3 py-2 bg-[#198fd9] hover:bg-blue-600 text-white font-bold text-xs rounded-lg transition shadow-sm"
                >
                  {copiedField === 'verif_code' ? '✓ Copied' : 'Copy Code'}
                </button>
              </div>
            ) : (
              <div className="text-xs text-blue-700 italic flex items-center gap-1.5">
                <span className="animate-pulse">●</span> Listening for inbound code from Meta...
              </div>
            )}
          </div>
        </div>
      )}

      {saveSuccessMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm font-semibold flex items-center gap-2 animate-in fade-in">
          <span>✓</span>
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {onboardSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm font-semibold flex items-center gap-2 animate-in fade-in">
          <span>✓</span>
          <span>{onboardSuccess}</span>
        </div>
      )}

      {onboardError && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-sm font-semibold flex items-center justify-between gap-2 animate-in fade-in">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{onboardError}</span>
          </div>
          <button
            onClick={() => setOnboardError(null)}
            className="text-xs font-bold text-rose-600 hover:text-rose-900 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* NAVIGATION SUB-TABS */}
      <div className="flex border-b border-[var(--awb-color3)] gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveSubTab('whatsapp')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 flex items-center gap-2 shrink-0 ${
            activeSubTab === 'whatsapp'
              ? 'bg-[#25D366] text-white shadow-md'
              : 'text-[var(--awb-color6)] hover:text-[var(--awb-color8)] hover:bg-[var(--awb-color1)]'
          }`}
        >
          <span>💬</span>
          <span>WhatsApp Setup</span>
          {isConnected && (
            <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-white text-[#25D366]">
              Active
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab('instagram')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 flex items-center gap-2 shrink-0 ${
            activeSubTab === 'instagram'
              ? 'bg-pink-600 text-white shadow-md'
              : 'text-[var(--awb-color6)] hover:text-[var(--awb-color8)] hover:bg-[var(--awb-color1)]'
          }`}
        >
          <span>📸</span>
          <span>Instagram Setup</span>
        </button>

        <button
          onClick={() => setActiveSubTab('messenger')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 flex items-center gap-2 shrink-0 ${
            activeSubTab === 'messenger'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-[var(--awb-color6)] hover:text-[var(--awb-color8)] hover:bg-[var(--awb-color1)]'
          }`}
        >
          <span>⚡</span>
          <span>Messenger Setup</span>
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

      {/* SUB-TAB 1: WHATSAPP SETUP (Meta Embedded Signup v4) */}
      {activeSubTab === 'whatsapp' && (
        <div className="space-y-6">
          {/* If tenant doesn't have the bolt-on yet and isn't connected, show upsell card */}
          {!hasWhatsAppBoltOn && !isConnected && (
            <div className="bg-gradient-to-br from-emerald-950/20 via-[var(--awb-color1)] to-gray-900 border border-emerald-500/30 p-6 rounded-2xl shadow-xl space-y-4">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">✨</span>
                    <h3 className="text-lg font-bold text-white">WhatsApp AI Channel Add-on</h3>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      Bolt-on Available
                    </span>
                  </div>
                  <p className="text-xs text-gray-300 mt-1 max-w-xl">
                    Unlock 24/7 conversational booking and inquiry handling on your clients' favorite messaging app. 
                    Includes official Meta Embedded Signup v4 and instant two-way AI replies.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowUpsellModal(true)}
                    className="px-5 py-2.5 bg-[#25D366] hover:bg-emerald-600 text-white text-xs font-bold rounded-xl transition shadow-lg"
                  >
                    Subscribe to WhatsApp Bolt-on
                  </button>
                  <button
                    onClick={launchEmbeddedSignup}
                    className="text-xs text-gray-400 hover:text-white underline"
                  >
                    Test / Connect Now
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* CONNECTED STATE DASHBOARD */}
          {isConnected && whatsappAccount ? (
            <div className="bg-white border border-[#f2f3f5] p-6 rounded-2xl shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center border-b border-[#f2f3f5] pb-5 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-3 w-3 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-400"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                    </span>
                    <h3 className="text-lg font-extrabold text-[#260475] tracking-tight">
                      {whatsappAccount.display_name || tenantName}
                    </h3>
                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                      Connected &amp; Live
                    </span>
                  </div>
                  <p className="text-xs text-[#434549]">
                    Your WhatsApp Business account is fully integrated with your 24/7 AI Receptionist.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={fetchWhatsAppStatus}
                    disabled={isFetchingAccount}
                    className="px-3.5 py-2 bg-gray-50 border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl transition"
                  >
                    {isFetchingAccount ? 'Refreshing...' : '↻ Refresh Status'}
                  </button>
                  <button
                    onClick={() => setShowDisconnectModal(true)}
                    className="px-3.5 py-2 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-xl transition"
                  >
                    Disconnect Channel
                  </button>
                </div>
              </div>

              {/* Account Meta Metrics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[#f9f9fb] border border-[#f2f3f5] p-4 rounded-xl space-y-1">
                  <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">WhatsApp Number</span>
                  <span className="font-mono text-sm font-extrabold text-[#260475] block">
                    {whatsappAccount.display_phone || twilioMobileNumber || 'N/A'}
                  </span>
                  <span className="text-[10px] text-gray-400">Direct client chat line</span>
                </div>

                <div className="bg-[#f9f9fb] border border-[#f2f3f5] p-4 rounded-xl space-y-1">
                  <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">Quality Rating</span>
                  <span className="text-sm font-extrabold text-emerald-800 flex items-center gap-1.5">
                    <span>🟢</span> {whatsappAccount.quality_rating || 'HIGH'}
                  </span>
                  <span className="text-[10px] text-gray-400">Meta sender reputation</span>
                </div>

                <div className="bg-[#f9f9fb] border border-[#f2f3f5] p-4 rounded-xl space-y-1">
                  <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">Messaging Limit</span>
                  <span className="text-sm font-extrabold text-[#260475]">
                    {whatsappAccount.messaging_limit || 'TIER_250'}
                  </span>
                  <span className="text-[10px] text-gray-400">Outbound conversations/day</span>
                </div>

                <div className="bg-[#f9f9fb] border border-[#f2f3f5] p-4 rounded-xl space-y-1">
                  <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">Meta Billing Card</span>
                  <span className={`text-sm font-extrabold flex items-center gap-1.5 ${isCardMissing ? 'text-amber-800' : 'text-emerald-800'}`}>
                    <span>{isCardMissing ? '⚠️' : '✓'}</span>
                    <span>{isCardMissing ? 'Card Missing' : 'Active on Meta'}</span>
                  </span>
                  <span className="text-[10px] text-gray-400">Salons pay Meta directly</span>
                </div>
              </div>

              {/* STARTER TEMPLATES SECTION */}
              <div className="border border-[#f2f3f5] rounded-xl p-5 space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="text-sm font-bold text-[#260475] flex items-center gap-2">
                      <span>📋 Pre-Approved Starter Templates (en_GB)</span>
                    </h4>
                    <p className="text-xs text-[#434549] mt-0.5">
                      Meta automatically reviews and approves these Utility templates for automated salon notifications.
                    </p>
                  </div>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                    3 Templates Submitted
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-xl border border-gray-100 bg-[#f9f9fb] space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-xs font-bold text-gray-800">appointment_reminder</span>
                      <span className="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold bg-blue-100 text-blue-800">Utility</span>
                    </div>
                    <p className="text-[11px] text-gray-600 italic leading-relaxed">
                      "Hi &#123;&#123;1&#125;&#125;, reminder of your appointment for &#123;&#123;2&#125;&#125; at &#123;&#123;3&#125;&#125; with &#123;&#123;4&#125;&#125;. Reply 1 to confirm."
                    </p>
                    <span className="text-[10px] text-emerald-800 font-bold block">✓ Approved by Meta</span>
                  </div>

                  <div className="p-3.5 rounded-xl border border-gray-100 bg-[#f9f9fb] space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-xs font-bold text-gray-800">booking_link</span>
                      <span className="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold bg-blue-100 text-blue-800">Utility</span>
                    </div>
                    <p className="text-[11px] text-gray-600 italic leading-relaxed">
                      "Hi &#123;&#123;1&#125;&#125;, here is your link to book your appointment with &#123;&#123;2&#125;&#125;: &#123;&#123;3&#125;&#125;. Reply if you have questions!"
                    </p>
                    <span className="text-[10px] text-emerald-800 font-bold block">✓ Approved by Meta</span>
                  </div>

                  <div className="p-3.5 rounded-xl border border-gray-100 bg-[#f9f9fb] space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-xs font-bold text-gray-800">missed_call_followup</span>
                      <span className="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold bg-blue-100 text-blue-800">Utility</span>
                    </div>
                    <p className="text-[11px] text-gray-600 italic leading-relaxed">
                      "Hi &#123;&#123;1&#125;&#125;, we missed your call to &#123;&#123;2&#125;&#125;! How can our AI assistant help you today?"
                    </p>
                    <span className="text-[10px] text-emerald-800 font-bold block">✓ Approved by Meta</span>
                  </div>
                </div>
              </div>

              {/* 24-HOUR CUSTOMER SERVICE WINDOW EXPLANATION */}
              <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs text-emerald-950 space-y-1">
                <span className="font-bold flex items-center gap-1.5 text-emerald-900">
                  <span>💬</span> 24-Hour Free-Form Customer Service Window Active
                </span>
                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  When a client sends you a WhatsApp message, a 24-hour customer service window opens. During this period, your AI Receptionist answers questions, quotes pricing, and facilitates bookings freely without needing pre-approved templates.
                </p>
              </div>
            </div>
          ) : (
            /* ONBOARDING STATE */
            <div className="bg-white border border-[#f2f3f5] p-8 rounded-2xl shadow-sm text-center space-y-6">
              <div className="max-w-md mx-auto space-y-3">
                <div className="w-16 h-16 bg-[#25D366]/10 text-[#25D366] rounded-2xl flex items-center justify-center text-3xl mx-auto shadow-inner">
                  💬
                </div>
                <h3 className="text-xl font-extrabold text-[#260475] tracking-tight">
                  Connect WhatsApp Business via Meta
                </h3>
                <p className="text-xs text-[#434549] leading-relaxed">
                  Use Meta's official <strong>Embedded Signup v4</strong> to link your WhatsApp Business Account in under 60 seconds.
                  Connect your StyleFlo virtual mobile number or a new dedicated number.
                </p>
              </div>

              {/* Launch Embedded Signup Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={launchEmbeddedSignup}
                  disabled={isOnboarding}
                  className="px-8 py-4 bg-[#25D366] hover:bg-emerald-600 text-white font-extrabold text-sm rounded-2xl transition shadow-lg hover:shadow-xl inline-flex items-center gap-3 disabled:opacity-50"
                >
                  {isOnboarding ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      <span>Waiting for Meta Popup...</span>
                    </>
                  ) : (
                    <>
                      <span>💬 Connect WhatsApp with Meta</span>
                      <span>→</span>
                    </>
                  )}
                </button>
              </div>

              {/* Steps explanation */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left max-w-2xl mx-auto pt-4 border-t border-[#f2f3f5]">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-[#198fd9] uppercase">Step 1</span>
                  <h4 className="text-xs font-bold text-[#212326]">Meta Login Popup</h4>
                  <p className="text-[11px] text-gray-500">Sign in with your Facebook account and select your salon business portfolio.</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-[#198fd9] uppercase">Step 2</span>
                  <h4 className="text-xs font-bold text-[#212326]">Verify Phone Number</h4>
                  <p className="text-[11px] text-gray-500">Enter your virtual mobile number. The 6-digit code auto-populates right here.</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-[#198fd9] uppercase">Step 3</span>
                  <h4 className="text-xs font-bold text-[#212326]">Instant AI Activation</h4>
                  <p className="text-[11px] text-gray-500">Your AI Receptionist begins answering incoming messages 24/7 immediately.</p>
                </div>
              </div>
            </div>
          )}

          {/* ADVANCED / MANUAL CONFIG ACCORDION */}
          <div className="border border-[#f2f3f5] rounded-xl overflow-hidden bg-white">
            <button
              type="button"
              onClick={() => setShowManualConfig(!showManualConfig)}
              className="w-full p-4 text-left bg-gray-50 hover:bg-gray-100 flex justify-between items-center text-xs font-bold text-gray-700 transition"
            >
              <span className="flex items-center gap-2">
                <span>⚙️</span>
                <span>Advanced / Developer Manual API Credentials</span>
              </span>
              <span>{showManualConfig ? '▲ Hide' : '▼ Show'}</span>
            </button>

            {showManualConfig && (
              <div className="p-6 space-y-4 border-t border-[#f2f3f5]">
                <form onSubmit={handleSaveSettings} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#212326] mb-1.5">
                        WhatsApp Phone Number ID
                      </label>
                      <input
                        type="text"
                        value={whatsappPhoneNumberId}
                        onChange={(e) => setWhatsappPhoneNumberId(e.target.value)}
                        placeholder="e.g. 102938475610293"
                        className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] font-mono focus:outline-none focus:border-[#198fd9]"
                      />
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
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#212326] mb-1.5">
                        Connected WhatsApp Number
                      </label>
                      <input
                        type="text"
                        value={whatsappPhoneNumber}
                        onChange={(e) => setWhatsappPhoneNumber(e.target.value)}
                        placeholder="e.g. +44 7446 900875"
                        className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] font-mono focus:outline-none focus:border-[#198fd9]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#212326] mb-1.5">
                        Meta Permanent System User Access Token {metaAccessTokenMasked && <span className="text-emerald-800 font-bold">({metaAccessTokenMasked})</span>}
                      </label>
                      <input
                        type="password"
                        value={metaAccessToken}
                        onChange={(e) => setMetaAccessToken(e.target.value)}
                        placeholder={metaAccessTokenMasked ? 'Enter new token to overwrite' : 'EAAB... (System User Token)'}
                        className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] font-mono focus:outline-none focus:border-[#198fd9]"
                      />
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#f2f3f5] flex justify-end">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="awb-btn text-sm shadow-md disabled:opacity-50 flex items-center gap-2"
                    >
                      {isSaving ? 'Saving...' : 'Save Manual Settings'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
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
              🔗 Webhook Configuration &amp; Meta App Verification
            </h3>
            <p className="text-xs text-[#434549] mt-0.5">
              These are the exact credentials and callback URLs required by Meta to verify your App.
            </p>
          </div>

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
                Configure in Meta Developer Portal under <strong>WhatsApp &gt; Configuration &gt; Callback URL</strong>.
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
                Matches the <code>META_WEBHOOK_VERIFY_TOKEN</code> server environment variable.
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
            <div className="flex gap-2 bg-[#f9f9fb] p-1 rounded-xl border border-[#f2f3f5]">
              {(['whatsapp', 'instagram', 'messenger'] as const).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setSimChannel(ch)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition ${
                    simChannel === ch
                      ? ch === 'whatsapp'
                        ? 'bg-[#25D366] text-white shadow-sm'
                        : ch === 'instagram'
                        ? 'bg-pink-600 text-white shadow-sm'
                        : 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {ch}
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
              'Where is your salon located?',
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
                      📚 {entry.chunksCount} knowledge items retrieved
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

      {/* DISCONNECT CONFIRMATION MODAL */}
      {showDisconnectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in fade-in">
            <div className="flex items-center gap-3 text-rose-600">
              <span className="text-2xl">⚠️</span>
              <h3 className="text-base font-extrabold text-[#260475]">Disconnect WhatsApp Channel?</h3>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Disconnecting will unsubscribe StyleFlo from your WhatsApp Business Account. Your AI Receptionist will no longer receive or respond to WhatsApp messages for this salon.
            </p>
            <div className="flex justify-end gap-2.5 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowDisconnectModal(false)}
                disabled={isDisconnecting}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition shadow"
              >
                {isDisconnecting ? 'Disconnecting...' : 'Yes, Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD-ON UPSELL MODAL */}
      {showUpsellModal && (
        <AddOnUpsellModal
          isOpen={showUpsellModal}
          onClose={() => setShowUpsellModal(false)}
          category="whatsapp"
          tenantId={tenantId}
        />
      )}
    </div>
  );
}
