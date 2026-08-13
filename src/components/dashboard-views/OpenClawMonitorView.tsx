import React, { useState, useEffect, useMemo } from 'react';

// Mock types representing OpenClaw Node metrics and logs
interface ChannelConnection {
  id: string;
  name: 'WhatsApp' | 'Instagram' | 'Telegram' | 'Slack' | 'SMS (Twilio)';
  type: string;
  status: 'connected' | 'reconnecting' | 'disconnected';
  activeTenants: number;
  uptime: string;
  lastMessageAt: string;
}

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  channel: string;
  message: string;
}

export default function OpenClawMonitorView() {
  // Connection states
  const [nodeStatus, setNodeStatus] = useState<'healthy' | 'degraded' | 'offline'>('healthy');
  const [latency, setLatency] = useState<number>(42);
  const [channels, setChannels] = useState<ChannelConnection[]>([
    { id: '1', name: 'WhatsApp', type: 'Baileys/WebProvider', status: 'connected', activeTenants: 12, uptime: '14d 6h', lastMessageAt: 'Just now' },
    { id: '2', name: 'Instagram', type: 'MessengerAPI', status: 'connected', activeTenants: 8, uptime: '14d 6h', lastMessageAt: '2m ago' },
    { id: '3', name: 'Telegram', type: 'Telegraf/BotAPI', status: 'connected', activeTenants: 5, uptime: '30d 12h', lastMessageAt: '12m ago' },
    { id: '4', name: 'SMS (Twilio)', type: 'TwilioRest', status: 'connected', activeTenants: 15, uptime: '45d 1h', lastMessageAt: '1m ago' },
    { id: '5', name: 'Slack', type: 'SlackBolt', status: 'reconnecting', activeTenants: 2, uptime: '0h 15m', lastMessageAt: '1h ago' }
  ]);

  // Log filter states
  const [logSearch, setLogSearch] = useState('');
  const [logLevelFilter, setLogLevelFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');

  // Real-time log buffer (initial historical logs)
  const [logs, setLogs] = useState<LogEntry[]>([
    { timestamp: '10:42:01', level: 'info', channel: 'SYSTEM', message: 'OpenClaw Gateway core v1.8.2 launched successfully.' },
    { timestamp: '10:42:03', level: 'info', channel: 'WHATSAPP', message: 'Paired Baileys session for tenant [tenant_019a_crew] authenticated.' },
    { timestamp: '10:43:15', level: 'info', channel: 'INSTAGRAM', message: 'Inbound Story Mention webhook received from [insta_user_398]. Forwarding to StyleFlo Next.js router.' },
    { timestamp: '10:43:16', level: 'info', channel: 'SYSTEM', message: 'StyleFlo backend API answered 200 OK (latency: 184ms) for [insta_user_398].' },
    { timestamp: '10:44:00', level: 'warn', channel: 'SLACK', message: 'Slack Bolt connection closed by remote host. Attempting exponential backoff reconnection...' },
    { timestamp: '10:44:12', level: 'info', channel: 'TWILIO_SMS', message: 'Dispatched outbound booking reminder via SMS to +44 7700 900077.' },
    { timestamp: '10:45:02', level: 'error', channel: 'SYSTEM', message: 'StyleFlo webhook returned 502 Bad Gateway for [wa_sender_781]. Retrying payload...' }
  ]);

  // Simulate real-time data streams (latency, logs, node health toggles)
  useEffect(() => {
    const interval = setInterval(() => {
      // 1. Jitter latency slightly
      setLatency(prev => {
        const jitter = Math.floor(Math.random() * 9) - 4; // -4 to +4
        const next = prev + jitter;
        return next < 15 ? 15 : next > 200 ? 200 : next;
      });

      // 2. Randomly append new real-time log entries simulating live salon bookings
      const channelsList = ['WHATSAPP', 'INSTAGRAM', 'TWILIO_SMS', 'SYSTEM', 'TELEGRAM'];
      const randomChannel = channelsList[Math.floor(Math.random() * channelsList.length)];
      const messages = {
        WHATSAPP: [
          'Received text "Do you have any availability for a haircut today?" from +447911123456.',
          'Successfully routed client booking selection to Booksy api wrapper.',
          'RAG context matching completed. Matched 3 segments with cosine similarity > 0.81.'
        ],
        INSTAGRAM: [
          'Direct Message received from [ig_beauty_lover]: "What are your weekend hours?".',
          'Automated Quick Reply clicked: "Book Appointment". Sending portal link.'
        ],
        TWILIO_SMS: [
          'Delivered SMS shift change confirmation to stylist user_id: [stylist_9821].',
          'Inbound SMS "Cancel my 3pm" detected. Escalating to tenant owner dashboard.'
        ],
        SYSTEM: [
          'Config file ~/.openclaw/openclaw.json parsed without errors.',
          'Token refreshed for WhatsApp session tenant_0921_rosser.'
        ],
        TELEGRAM: [
          'Group mention detected in channel [barbers_chat]. Ignoring based on allowFrom rules.'
        ]
      };

      const selectedMessages = messages[randomChannel as keyof typeof messages];
      const randomMsgText = selectedMessages[Math.floor(Math.random() * selectedMessages.length)];
      const now = new Date();
      const timestampStr = now.toTimeString().split(' ')[0];

      setLogs(prev => [
        {
          timestamp: timestampStr,
          level: Math.random() > 0.9 ? 'warn' : Math.random() > 0.97 ? 'error' : 'info',
          channel: randomChannel,
          message: randomMsgText
        },
        ...prev.slice(0, 99) // Keep last 100 entries max to prevent DOM bloat
      ]);
    }, 4500);

    return () => clearInterval(interval);
  }, []);

  // Filter logs dynamically
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesSearch = log.message.toLowerCase().includes(logSearch.toLowerCase()) || 
                            log.channel.toLowerCase().includes(logSearch.toLowerCase());
      const matchesLevel = logLevelFilter === 'all' || log.level === logLevelFilter;
      return matchesSearch && matchesLevel;
    });
  }, [logs, logSearch, logLevelFilter]);

  // Modal state for channel configuration
  const [activeConfigModal, setActiveConfigModal] = useState<ChannelConnection | null>(null);
  const [activePhoneOrHandle, setActivePhoneOrHandle] = useState<string>('+44 7700 900077');
  const [activeWebhookUrl, setActiveWebhookUrl] = useState<string>('https://overcrowd-alkaline-obsolete.ngrok-free.dev/api/openclaw/webhook');
  const [isSavingChannelConfig, setIsSavingChannelConfig] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 font-sans rounded-2xl">
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-800 pb-6 mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                nodeStatus === 'healthy' ? 'bg-emerald-400' : nodeStatus === 'degraded' ? 'bg-amber-400' : 'bg-rose-400'
              }`}></span>
              <span className={`relative inline-flex rounded-full h-3 w-3 ${
                nodeStatus === 'healthy' ? 'bg-emerald-500' : nodeStatus === 'degraded' ? 'bg-amber-500' : 'bg-rose-500'
              }`}></span>
            </span>
            <h1 className="text-2xl font-bold tracking-tight">OpenClaw Gateway Monitor</h1>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-950 text-indigo-400 border border-indigo-800">
              v1.8.2 Stable
            </span>
          </div>
          <p className="text-slate-400 text-sm mt-1">
            Real-time monitoring of self-hosted communication nodes, RAG routers, and API callbacks for StyleFlo.
          </p>
        </div>
        
        {/* Connection Control Info */}
        <div className="flex gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-center min-w-[120px]">
            <span className="text-xs text-slate-400 block uppercase font-bold tracking-wider">Gateway Latency</span>
            <span className={`text-xl font-mono font-bold ${
              latency < 60 ? 'text-emerald-400' : latency < 120 ? 'text-amber-400' : 'text-rose-400'
            }`}>
              {latency} ms
            </span>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-center min-w-[120px]">
            <span className="text-xs text-slate-400 block uppercase font-bold tracking-wider">Active Channels</span>
            <span className="text-xl font-bold text-indigo-400">
              {channels.filter(c => c.status === 'connected').length} / {channels.length}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* COLUMN 1 & 2: CHANNEL GRID */}
        <div className="lg:col-span-2 space-y-8">
          <div>
            <h2 className="text-lg font-bold text-slate-300 mb-4 flex items-center gap-2">
              🔌 Active Channel Plugins
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {channels.map((channel) => (
                <div 
                  key={channel.id} 
                  className={`p-5 rounded-xl border bg-slate-900/60 backdrop-blur-sm transition duration-200 hover:border-slate-700 ${
                    channel.status === 'connected' 
                      ? 'border-slate-800/80' 
                      : channel.status === 'reconnecting' 
                      ? 'border-amber-900/50 bg-amber-950/5' 
                      : 'border-rose-950/50 bg-rose-950/5'
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-lg text-white">{channel.name}</h3>
                      <span className="text-xs text-slate-400 font-mono block">{channel.type}</span>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                      channel.status === 'connected' 
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/50' 
                        : channel.status === 'reconnecting' 
                        ? 'bg-amber-950 text-amber-400 border border-amber-800/50 animate-pulse' 
                        : 'bg-rose-950 text-rose-400 border border-rose-800/50'
                    }`}>
                      {channel.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm pt-3 border-t border-slate-800/60">
                    <div>
                      <span className="text-slate-400 text-xs block">Active Tenants</span>
                      <span className="font-semibold text-slate-200">{channel.activeTenants} salons</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-xs block">Channel Uptime</span>
                      <span className="font-semibold text-slate-200">{channel.uptime}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex justify-between items-center text-xs text-slate-400">
                    <span>Last message: <strong className="text-slate-300">{channel.lastMessageAt}</strong></span>
                    <button 
                      type="button"
                      onClick={() => {
                        setActiveConfigModal(channel);
                        if (channel.name === 'Instagram') {
                          setActivePhoneOrHandle('@styleflosalon');
                        } else if (channel.name === 'Telegram') {
                          setActivePhoneOrHandle('@StyleFloBot');
                        } else {
                          setActivePhoneOrHandle('+44 7700 900077');
                        }
                      }}
                      className="text-indigo-400 hover:text-indigo-300 font-medium hover:underline transition cursor-pointer"
                    >
                      Configure Settings →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RAG ROUTING INFORMATION */}
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6">
            <h3 className="text-lg font-bold text-slate-300 mb-2 flex items-center gap-2">
              🧠 Inbound Webhook Forwarding Ratios
            </h3>
            <p className="text-sm text-slate-400 mb-4">
              Shows the destination mapping layout. Messages arriving at OpenClaw are formatted as clean JSON and payloaded to:
            </p>
            <div className="bg-slate-950/80 rounded-lg p-4 font-mono text-xs border border-slate-800 text-slate-300 space-y-2">
              <div><span className="text-indigo-400">POST</span> https://app.styleflo.ai/api/openclaw/webhook?chatbotId=<span className="text-emerald-400">:chatbot_id</span></div>
              <div className="text-slate-500 pl-4">Headers: {'{'} "Authorization": "Bearer openclaw_secret_jwt", "Content-Type": "application/json" {'}'}</div>
            </div>
          </div>
        </div>

        {/* COLUMN 3: REAL-TIME CONSOLE LOGS */}
        <div className="lg:col-span-1 flex flex-col h-[650px] bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
          {/* Console Header */}
          <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
              <h2 className="font-bold text-sm tracking-wide text-slate-300 uppercase">Live Gateway Logs</h2>
            </div>
            <button 
              onClick={() => setLogs([])}
              className="text-xs text-slate-400 hover:text-white transition hover:underline"
            >
              Clear Buffer
            </button>
          </div>

          {/* Filter Bar */}
          <div className="p-3 bg-slate-950 border-b border-slate-800/80 space-y-2.5">
            <input 
              type="text" 
              placeholder="Search message or channel..." 
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
            
            <div className="flex justify-between items-center gap-1.5">
              {(['all', 'info', 'warn', 'error'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => setLogLevelFilter(level)}
                  className={`flex-1 text-center py-1 rounded text-[10px] font-bold uppercase tracking-wider transition ${
                    logLevelFilter === level 
                      ? level === 'info' ? 'bg-indigo-900/60 text-indigo-300 border border-indigo-700/50'
                        : level === 'warn' ? 'bg-amber-950/60 text-amber-300 border border-amber-700/50'
                        : level === 'error' ? 'bg-rose-950/60 text-rose-300 border border-rose-700/50'
                        : 'bg-slate-800 text-white border border-slate-700'
                      : 'bg-slate-900 text-slate-400 hover:bg-slate-800/60'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Scrolling Terminal area */}
          <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-3 bg-slate-950 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
            {filteredLogs.length === 0 ? (
              <div className="text-center text-slate-600 py-10 italic">
                No matching logs found in buffer.
              </div>
            ) : (
              filteredLogs.map((log, idx) => (
                <div key={idx} className="leading-relaxed border-b border-slate-900/40 pb-2">
                  <div className="flex justify-between items-center text-slate-500 mb-0.5">
                    <span>[{log.timestamp}]</span>
                    <span className={`px-1 rounded font-bold text-[9px] ${
                      log.level === 'info' ? 'text-indigo-400 bg-indigo-950/60' : 
                      log.level === 'warn' ? 'text-amber-400 bg-amber-950/60' : 
                      'text-rose-400 bg-rose-950/60'
                    }`}>
                      {log.channel}
                    </span>
                  </div>
                  <p className={`whitespace-pre-wrap ${
                    log.level === 'info' ? 'text-slate-300' : 
                    log.level === 'warn' ? 'text-amber-200' : 
                    'text-rose-300 font-semibold'
                  }`}>
                    {log.message}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* CHANNEL CONFIGURATION MODAL */}
      {activeConfigModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-5 text-slate-100 relative">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-950 border border-indigo-800/60 flex items-center justify-center text-indigo-400 font-bold text-lg">
                  ⚡
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    {activeConfigModal.name} Channel Configuration
                  </h3>
                  <p className="text-xs text-slate-400 font-mono">{activeConfigModal.type}</p>
                </div>
              </div>
              <button 
                onClick={() => setActiveConfigModal(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">
                    {activeConfigModal.name === 'Instagram' ? 'Instagram Business Handle' : activeConfigModal.name === 'Telegram' ? 'Telegram Bot Username' : 'Connected Phone Number'}
                  </label>
                  <input
                    type="text"
                    value={activePhoneOrHandle}
                    onChange={(e) => setActivePhoneOrHandle(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                    placeholder="e.g. +44 7700 900077"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">StyleFlo RAG Webhook Callback URL</label>
                  <input
                    type="text"
                    value={activeWebhookUrl}
                    onChange={(e) => setActiveWebhookUrl(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Auth Secret Bearer Token</label>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-[11px] text-emerald-400 flex justify-between items-center">
                    <span>openclaw_secret_bearer_key_to_styleflo_api</span>
                    <span className="text-[10px] text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">Verified</span>
                  </div>
                </div>
              </div>

              <div className="bg-indigo-950/40 border border-indigo-900/50 p-3.5 rounded-xl space-y-1 text-slate-300">
                <p className="font-bold text-indigo-300 flex items-center gap-1.5">
                  🤖 OpenClaw Gateway Routing Mode
                </p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Incoming messages received on this channel are automatically processed by Gemini 2.5 Flash with live vector context from your StyleFlo Knowledge Base.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setActiveConfigModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSavingChannelConfig(true);
                  setTimeout(() => {
                    setIsSavingChannelConfig(false);
                    setActiveConfigModal(null);
                    alert(`${activeConfigModal.name} configuration updated successfully!`);
                  }, 600);
                }}
                disabled={isSavingChannelConfig}
                className="px-5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 transition disabled:opacity-50"
              >
                {isSavingChannelConfig ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
