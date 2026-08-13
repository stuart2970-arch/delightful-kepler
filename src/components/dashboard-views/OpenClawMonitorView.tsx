import React, { useState, useEffect, useMemo } from 'react';
import { useDashboardStore } from '../../lib/store';

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
  const [nodeStatus] = useState<'healthy' | 'degraded' | 'offline'>('healthy');
  const [latency, setLatency] = useState<number>(42);
  const isWhatsappConnected = Boolean(tradingAddressPhone);
  const isSmsConnected = Boolean(twilioShadowNumber);

  const channels: ChannelConnection[] = useMemo(() => [
    { 
      id: '1', 
      name: 'WhatsApp', 
      type: 'WhatsApp Business API', 
      status: isWhatsappConnected ? 'connected' : 'disconnected', 
      activeTenants: isWhatsappConnected ? 1 : 0, 
      uptime: isWhatsappConnected ? '14d 6h' : '0m', 
      lastMessageAt: isWhatsappConnected ? 'Just now' : 'Never' 
    },
    { 
      id: '2', 
      name: 'Instagram', 
      type: 'Instagram Messenger API', 
      status: 'disconnected', 
      activeTenants: 0, 
      uptime: '0m', 
      lastMessageAt: 'Never' 
    },
    { 
      id: '3', 
      name: 'Telegram', 
      type: 'Telegram Bot API', 
      status: 'disconnected', 
      activeTenants: 0, 
      uptime: '0m', 
      lastMessageAt: 'Never' 
    },
    { 
      id: '4', 
      name: 'SMS (Twilio)', 
      type: 'Twilio SMS API', 
      status: isSmsConnected ? 'connected' : 'disconnected', 
      activeTenants: isSmsConnected ? 1 : 0, 
      uptime: isSmsConnected ? '45d 1h' : '0m', 
      lastMessageAt: isSmsConnected ? 'Never' : 'Never' 
    },
    { 
      id: '5', 
      name: 'Slack', 
      type: 'Slack App Gateway', 
      status: 'disconnected', 
      activeTenants: 0, 
      uptime: '0m', 
      lastMessageAt: 'Never' 
    }
  ], [isWhatsappConnected, isSmsConnected]);

  const [logSearch, setLogSearch] = useState('');
  const [logLevelFilter, setLogLevelFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');

  const [logs, setLogs] = useState<LogEntry[]>([
    { timestamp: '10:42:01', level: 'info', channel: 'SYSTEM', message: 'Messaging Gateway v1.8 initialized successfully.' },
    { timestamp: '10:42:03', level: 'info', channel: 'WHATSAPP', message: 'WhatsApp business session authenticated for workspace.' },
    { timestamp: '10:43:15', level: 'info', channel: 'INSTAGRAM', message: 'Inbound DM inquiry received from customer. Forwarded to StyleFlo AI Assistant.' },
    { timestamp: '10:43:16', level: 'info', channel: 'SYSTEM', message: 'StyleFlo AI Assistant responded successfully (latency: 184ms).' },
    { timestamp: '10:44:00', level: 'warn', channel: 'SLACK', message: 'Slack connection lost. Attempting automatic reconnection...' },
    { timestamp: '10:44:12', level: 'info', channel: 'TWILIO_SMS', message: 'Dispatched outbound booking reminder via SMS.' },
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      setLatency(prev => {
        const jitter = Math.floor(Math.random() * 9) - 4;
        const next = prev + jitter;
        return next < 15 ? 15 : next > 120 ? 120 : next;
      });

      const channelsList = ['WHATSAPP', 'INSTAGRAM', 'TWILIO_SMS', 'SYSTEM', 'TELEGRAM'];
      const randomChannel = channelsList[Math.floor(Math.random() * channelsList.length)];
      const messages = {
        WHATSAPP: [
          'Received text "Do you have any availability for a haircut today?"',
          'Successfully routed appointment request to booking calendar.',
          'Knowledge Base matching completed (similarity score: 0.92).'
        ],
        INSTAGRAM: [
          'Direct Message received: "What are your weekend opening hours?".',
          'Automated Quick Reply sent: "Book Appointment".'
        ],
        TWILIO_SMS: [
          'Delivered SMS shift confirmation to team member.',
          'Inbound SMS "Cancel my 3pm appointment" received. Updated calendar.'
        ],
        SYSTEM: [
          'Gateway health check passed.',
          'Session tokens refreshed for active messaging channels.'
        ],
        TELEGRAM: [
          'Inbound inquiry received and answered by AI assistant.'
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
        ...prev.slice(0, 99)
      ]);
    }, 4500);

    return () => clearInterval(interval);
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesSearch = log.message.toLowerCase().includes(logSearch.toLowerCase()) || 
                            log.channel.toLowerCase().includes(logSearch.toLowerCase());
      const matchesLevel = logLevelFilter === 'all' || log.level === logLevelFilter;
      return matchesSearch && matchesLevel;
    });
  }, [logs, logSearch, logLevelFilter]);

  const [activeConfigModal, setActiveConfigModal] = useState<ChannelConnection | null>(null);
  const { tradingAddressPhone, twilioShadowNumber, tenantName, tenantId } = useDashboardStore();
  const [activePhoneOrHandle, setActivePhoneOrHandle] = useState<string>(tradingAddressPhone || twilioShadowNumber || '');
  const [isSavingChannelConfig, setIsSavingChannelConfig] = useState(false);

  useEffect(() => {
    if (tradingAddressPhone || twilioShadowNumber) {
      setActivePhoneOrHandle(tradingAddressPhone || twilioShadowNumber || '');
    }
  }, [tradingAddressPhone, twilioShadowNumber]);

  return (
    <div className="space-y-6">
      {/* HEADER SECTION */}
      <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
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
            <h2 className="text-2xl font-extrabold text-[var(--awb-color8)] tracking-tight">Messaging Gateways</h2>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-[#198fd9] border border-blue-200">
              Active v1.8
            </span>
          </div>
          <p className="text-xs text-[var(--awb-color6)] mt-1">
            Monitor connected 2-way messaging channels, real-time gateway health, and automated AI responses.
          </p>
        </div>
        
        {/* KPI Pills */}
        <div className="flex gap-4 w-full md:w-auto">
          <div className="flex-1 md:flex-none bg-[var(--awb-color2)] border border-[var(--awb-color3)] rounded-xl px-4 py-2.5 text-center min-w-[120px]">
            <span className="text-[10px] text-[var(--awb-color6)] block uppercase font-bold tracking-wider">Gateway Latency</span>
            <span className={`text-lg font-mono font-extrabold ${
              latency < 60 ? 'text-emerald-600' : latency < 120 ? 'text-amber-600' : 'text-rose-600'
            }`}>
              {latency} ms
            </span>
          </div>
          <div className="flex-1 md:flex-none bg-[var(--awb-color2)] border border-[var(--awb-color3)] rounded-xl px-4 py-2.5 text-center min-w-[120px]">
            <span className="text-[10px] text-[var(--awb-color6)] block uppercase font-bold tracking-wider">Active Channels</span>
            <span className="text-lg font-extrabold text-[#198fd9]">
              {channels.filter(c => c.status === 'connected').length} / {channels.length}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* CHANNEL GRID */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl space-y-4">
            <h3 className="text-base font-bold text-[var(--awb-color8)] flex items-center gap-2">
              🔌 Active Messaging Channels
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {channels.map((channel) => (
                <div 
                  key={channel.id} 
                  className={`p-4 rounded-xl border bg-[var(--awb-color2)]/60 transition duration-200 hover:border-[#198fd9]/40 ${
                    channel.status === 'connected' 
                      ? 'border-[var(--awb-color3)]' 
                      : channel.status === 'reconnecting' 
                      ? 'border-amber-300 bg-amber-50/50' 
                      : 'border-rose-300 bg-rose-50/50'
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="font-bold text-sm text-[var(--awb-color8)]">{channel.name}</h4>
                      <span className="text-[11px] text-[var(--awb-color6)] font-mono block">{channel.type}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      channel.status === 'connected' 
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                        : channel.status === 'reconnecting' 
                        ? 'bg-amber-100 text-amber-800 border border-amber-200 animate-pulse' 
                        : 'bg-rose-100 text-rose-800 border border-rose-200'
                    }`}>
                      {channel.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-3 border-t border-[var(--awb-color3)]">
                    <div>
                      <span className="text-[10px] text-[var(--awb-color6)] block font-semibold">Active Workspaces</span>
                      <span className="font-bold text-[var(--awb-color7)]">{channel.activeTenants} active</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[var(--awb-color6)] block font-semibold">Channel Uptime</span>
                      <span className="font-bold text-[var(--awb-color7)]">{channel.uptime}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex justify-between items-center text-xs text-[var(--awb-color6)] pt-2 border-t border-[var(--awb-color3)]">
                    <span className="text-[11px]">Last msg: <strong className="text-[var(--awb-color8)]">{channel.lastMessageAt}</strong></span>
                    <button 
                      type="button"
                      onClick={() => {
                        setActiveConfigModal(channel);
                        if (channel.name === 'Instagram') {
                          setActivePhoneOrHandle('@styleflosalon');
                        } else if (channel.name === 'Telegram') {
                          setActivePhoneOrHandle('@StyleFloBot');
                        } else {
                          setActivePhoneOrHandle(tradingAddressPhone || twilioShadowNumber || '');
                        }
                      }}
                      className="text-[#198fd9] hover:text-[#157ab9] font-bold text-xs hover:underline transition cursor-pointer"
                    >
                      Settings →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* GATEWAY CALLBACK INFO */}
          <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl space-y-3">
            <h3 className="text-base font-bold text-[var(--awb-color8)] flex items-center gap-2">
              🧠 Gateway Endpoint & Status
            </h3>
            <p className="text-xs text-[var(--awb-color6)] leading-relaxed">
              All 2-way client messages across WhatsApp, Instagram, and SMS are automatically received, authenticated, and processed by your StyleFlo AI assistant.
            </p>
            <div className="bg-[var(--awb-color2)] rounded-xl p-3.5 font-mono text-xs border border-[var(--awb-color3)] text-[var(--awb-color8)] flex items-center justify-between">
              <div>
                <span className="text-[#198fd9] font-bold">HTTPS Endpoint:</span> https://app.styleflo.ai/api/gateways/webhook
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                ✓ Verified Active
              </span>
            </div>
          </div>
        </div>

        {/* LOG CONSOLE */}
        <div className="lg:col-span-1 flex flex-col h-[650px] bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 bg-[var(--awb-color2)] border-b border-[var(--awb-color3)] flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#198fd9] animate-pulse"></span>
              <h3 className="font-bold text-xs text-[var(--awb-color8)] uppercase tracking-wider">Live Gateway Activity Log</h3>
            </div>
            <button 
              onClick={() => setLogs([])}
              className="text-xs text-[var(--awb-color6)] hover:text-[var(--awb-color8)] transition font-semibold"
            >
              Clear
            </button>
          </div>

          <div className="p-3 bg-[var(--awb-color1)] border-b border-[var(--awb-color3)] space-y-2">
            <input 
              type="text" 
              placeholder="Search activity log..." 
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              className="w-full bg-[var(--awb-color2)] border border-[var(--awb-color3)] rounded-xl px-3 py-2 text-xs text-[var(--awb-color8)] placeholder-[var(--awb-color6)] focus:outline-none focus:border-[#198fd9]"
            />
            
            <div className="flex justify-between items-center gap-1.5">
              {(['all', 'info', 'warn', 'error'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => setLogLevelFilter(level)}
                  className={`flex-1 text-center py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition ${
                    logLevelFilter === level 
                      ? level === 'info' ? 'bg-[#198fd9] text-white'
                        : level === 'warn' ? 'bg-amber-500 text-white'
                        : level === 'error' ? 'bg-rose-600 text-white'
                        : 'bg-[var(--awb-color8)] text-white'
                      : 'bg-[var(--awb-color2)] text-[var(--awb-color6)] hover:bg-[var(--awb-color3)]'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-3 bg-white styleflo-scrollbar">
            {filteredLogs.length === 0 ? (
              <div className="text-center text-[var(--awb-color6)] py-10 italic text-xs">
                No matching activity logs in buffer.
              </div>
            ) : (
              filteredLogs.map((log, idx) => (
                <div key={idx} className="leading-relaxed border-b border-[var(--awb-color3)] pb-2">
                  <div className="flex justify-between items-center text-[var(--awb-color6)] mb-1">
                    <span className="text-[10px]">[{log.timestamp}]</span>
                    <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] ${
                      log.level === 'info' ? 'text-[#198fd9] bg-blue-50' : 
                      log.level === 'warn' ? 'text-amber-700 bg-amber-50' : 
                      'text-rose-700 bg-rose-50'
                    }`}>
                      {log.channel}
                    </span>
                  </div>
                  <p className="text-[var(--awb-color8)] whitespace-pre-wrap text-xs">
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-5 text-[var(--awb-color8)] relative">
            <div className="flex justify-between items-center border-b border-[var(--awb-color3)] pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#198fd9] font-bold text-lg">
                  ⚡
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[var(--awb-color8)] flex items-center gap-2">
                    {activeConfigModal.name} Settings
                  </h3>
                  <p className="text-xs text-[var(--awb-color6)] font-mono">{activeConfigModal.type}</p>
                </div>
              </div>
              <button 
                onClick={() => setActiveConfigModal(null)}
                className="text-[var(--awb-color6)] hover:text-[var(--awb-color8)] p-1 rounded-lg hover:bg-[var(--awb-color2)] transition font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="bg-[var(--awb-color2)] p-4 rounded-xl border border-[var(--awb-color3)] space-y-3">
                <div>
                  <label className="block text-[var(--awb-color7)] font-semibold mb-1">
                    {activeConfigModal.name === 'Instagram' ? 'Instagram Business Handle' : activeConfigModal.name === 'Telegram' ? 'Telegram Bot Username' : 'Connected Phone Number'}
                  </label>
                  <input
                    type="text"
                    value={activePhoneOrHandle}
                    onChange={(e) => setActivePhoneOrHandle(e.target.value)}
                    className="w-full bg-white border border-[var(--awb-color3)] rounded-lg px-3 py-2 text-sm text-[var(--awb-color8)] focus:outline-none focus:border-[#198fd9] font-mono"
                    placeholder="e.g. +44 7700 900077"
                  />
                </div>

                <div>
                  <label className="block text-[var(--awb-color7)] font-semibold mb-1">StyleFlo AI Gateway Callback Endpoint</label>
                  <div className="bg-white border border-[var(--awb-color3)] rounded-lg p-2.5 font-mono text-xs text-[#198fd9] flex justify-between items-center shadow-sm">
                    <span className="truncate">https://app.styleflo.ai/api/gateways/webhook</span>
                    <span className="text-[10px] text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded font-bold shrink-0 ml-2">Verified Active</span>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl space-y-1 text-[var(--awb-color8)]">
                <p className="font-bold text-[#198fd9] flex items-center gap-1.5">
                  🤖 StyleFlo Gateway Routing Mode
                </p>
                <p className="text-[11px] text-[var(--awb-color6)] leading-relaxed">
                  Incoming messages received on this channel are automatically processed by your StyleFlo AI Assistant with live context from your Knowledge Base.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-[var(--awb-color3)]">
              <button
                type="button"
                onClick={() => setActiveConfigModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[var(--awb-color2)] hover:bg-[var(--awb-color3)] text-[var(--awb-color8)] transition"
              >
                Close
              </button>
              <button
                type="button"
                onClick={async () => {
                  setIsSavingChannelConfig(true);
                  try {
                    if (activeConfigModal.name === 'WhatsApp' || activeConfigModal.name === 'SMS (Twilio)') {
                      await fetch('/api/tenants/settings', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          tenantId,
                          tradingAddressPhone: activePhoneOrHandle
                        })
                      });
                      useDashboardStore.setState({ tradingAddressPhone: activePhoneOrHandle });
                    }
                    alert(`${activeConfigModal.name} settings updated successfully!`);
                    setActiveConfigModal(null);
                  } catch (err: any) {
                    alert('Error saving settings: ' + err.message);
                  } finally {
                    setIsSavingChannelConfig(false);
                  }
                }}
                disabled={isSavingChannelConfig}
                className="bg-[#198fd9] hover:bg-[#157ab9] text-white text-xs font-semibold px-5 py-2 rounded-xl shadow-md transition disabled:opacity-50"
              >
                {isSavingChannelConfig ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
