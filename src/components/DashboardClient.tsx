'use client';

import React, { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';

interface Chatbot {
  id: string;
  name: string;
  primary_color: string;
  configuration_json: {
    welcome_message?: string;
    suggested_prompts?: string[];
    agent_name?: string;
    agent_role?: string;
    agent_avatar_url?: string;
    branding_html?: string;
    branding_url?: string;
  };
  created_at: string;
}

interface Conversation {
  id: string;
  chatbot_id: string;
  user_session_id: string;
  created_at: string;
}

interface Message {
  id: string;
  sender_type: 'user' | 'bot';
  text_content: string;
  created_at: string;
}

interface Metrics {
  chatbotsCount: number;
  chunksCount: number;
  sessionsCount: number;
  messagesCount: number;
}

interface DashboardClientProps {
  isDevMode: boolean;
  tenantId: string;
  tenantName: string;
  userEmail: string;
  userName: string;
  initialChatbots: Chatbot[];
  initialConversations: Conversation[];
  initialMetrics: Metrics;
  isSuperAdmin: boolean;
}

export default function DashboardClient({
  isDevMode: serverDevMode,
  tenantId,
  tenantName,
  userEmail,
  userName,
  initialChatbots,
  initialConversations,
  initialMetrics,
  isSuperAdmin,
}: DashboardClientProps) {
  const [chatbots, setChatbots] = useState<Chatbot[]>(initialChatbots);
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);

  // UI state
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<Message[]>([]);
  const [isFetchingMessages, setIsFetchingMessages] = useState(false);
  const [activeTab, setActiveTab] = useState<'chatbots' | 'crawler' | 'conversations' | 'settings' | 'scheduling'>('chatbots');

  // Global settings state
  const globalBotId = '00000000-0000-0000-0000-000000000000';
  const [globalBrandingHtml, setGlobalBrandingHtml] = useState('<span style="opacity: 0.6; font-size: 11px;">⚡ Powered by <strong>StyleFlo</strong></span>');
  const [globalTrackingUrl, setGlobalTrackingUrl] = useState('https://styleflo.ai');
  const [isSavingGlobal, setIsSavingGlobal] = useState(false);  // Form states
  const [newBotName, setNewBotName] = useState('');
  const [newBotColor, setNewBotColor] = useState('#4F46E5');
  const [newBotWelcome, setNewBotWelcome] = useState('Hello! How can I help you today?');
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentRole, setNewAgentRole] = useState('AI Assistant');
  const [newAgentAvatar, setNewAgentAvatar] = useState('/avatars/avatar1.png');
  const [isCreatingBot, setIsCreatingBot] = useState(false);
  const [editingBotId, setEditingBotId] = useState<string | null>(null);

  const [crawlBotId, setCrawlBotId] = useState(initialChatbots[0]?.id || '');
  const [crawlUrl, setCrawlUrl] = useState('');
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlLogs, setCrawlLogs] = useState<string[]>([]);
  const [crawlResult, setCrawlResult] = useState<{ success: boolean; message: string } | null>(null);

  const [testWidgetBotId, setTestWidgetBotId] = useState<string | null>(null);

  // Scheduling State
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [services, setServices] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [isFetchingScheduling, setIsFetchingScheduling] = useState(false);

  const [showAddService, setShowAddService] = useState(false);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceDuration, setNewServiceDuration] = useState(30);
  const [newServiceBuffer, setNewServiceBuffer] = useState(0);

  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffCalId, setNewStaffCalId] = useState('');

  // Initialize Supabase browser client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = supabaseUrl && supabaseAnonKey
    ? createBrowserClient(supabaseUrl, supabaseAnonKey)
    : null;

  const isDev = serverDevMode || !supabase;

  const handleSignOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
      window.location.href = '/login';
    }
  };

  // Auto-select first real chatbot for crawler if available, and load global settings
  useEffect(() => {
    const realBots = chatbots.filter(b => b.id !== globalBotId);
    if (!crawlBotId && realBots.length > 0) {
      setCrawlBotId(realBots[0].id);
    }
    const globalBot = chatbots.find(b => b.id === globalBotId);
    if (globalBot?.configuration_json) {
      if (globalBot.configuration_json.branding_html) setGlobalBrandingHtml(globalBot.configuration_json.branding_html);
      if (globalBot.configuration_json.branding_url) setGlobalTrackingUrl(globalBot.configuration_json.branding_url);
    }
  }, [chatbots, crawlBotId]);

  // Fetch scheduling config on mount
  useEffect(() => {
    async function fetchScheduling() {
      setIsFetchingScheduling(true);
      try {
        const [statusRes, servicesRes, staffRes] = await Promise.all([
          fetch(`/api/integrations/google/status?tenantId=${tenantId}`),
          fetch(`/api/services?tenantId=${tenantId}`),
          fetch(`/api/staff?tenantId=${tenantId}`)
        ]);
        
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          setIsGoogleConnected(statusData.connected);
        }
        if (servicesRes.ok) {
          const servicesData = await servicesRes.json();
          setServices(servicesData.services || []);
        }
        if (staffRes.ok) {
          const staffData = await staffRes.json();
          setStaff(staffData.staff || []);
        }
      } catch (err) {
        console.error('Failed to fetch scheduling data:', err);
      }
      setIsFetchingScheduling(false);
    }
    fetchScheduling();
  }, [tenantId]);

  // Fetch messages when conversation selection changes
  useEffect(() => {
    if (!selectedConversation) {
      setConversationMessages([]);
      return;
    }

    const convoId = selectedConversation;

    async function fetchMessages() {
      setIsFetchingMessages(true);
      
      try {
        // Always attempt to fetch from our secure API first to bypass RLS and function when client-side Supabase client is uninitialized
        const response = await fetch(
          `/api/messages?conversationId=${encodeURIComponent(convoId)}&tenantId=${encodeURIComponent(tenantId)}`
        );
        if (response.ok) {
          const resData = await response.json();
          setConversationMessages(resData.messages || []);
        } else {
          throw new Error(response.statusText);
        }
      } catch (err) {
        console.error('Failed to fetch messages via API, trying direct client query:', err);
        if (supabase) {
          try {
            const { data, error } = await supabase
              .from('messages')
              .select('*')
              .eq('conversation_id', convoId)
              .eq('tenant_id', tenantId)
              .order('created_at', { ascending: true });

            if (!error && data) {
              setConversationMessages(data);
            }
          } catch (clientErr) {
            console.error('Client-side messages fetch failed:', clientErr);
          }
        } else {
          // Fallback mock messages for Acme Seed conversation in visual-only mode if API completely failed
          if (convoId === 'ea111111-1111-4111-8111-111111111111') {
            setConversationMessages([
              {
                id: 'm1',
                sender_type: 'user',
                text_content: 'What is Acme?',
                created_at: new Date(Date.now() - 300000).toISOString(),
              },
              {
                id: 'm2',
                sender_type: 'bot',
                text_content: 'Acme Corp is a globally renowned supplier of premium anvils, rockets, and giant magnets.',
                created_at: new Date(Date.now() - 240000).toISOString(),
              },
            ]);
          } else {
            setConversationMessages([]);
          }
        }
      }
      setIsFetchingMessages(false);
    }

    fetchMessages();
  }, [selectedConversation, supabase, tenantId]);

  // Create Chatbot handler
  const handleCreateChatbot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBotName.trim()) return;

    setIsCreatingBot(true);
    let successfullySaved = false;
    const newId = crypto.randomUUID();
    const newChatbot: Chatbot = {
      id: newId,
      name: newBotName,
      primary_color: newBotColor,
      configuration_json: {
        welcome_message: newBotWelcome,
        agent_name: newAgentName.trim() || newBotName,
        agent_role: newAgentRole.trim(),
        agent_avatar_url: newAgentAvatar,
      },
      created_at: new Date().toISOString(),
    };

    try {
      // Always route through API endpoints to bypass RLS issues and function even if client-side Supabase client is uninitialized
      const response = await fetch('/api/chatbots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          tenant_id: tenantId,
          name: newBotName,
          primary_color: newBotColor,
          configuration_json: {
            welcome_message: newBotWelcome,
            agent_name: newAgentName.trim() || newBotName,
            agent_role: newAgentRole.trim(),
            agent_avatar_url: newAgentAvatar,
          },
        }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || response.statusText);
      }
      successfullySaved = true;
    } catch (err: any) {
      console.error('Failed to save chatbot to database:', err);
      if (!supabase) {
        console.warn('Operating in visual-only mode, mockup saving locally.');
        successfullySaved = true;
      } else {
        alert(`Failed to save to database: ${err.message}`);
      }
    }

    if (successfullySaved) {
      setChatbots([newChatbot, ...chatbots]);
      setMetrics((prev) => ({
        ...prev,
        chatbotsCount: prev.chatbotsCount + 1,
      }));
      setNewBotName('');
      setNewBotWelcome('Hello! How can I help you today?');
      setNewAgentName('');
      setNewAgentRole('AI Assistant');
      setNewAgentAvatar('/avatars/avatar1.png');
    }
    setIsCreatingBot(false);
  };

  const handleUpdateChatbot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBotId || !newBotName.trim()) return;

    setIsCreatingBot(true);
    let successfullySaved = false;

    const updatedConfig = {
      welcome_message: newBotWelcome,
      agent_name: newAgentName.trim() || newBotName,
      agent_role: newAgentRole.trim(),
      agent_avatar_url: newAgentAvatar,
    };

    try {
      // Always route through API endpoints to bypass RLS issues and function even if client-side Supabase client is uninitialized
      const response = await fetch(`/api/chatbots/${encodeURIComponent(editingBotId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newBotName,
          primary_color: newBotColor,
          configuration_json: updatedConfig,
        }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || response.statusText);
      }
      successfullySaved = true;
    } catch (err: any) {
      console.error('Failed to update chatbot in database:', err);
      if (!supabase) {
        console.warn('Operating in visual-only mode, mockup saving locally.');
        successfullySaved = true;
      } else {
        alert(`Failed to save to database: ${err.message}`);
      }
    }

    if (successfullySaved) {
      setChatbots(chatbots.map(bot => bot.id === editingBotId ? {
        ...bot,
        name: newBotName,
        primary_color: newBotColor,
        configuration_json: updatedConfig
      } : bot));
      
      setEditingBotId(null);
      setNewBotName('');
      setNewBotWelcome('Hello! How can I help you today?');
      setNewAgentName('');
      setNewAgentRole('AI Assistant');
      setNewAgentAvatar('/avatars/avatar1.png');
    }
    setIsCreatingBot(false);
  };

  const handleSaveGlobalSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingGlobal(true);
    try {
      const response = await fetch(`/api/chatbots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: globalBotId,
          tenant_id: tenantId,
          name: 'GLOBAL_PLATFORM_SETTINGS',
          primary_color: '#000000',
          configuration_json: {
            branding_html: globalBrandingHtml,
            branding_url: globalTrackingUrl,
          },
        }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || response.statusText);
      }
      // Update local state
      setChatbots(prev => {
        const existing = prev.find(b => b.id === globalBotId);
        if (existing) {
          return prev.map(b => b.id === globalBotId ? { ...b, configuration_json: { ...b.configuration_json, branding_html: globalBrandingHtml, branding_url: globalTrackingUrl } } : b);
        } else {
          return [{ id: globalBotId, name: 'GLOBAL_PLATFORM_SETTINGS', primary_color: '#000000', configuration_json: { branding_html: globalBrandingHtml, branding_url: globalTrackingUrl }, created_at: new Date().toISOString() }, ...prev];
        }
      });
      alert('Global platform settings saved successfully!');
    } catch (err: any) {
      console.error('Failed to save global settings:', err);
      alert(`Failed to save: ${err.message}`);
    } finally {
      setIsSavingGlobal(false);
    }
  };

  // Crawling Trigger handler
  const handleTriggerCrawl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crawlUrl.trim() || !crawlBotId) return;

    setIsCrawling(true);
    setCrawlResult(null);
    setCrawlLogs([`[System] Initializing scraper for URLs...`]);

    const urls = crawlUrl.split(/[\s,]+/).map(u => u.trim()).filter(u => u);
    let totalChunks = 0;
    let hasError = false;

    for (let i = 0; i < urls.length; i++) {
      const currentUrl = urls[i];
      setCrawlLogs((prev) => [...prev, `[System] [${i+1}/${urls.length}] Crawling ${currentUrl}...`]);

      try {
        const response = await fetch('/api/ingest/crawl', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: currentUrl,
            chatbotId: crawlBotId,
          }),
        });

        const data = await response.json();

        if (response.ok) {
          setCrawlLogs((prev) => [...prev, `[Supabase] Ingested ${data.chunksCount} chunks from ${currentUrl}.`]);
          totalChunks += data.chunksCount;
        } else {
          hasError = true;
          setCrawlLogs((prev) => [...prev, `[Error] Failed to crawl ${currentUrl}: ${data.error || 'Unknown error'}`]);
        }
      } catch (err: any) {
        hasError = true;
        console.warn(`[Dashboard] Ingestion failed for ${currentUrl}:`, err.message || err);
        setCrawlLogs((prev) => [...prev, `[Error] Failed to crawl ${currentUrl}: ${err.message || err}`]);
      }
    }

    if (!hasError) {
      setCrawlLogs((prev) => [...prev, `[Success] Batch crawl finished! Total chunks ingested: ${totalChunks}.`]);
      setCrawlResult({
        success: true,
        message: `Successfully crawled and ingested ${totalChunks} content chunks.`,
      });
      setMetrics((prev) => ({
        ...prev,
        chunksCount: prev.chunksCount + totalChunks,
      }));
      setCrawlUrl('');
    } else {
      setCrawlResult({
        success: false,
        message: `Crawling finished with errors. Ingested ${totalChunks} chunks. See logs.`,
      });
    }

    setIsCrawling(false);
  };

  // Scheduling Handlers
  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          name: newServiceName,
          duration_minutes: newServiceDuration,
          buffer_minutes: newServiceBuffer
        })
      });
      if (res.ok) {
        const data = await res.json();
        setServices([...services, data.service]);
        setShowAddService(false);
        setNewServiceName('');
        setNewServiceDuration(30);
        setNewServiceBuffer(0);
      } else {
        alert('Failed to add service');
      }
    } catch (err) {
      console.error(err);
      alert('Error adding service');
    }
  };

  const handleDeleteService = async (id: string) => {
    if (!confirm('Are you sure you want to delete this service?')) return;
    try {
      const res = await fetch(`/api/services?id=${id}&tenantId=${tenantId}`, { method: 'DELETE' });
      if (res.ok) {
        setServices(services.filter(s => s.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          name: newStaffName,
          email: newStaffEmail,
          google_calendar_id: newStaffCalId || 'primary'
        })
      });
      if (res.ok) {
        const data = await res.json();
        setStaff([...staff, data.staff]);
        setShowAddStaff(false);
        setNewStaffName('');
        setNewStaffEmail('');
        setNewStaffCalId('');
      } else {
        alert('Failed to add staff');
      }
    } catch (err) {
      console.error(err);
      alert('Error adding staff');
    }
  };

  const handleDeleteStaff = async (id: string) => {
    if (!confirm('Are you sure you want to delete this staff member?')) return;
    try {
      const res = await fetch(`/api/staff?id=${id}&tenantId=${tenantId}`, { method: 'DELETE' });
      if (res.ok) {
        setStaff(staff.filter(s => s.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Dev Mode Banner */}
      {isDev && (
        <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-2xl p-4 flex items-center justify-between backdrop-blur-md">
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
            </span>
            <p className="text-sm text-indigo-200">
              <strong className="font-semibold">Development Mode</strong>: Running with seeded database fallback. No Supabase user login is required to test features locally.
            </p>
          </div>
          <span className="text-xs text-indigo-400 font-mono bg-indigo-900/40 px-2.5 py-1 rounded-lg">
            Tenant: {tenantName}
          </span>
        </div>
      )}

      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-gray-900">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
            StyleFlo Dashboard
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Multi-tenant AI RAG Assistant Panel • <span className="text-indigo-400 font-medium">{tenantName}</span>
          </p>
        </div>
        <div className="flex items-center gap-3.5 bg-gray-900/60 border border-gray-800/80 px-4 py-2.5 rounded-2xl">
          <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center font-bold text-sm text-white">
            {userName[0]}
          </div>
          <div>
            <div className="text-xs font-semibold text-white leading-none">{userName}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{userEmail}</div>
          </div>
          
          <button
            onClick={handleSignOut}
            className="ml-4 px-3 py-1.5 bg-gray-900 hover:bg-red-600/20 text-gray-400 hover:text-red-400 border border-gray-800 hover:border-red-900 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
            title="Sign Out"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      </header>

      {/* Metrics Section */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Active Chatbots', value: metrics.chatbotsCount, icon: '🤖', color: 'text-emerald-400' },
          { label: 'Ingested Chunks', value: metrics.chunksCount, icon: '📄', color: 'text-indigo-400' },
          { label: 'Total Sessions', value: metrics.sessionsCount, icon: '💬', color: 'text-purple-400' },
          { label: 'Logged Messages', value: metrics.messagesCount, icon: '📥', color: 'text-pink-400' },
        ].map((metric, i) => (
          <div key={i} className="bg-gray-900/40 border border-gray-900 rounded-2xl p-5 shadow-lg flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400 font-medium">{metric.label}</p>
              <h2 className="text-3xl font-extrabold text-white mt-1.5">{metric.value}</h2>
            </div>
            <div className={`text-2xl ${metric.color} bg-gray-950 p-2.5 rounded-xl`}>{metric.icon}</div>
          </div>
        ))}
      </section>

      {/* Tabs */}
      <div className="flex border-b border-gray-900 gap-6">
        {[
          { id: 'chatbots', label: 'Chatbots Manager', count: chatbots.filter(b => b.id !== globalBotId).length },
          { id: 'crawler', label: 'Crawl Console' },
          { id: 'conversations', label: 'Conversation Logs', count: conversations.length },
          { id: 'scheduling', label: 'Scheduling & Staff' },
          ...(isSuperAdmin ? [{ id: 'settings', label: 'Platform Settings' }] : []),
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`pb-4 text-sm font-medium transition-all relative ${
              activeTab === tab.id
                ? 'text-white border-b-2 border-indigo-500'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-2 text-xs bg-gray-900 text-gray-400 px-1.5 py-0.5 rounded-full font-mono">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main Container */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Area (2/3 width) */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Chatbots Tab */}
          {activeTab === 'chatbots' && (
            <div className="space-y-6">
              {/* Create Chatbot Card */}
              <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl">
                <h3 className="text-lg font-bold text-white mb-4">
                  {editingBotId ? `Edit Chatbot: ${newBotName}` : 'Create New Chatbot'}
                </h3>
                <form onSubmit={editingBotId ? handleUpdateChatbot : handleCreateChatbot} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 mb-1.5">Chatbot Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Acme Support Bot"
                        value={newBotName}
                        onChange={(e) => setNewBotName(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 mb-1.5">Branding Accent Color</label>
                      <div className="flex gap-2.5 items-center">
                        <input
                          type="color"
                          value={newBotColor}
                          onChange={(e) => setNewBotColor(e.target.value)}
                          className="w-10 h-9 bg-gray-950 border border-gray-800 rounded-xl cursor-pointer p-1"
                        />
                        <input
                          type="text"
                          value={newBotColor}
                          onChange={(e) => setNewBotColor(e.target.value)}
                          className="flex-1 bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white font-mono"
                        />
                      </div>
                    </div>
                  </div>
                   <div>
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">Welcome Message</label>
                    <input
                      type="text"
                      value={newBotWelcome}
                      onChange={(e) => setNewBotWelcome(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white"
                      required
                    />
                  </div>

                  <div className="border-t border-gray-800/80 pt-4 space-y-4">
                    <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Agent Profile Persona</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 mb-1.5">Agent Display Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Emma (AI Agent)"
                          value={newAgentName}
                          onChange={(e) => setNewAgentName(e.target.value)}
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 mb-1.5">Agent Role Subtitle</label>
                        <input
                          type="text"
                          placeholder="e.g. StyleFlo Advisor"
                          value={newAgentRole}
                          onChange={(e) => setNewAgentRole(e.target.value)}
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-400 mb-2">Select Agent Avatar Preset</label>
                      <div className="flex gap-4">
                        {[
                          { id: '/avatars/avatar1.png', label: 'Robo Assistant' },
                          { id: '/avatars/avatar2.png', label: 'Support Specialist' },
                          { id: '/avatars/avatar3.png', label: 'Brand Mascot' },
                        ].map((avatar) => (
                          <button
                            key={avatar.id}
                            type="button"
                            onClick={() => setNewAgentAvatar(avatar.id)}
                            className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all ${
                              newAgentAvatar === avatar.id
                                ? 'bg-indigo-950/20 border-indigo-500 shadow-md shadow-indigo-500/10'
                                : 'bg-gray-950/40 border-gray-800 hover:border-gray-700'
                            }`}
                          >
                            <img
                              src={avatar.id}
                              alt={avatar.label}
                              className="w-12 h-12 rounded-full border border-gray-800 object-cover bg-gray-900"
                            />
                            <span className="text-[10px] text-gray-400 font-medium">{avatar.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={isCreatingBot}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-2 px-5 rounded-xl shadow-lg shadow-indigo-500/10 transition-colors disabled:opacity-50"
                    >
                      {isCreatingBot ? 'Saving...' : (editingBotId ? 'Save Changes' : 'Create Chatbot')}
                    </button>
                    {editingBotId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBotId(null);
                          setNewBotName('');
                          setNewBotWelcome('Hello! How can I help you today?');
                          setNewAgentName('');
                          setNewAgentRole('AI Assistant');
                          setNewAgentAvatar('/avatars/avatar1.png');
                        }}
                        className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-semibold py-2 px-5 rounded-xl transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* Chatbots Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {chatbots.filter(b => b.id !== globalBotId).map((bot) => (
                  <div key={bot.id} className="bg-gray-900/40 border border-gray-900 p-5 rounded-2xl shadow-md space-y-4 hover:border-gray-800 transition-colors relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1.5 h-full" style={{ backgroundColor: bot.primary_color }} />
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-white text-base">{bot.name}</h4>
                        <p className="text-[10px] text-gray-400 font-mono mt-0.5">{bot.id}</p>
                      </div>
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: bot.primary_color }} />
                    </div>
                    <div className="bg-gray-950/60 p-3 rounded-xl text-xs text-gray-300 italic border border-gray-950">
                      "{bot.configuration_json?.welcome_message || 'Hello!'}"
                    </div>

                    <div className="flex items-center gap-3 bg-gray-950/40 p-2.5 rounded-xl border border-gray-950/50">
                      <img
                        src={bot.configuration_json?.agent_avatar_url || '/avatars/avatar1.png'}
                        alt="Agent Avatar"
                        className="w-9 h-9 rounded-full border bg-gray-900 object-cover"
                        style={{ borderColor: bot.primary_color }}
                      />
                      <div>
                        <div className="text-xs font-semibold text-white">
                          {bot.configuration_json?.agent_name || bot.name}
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {bot.configuration_json?.agent_role || 'AI Assistant'}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => setTestWidgetBotId(testWidgetBotId === bot.id ? null : bot.id)}
                        className="flex-1 bg-gray-950 hover:bg-gray-900 text-gray-300 hover:text-white border border-gray-800 py-1.5 px-3 rounded-xl text-xs font-semibold transition-colors"
                      >
                        {testWidgetBotId === bot.id ? 'Hide Embed Code' : 'Embed Code'}
                      </button>
                      <button
                        onClick={() => {
                          setEditingBotId(bot.id);
                          setNewBotName(bot.name);
                          setNewBotColor(bot.primary_color);
                          setNewBotWelcome(bot.configuration_json?.welcome_message || 'Hello!');
                          setNewAgentName(bot.configuration_json?.agent_name || bot.name);
                          setNewAgentRole(bot.configuration_json?.agent_role || 'AI Assistant');
                          setNewAgentAvatar(bot.configuration_json?.agent_avatar_url || '/avatars/avatar1.png');
                          
                          // Scroll form into view
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="flex-1 bg-indigo-950/40 hover:bg-indigo-950/70 text-indigo-300 hover:text-indigo-200 border border-indigo-900/50 py-1.5 px-3 rounded-xl text-xs font-semibold transition-colors"
                      >
                        Edit Persona
                      </button>
                    </div>

                    {/* Embed Code Section */}
                    {testWidgetBotId === bot.id && (
                      <div className="pt-2 text-left space-y-2 border-t border-gray-800 mt-2">
                        <label className="block text-[10px] font-semibold text-gray-400">Host Injection Snippet:</label>
                        <pre className="p-2.5 bg-gray-950 border border-gray-800 text-[10px] rounded-xl overflow-x-auto text-gray-300 font-mono leading-relaxed select-all">
                          {`<!-- StyleFlo Widget Injection -->\n<script\n  src="${window.location.origin}/widget.js"\n  data-bot-id="${bot.id}">\n</script>`}
                        </pre>
                        <p className="text-[9px] text-gray-400">
                          Paste this tag inside any website's <code>&lt;body&gt;</code> container to inject the floating chatbot.
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Crawler Tab */}
          {activeTab === 'crawler' && (
            <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl space-y-6">
              <div>
                <h3 className="text-lg font-bold text-white">Ingest Website Content</h3>
                <p className="text-xs text-gray-400 mt-0.5">Scrapes client sites, chunks content, generates embeddings, and saves vectors to the chatbot.</p>
              </div>

              <form onSubmit={handleTriggerCrawl} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-1">
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">Target Chatbot</label>
                    <select
                      value={crawlBotId}
                      onChange={(e) => setCrawlBotId(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      required
                    >
                      <option value="" disabled>Select chatbot...</option>
                      {chatbots.filter(b => b.id !== globalBotId).map((bot) => (
                        <option key={bot.id} value={bot.id}>
                          {bot.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">Website URLs to Scrape (comma or space separated)</label>
                    <textarea
                      placeholder="https://example.com/about, https://example.com/pricing"
                      value={crawlUrl}
                      onChange={(e) => setCrawlUrl(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white min-h-[42px] resize-y"
                      required
                      rows={2}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isCrawling || !crawlBotId || !crawlUrl}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-2 px-5 rounded-xl shadow-lg shadow-indigo-500/10 transition-colors disabled:opacity-50"
                >
                  {isCrawling ? 'Processing Crawler...' : 'Trigger Crawler Pipeline'}
                </button>
              </form>

              {/* Crawler Log Screen */}
              {crawlLogs.length > 0 && (
                <div className="space-y-2 mt-6">
                  <label className="block text-xs font-semibold text-gray-400">Scraper Console Output:</label>
                  <div className="p-4 bg-gray-950 border border-gray-900 rounded-2xl font-mono text-xs text-gray-300 h-48 overflow-y-auto space-y-1.5 styleflo-scrollbar">
                    {crawlLogs.map((log, i) => (
                      <div key={i} className={
                        log.startsWith('[Error]') ? 'text-red-400' :
                        log.startsWith('[Success]') ? 'text-emerald-400 font-semibold' :
                        log.startsWith('[System]') ? 'text-indigo-400' : 'text-gray-300'
                      }>
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Crawl Result Status Alert */}
              {crawlResult && (
                <div className={`p-4 rounded-xl border text-sm ${
                  crawlResult.success
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200'
                    : 'bg-red-950/40 border-red-500/30 text-red-200'
                }`}>
                  {crawlResult.message}
                </div>
              )}
            </div>
          )}

          {/* Conversations Tab */}
          {activeTab === 'conversations' && (
            <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl">
              <h3 className="text-lg font-bold text-white mb-2">Conversation Session Index</h3>
              <p className="text-xs text-gray-400">Select any chat session from the explorer panel on the right to browse user transcripts.</p>
            </div>
          )}

          {/* Platform Settings Tab */}
          {activeTab === 'settings' && (
            <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl space-y-6">
              <div>
                <h3 className="text-lg font-bold text-white">Global Platform Settings</h3>
                <p className="text-xs text-gray-400 mt-0.5">Manage system-wide configurations, including the chatbot widget branding.</p>
              </div>

              <form onSubmit={handleSaveGlobalSettings} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5">Branding HTML (Footer Watermark)</label>
                  <textarea
                    value={globalBrandingHtml}
                    onChange={(e) => setGlobalBrandingHtml(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono min-h-[80px]"
                    placeholder='<span style="opacity: 0.6; font-size: 11px;">⚡ Powered by StyleFlo</span>'
                  />
                  <p className="text-[10px] text-gray-500 mt-1">This HTML is injected at the bottom of all chatbot widgets. It will automatically be wrapped in an anchor tag pointing to the URL below.</p>
                </div>
                
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5">Tracking Destination URL</label>
                  <input
                    type="url"
                    value={globalTrackingUrl}
                    onChange={(e) => setGlobalTrackingUrl(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="https://styleflo.ai"
                    required
                  />
                  <p className="text-[10px] text-gray-500 mt-1">Users clicking the watermark will be tracked and redirected here. Originating chatbot ID will be appended as ?ref=...</p>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSavingGlobal}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-2 px-5 rounded-xl shadow-lg shadow-indigo-500/10 transition-colors disabled:opacity-50"
                  >
                    {isSavingGlobal ? 'Saving Settings...' : 'Save Global Settings'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Scheduling Tab */}
          {activeTab === 'scheduling' && (
            <div className="space-y-6">
              
              {/* Google Connection Status */}
              <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white">Google Calendar Integration</h3>
                  <p className="text-sm text-gray-400 mt-1">Connect your Google account to allow AI to read availability and book appointments.</p>
                </div>
                <div>
                  {isFetchingScheduling ? (
                    <span className="text-gray-500 font-semibold text-sm">Checking...</span>
                  ) : isGoogleConnected ? (
                    <div className="flex items-center gap-2 text-emerald-400 font-bold bg-emerald-400/10 px-4 py-2 rounded-xl">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                      Connected
                    </div>
                  ) : (
                    <button
                      onClick={() => window.location.href = `/api/integrations/google/authorize?tenantId=${tenantId}`}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg transition-colors flex items-center gap-2"
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574s3.345-7.574 7.439-7.574c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z"/>
                      </svg>
                      Connect Calendar
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Services List */}
                <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl flex flex-col h-[500px] relative">
                  {showAddService ? (
                    <div className="absolute inset-0 bg-gray-950 p-6 rounded-2xl z-10 flex flex-col">
                      <h3 className="text-lg font-bold text-white mb-4">Add New Service</h3>
                      <form onSubmit={handleAddService} className="flex-1 flex flex-col gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-1">Service Name</label>
                          <input required type="text" value={newServiceName} onChange={e => setNewServiceName(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. Consultation" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-400 mb-1">Duration (mins)</label>
                            <input required type="number" min="5" step="5" value={newServiceDuration} onChange={e => setNewServiceDuration(parseInt(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-400 mb-1">Buffer (mins)</label>
                            <input required type="number" min="0" step="5" value={newServiceBuffer} onChange={e => setNewServiceBuffer(parseInt(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" />
                          </div>
                        </div>
                        <div className="mt-auto flex justify-end gap-3">
                          <button type="button" onClick={() => setShowAddService(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
                          <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold">Save Service</button>
                        </div>
                      </form>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white">Services</h3>
                    <button onClick={() => setShowAddService(true)} className="bg-gray-800 hover:bg-gray-700 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors">
                      + Add Service
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-3 styleflo-scrollbar pr-2">
                    {services.length === 0 ? (
                      <div className="text-sm text-gray-500 italic text-center mt-10">No services configured yet.</div>
                    ) : services.map(srv => (
                      <div key={srv.id} className="bg-gray-950 border border-gray-800 p-4 rounded-xl flex items-center justify-between group hover:border-gray-700 transition-colors">
                        <div>
                          <div className="font-bold text-gray-200 text-sm">{srv.name}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{srv.duration_minutes}m duration {srv.buffer_minutes ? `+ ${srv.buffer_minutes}m buffer` : ''}</div>
                        </div>
                        <button onClick={() => handleDeleteService(srv.id)} className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Staff List */}
                <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl flex flex-col h-[500px] relative">
                  {showAddStaff ? (
                    <div className="absolute inset-0 bg-gray-950 p-6 rounded-2xl z-10 flex flex-col">
                      <h3 className="text-lg font-bold text-white mb-4">Add Staff Member</h3>
                      <form onSubmit={handleAddStaff} className="flex-1 flex flex-col gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-1">Name</label>
                          <input required type="text" value={newStaffName} onChange={e => setNewStaffName(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. John Doe" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-1">Email</label>
                          <input required type="email" value={newStaffEmail} onChange={e => setNewStaffEmail(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" placeholder="john@example.com" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-1">Google Calendar ID (Optional)</label>
                          <input type="text" value={newStaffCalId} onChange={e => setNewStaffCalId(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" placeholder="Defaults to 'primary'" />
                        </div>
                        <div className="mt-auto flex justify-end gap-3">
                          <button type="button" onClick={() => setShowAddStaff(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
                          <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold">Save Staff</button>
                        </div>
                      </form>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white">Staff Schedule</h3>
                    <button onClick={() => setShowAddStaff(true)} className="bg-gray-800 hover:bg-gray-700 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors">
                      + Add Staff
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-3 styleflo-scrollbar pr-2">
                    {staff.length === 0 ? (
                      <div className="text-sm text-gray-500 italic text-center mt-10">No staff configured yet.</div>
                    ) : staff.map(stf => (
                      <div key={stf.id} className="bg-gray-950 border border-gray-800 p-4 rounded-xl flex flex-col gap-2 group hover:border-gray-700 transition-colors">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-bold text-gray-200 text-sm">{stf.name}</div>
                            <div className="text-[10px] text-gray-500 font-mono mt-0.5">{stf.email}</div>
                          </div>
                          <button onClick={() => handleDeleteStaff(stf.id)} className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                          </button>
                        </div>
                        <div className="text-[11px] text-gray-400 bg-gray-900 p-2 rounded-lg">
                          Cal ID: <span className="text-indigo-400 break-all">{stf.google_calendar_id}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Right Area (1/3 width) - Session logs & Explorer */}
        <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl h-[550px] flex flex-col">
          <h3 className="text-base font-bold text-white mb-4">Conversation Explorer</h3>

          {/* Conversation sessions list */}
          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 styleflo-scrollbar mb-4">
            {conversations.length === 0 ? (
              <div className="text-center text-xs text-gray-500 py-10">No sessions logged yet.</div>
            ) : (
              conversations.map((conv) => {
                const chatbotName = chatbots.find(b => b.id === conv.chatbot_id)?.name || 'AI Bot';
                return (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConversation(conv.id)}
                    className={`w-full text-left p-3 rounded-xl border text-xs transition-all flex flex-col gap-1.5 ${
                      selectedConversation === conv.id
                        ? 'bg-indigo-950/40 border-indigo-500/40 text-white shadow-md'
                        : 'bg-gray-950/40 border-gray-950 hover:bg-gray-950/70 text-gray-400 hover:text-gray-300'
                    }`}
                  >
                    <div className="flex justify-between items-center w-full">
                      <span className="font-bold">{chatbotName}</span>
                      <span className="text-[10px] text-gray-500 font-mono">
                        {new Date(conv.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] truncate w-full text-gray-500">
                      ID: {conv.user_session_id}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Messages display */}
          <div className="border-t border-gray-900 pt-4 flex flex-col h-72">
            <h4 className="text-xs font-bold text-white mb-2">Transcript Viewer</h4>
            
            <div className="flex-1 overflow-y-auto p-3 bg-gray-950 border border-gray-950 rounded-xl space-y-3 styleflo-scrollbar">
              {isFetchingMessages ? (
                <div className="h-full flex items-center justify-center text-xs text-gray-500">
                  Loading message history...
                </div>
              ) : selectedConversation ? (
                conversationMessages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-gray-500 italic">
                    Empty conversation logs.
                  </div>
                ) : (
                  conversationMessages.map((msg, i) => (
                    <div key={msg.id || i} className={`flex ${msg.sender_type === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`p-2.5 rounded-xl text-xs max-w-[90%] leading-relaxed ${
                        msg.sender_type === 'user'
                          ? 'bg-indigo-600 text-white rounded-tr-none'
                          : 'bg-gray-900 text-gray-300 rounded-tl-none border border-gray-800'
                      }`}>
                        {msg.text_content}
                      </div>
                    </div>
                  ))
                )
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-gray-500 text-center italic">
                  Select a session from the explorer above to view chat transcripts.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
