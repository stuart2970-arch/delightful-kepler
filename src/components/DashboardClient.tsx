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
}: DashboardClientProps) {
  const [chatbots, setChatbots] = useState<Chatbot[]>(initialChatbots);
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);

  // UI state
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<Message[]>([]);
  const [isFetchingMessages, setIsFetchingMessages] = useState(false);
  const [activeTab, setActiveTab] = useState<'chatbots' | 'crawler' | 'conversations'>('chatbots');

  // Form states
  const [newBotName, setNewBotName] = useState('');
  const [newBotColor, setNewBotColor] = useState('#4F46E5');
  const [newBotWelcome, setNewBotWelcome] = useState('Hello! How can I help you today?');
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentRole, setNewAgentRole] = useState('AI Assistant');
  const [newAgentAvatar, setNewAgentAvatar] = useState('/avatars/avatar1.png');
  const [isCreatingBot, setIsCreatingBot] = useState(false);

  const [crawlBotId, setCrawlBotId] = useState(initialChatbots[0]?.id || '');
  const [crawlUrl, setCrawlUrl] = useState('');
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlLogs, setCrawlLogs] = useState<string[]>([]);
  const [crawlResult, setCrawlResult] = useState<{ success: boolean; message: string } | null>(null);

  const [testWidgetBotId, setTestWidgetBotId] = useState<string | null>(null);

  // Initialize Supabase browser client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = supabaseUrl && supabaseAnonKey
    ? createBrowserClient(supabaseUrl, supabaseAnonKey)
    : null;

  const isDev = serverDevMode || !supabase;

  // Auto-select first chatbot for crawler if available
  useEffect(() => {
    if (chatbots.length > 0 && !crawlBotId) {
      setCrawlBotId(chatbots[0].id);
    }
  }, [chatbots, crawlBotId]);

  // Fetch messages when conversation selection changes
  useEffect(() => {
    if (!selectedConversation) {
      setConversationMessages([]);
      return;
    }

    async function fetchMessages() {
      setIsFetchingMessages(true);
      if (supabase) {
        try {
          const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', selectedConversation)
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: true });

          if (!error && data) {
            setConversationMessages(data);
          } else {
            console.error('Error fetching messages:', error);
          }
        } catch (err) {
          console.error('Failed to fetch messages:', err);
        }
      } else {
        // Fallback mock messages for Acme Seed conversation in visual-only mode
        if (selectedConversation === 'ea111111-1111-4111-8111-111111111111') {
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
      setIsFetchingMessages(false);
    }

    fetchMessages();
  }, [selectedConversation, supabase, tenantId]);

  // Create Chatbot handler
  const handleCreateChatbot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBotName.trim()) return;

    setIsCreatingBot(true);
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

    let successfullySaved = false;

    if (supabase && !isDev) {
      try {
        const { error } = await supabase.from('chatbots').insert({
          id: newId,
          tenant_id: tenantId,
          name: newBotName,
          configuration_json: {
            welcome_message: newBotWelcome,
            agent_name: newAgentName.trim() || newBotName,
            agent_role: newAgentRole.trim(),
            agent_avatar_url: newAgentAvatar,
          },
          primary_color: newBotColor,
        });

        if (!error) {
          successfullySaved = true;
        } else {
          alert(`Database error: ${error.message}`);
        }
      } catch (err: any) {
        alert(`Failed to save to database: ${err.message}`);
      }
    } else {
      // In Dev Mode / Visual Mode, succeed locally in page state
      successfullySaved = true;
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

  // Crawling Trigger handler
  const handleTriggerCrawl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crawlUrl.trim() || !crawlBotId) return;

    setIsCrawling(true);
    setCrawlResult(null);
    setCrawlLogs([`[System] Initializing scraper for URL: ${crawlUrl}...`]);

    const timeouts: NodeJS.Timeout[] = [];

    try {
      // Simulate real-time progress logging
      timeouts.push(setTimeout(() => {
        setCrawlLogs((prev) => [...prev, `[Scraper] Fetching HTML from source website...`]);
      }, 800));
      timeouts.push(setTimeout(() => {
        setCrawlLogs((prev) => [...prev, `[Scraper] Cleaning HTML and extracting text contents...`]);
      }, 1600));
      timeouts.push(setTimeout(() => {
        setCrawlLogs((prev) => [...prev, `[LangChain] Parsing text into 1,000 character chunks...`]);
      }, 2400));
      timeouts.push(setTimeout(() => {
        setCrawlLogs((prev) => [...prev, `[Gemini] Generating 768-dim embeddings via gemini-embedding-001...`]);
      }, 3200));

      // Perform actual POST request to our API endpoint
      const response = await fetch('/api/ingest/crawl', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: crawlUrl,
          chatbotId: crawlBotId,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setCrawlLogs((prev) => [
          ...prev,
          `[Supabase] Ingestion complete. Ingested ${data.chunksCount} chunks into vector index.`,
          `[Success] Crawl finished successfully!`,
        ]);
        setCrawlResult({
          success: true,
          message: `Successfully crawled and ingested ${data.chunksCount} content chunks into document_chunks vector database.`,
        });
        setMetrics((prev) => ({
          ...prev,
          chunksCount: prev.chunksCount + data.chunksCount,
        }));
        setCrawlUrl('');
      } else {
        throw new Error(data.error || 'Crawling failed');
      }
    } catch (err: any) {
      timeouts.forEach(clearTimeout);
      console.warn('[Dashboard] Ingestion failed:', err.message || err);
      setCrawlLogs((prev) => [...prev, `[Error] Ingestion failed: ${err.message || err}`]);
      setCrawlResult({
        success: false,
        message: err.message || 'Scraper failed to parse URL or credentials invalid.',
      });
    } finally {
      setIsCrawling(false);
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
          { id: 'chatbots', label: 'Chatbots Manager', count: chatbots.length },
          { id: 'crawler', label: 'Crawl Console' },
          { id: 'conversations', label: 'Conversation Logs', count: conversations.length },
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
                <h3 className="text-lg font-bold text-white mb-4">Create New Chatbot</h3>
                <form onSubmit={handleCreateChatbot} className="space-y-4">
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
                  <button
                    type="submit"
                    disabled={isCreatingBot}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-2 px-5 rounded-xl shadow-lg shadow-indigo-500/10 transition-colors disabled:opacity-50"
                  >
                    {isCreatingBot ? 'Creating...' : 'Create Chatbot'}
                  </button>
                </form>
              </div>

              {/* Chatbots Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {chatbots.map((bot) => (
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
                      {chatbots.map((bot) => (
                        <option key={bot.id} value={bot.id}>
                          {bot.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">Website URL to Scrape</label>
                    <input
                      type="url"
                      placeholder="https://example.com/about"
                      value={crawlUrl}
                      onChange={(e) => setCrawlUrl(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white"
                      required
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
