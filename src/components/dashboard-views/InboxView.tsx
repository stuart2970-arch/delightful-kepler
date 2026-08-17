import React, { useState, useEffect } from 'react';
import { useDashboardStore, Message } from '../../lib/store';
import { createBrowserClient } from '@supabase/ssr';

export type ChannelFilterOption = 'all' | 'chat' | 'sms' | 'web_voice' | 'instagram' | 'whatsapp';

export default function InboxView() {
  const { tenantId, conversations, chatbots } = useDashboardStore();
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<Message[]>([]);
  const [isFetchingMessages, setIsFetchingMessages] = useState(false);
  const [convPage, setConvPage] = useState(0);
  const [channelFilter, setChannelFilter] = useState<ChannelFilterOption>('all');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = supabaseUrl && supabaseAnonKey ? createBrowserClient(supabaseUrl, supabaseAnonKey) : null;

  // Helper to categorize conversation channel
  const getConversationChannel = (conv: any): ChannelFilterOption => {
    const sessionId = (conv.user_session_id || '').toLowerCase();
    const channel = (conv.channel || '').toLowerCase();

    if (channel === 'whatsapp' || sessionId.startsWith('wa_') || sessionId.startsWith('whatsapp_')) {
      return 'whatsapp';
    }
    if (channel === 'instagram' || sessionId.startsWith('ig_') || sessionId.startsWith('insta_')) {
      return 'instagram';
    }
    if (channel === 'sms' || sessionId.startsWith('sms_') || sessionId.startsWith('twilio_')) {
      return 'sms';
    }
    if (conv.is_voice_call || channel === 'web_voice' || channel === 'voice' || sessionId.startsWith('voice_')) {
      return 'web_voice';
    }
    return 'chat';
  };

  // Helper for badge display with navigation-styled SVG line icons
  const renderChannelBadge = (conv: any) => {
    const channelType = getConversationChannel(conv);
    switch (channelType) {
      case 'whatsapp':
        return (
          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200/60 rounded-md font-semibold text-[10px] flex items-center gap-1">
            <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"/></svg>
            WhatsApp
          </span>
        );
      case 'instagram':
        return (
          <span className="px-2 py-0.5 bg-pink-50 text-pink-700 border border-pink-200/60 rounded-md font-semibold text-[10px] flex items-center gap-1">
            <svg className="w-3 h-3 text-pink-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            Instagram
          </span>
        );
      case 'sms':
        return (
          <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200/60 rounded-md font-semibold text-[10px] flex items-center gap-1">
            <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
            SMS
          </span>
        );
      case 'web_voice':
        return (
          <span className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200/60 rounded-md font-semibold text-[10px] flex items-center gap-1">
            <svg className="w-3 h-3 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 016 0v6a3 3 0 01-3 3z"/></svg>
            Web Voice
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200/60 rounded-md font-semibold text-[10px] flex items-center gap-1">
            <svg className="w-3 h-3 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
            Web Chat
          </span>
        );
    }
  };

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
        const response = await fetch(
          `/api/messages?conversationId=${encodeURIComponent(convoId)}&tenantId=${encodeURIComponent(tenantId)}`
        );
        if (response.ok) {
          const resData = await response.json();
          const sortedMessages = (resData.messages || []).sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          setConversationMessages(sortedMessages);
        } else {
          throw new Error(response.statusText);
        }
      } catch (err) {
        console.error('Failed to fetch messages via API:', err);
        if (supabase) {
          try {
            const { data } = await supabase
              .from('messages')
              .select('*')
              .eq('conversation_id', convoId)
              .eq('tenant_id', tenantId)
              .order('created_at', { ascending: true });

            if (data) {
              const sortedMessages = data.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
              setConversationMessages(sortedMessages);
            }
          } catch (clientErr) {
            console.error('Client-side messages fetch failed:', clientErr);
          }
        }
      }
      setIsFetchingMessages(false);
    }

    fetchMessages();
  }, [selectedConversation, supabase, tenantId]);

  const selectedConvObj = conversations.find(c => c.id === selectedConversation);

  // Filter conversations based on selected channel dropdown
  const webConversations = conversations.filter(c => !c.is_phone_call);

  const filteredConversations = webConversations.filter(conv => {
    if (channelFilter === 'all') return true;
    return getConversationChannel(conv) === channelFilter;
  });

  // Channel counts for metrics
  const chatCount = webConversations.filter(c => getConversationChannel(c) === 'chat').length;
  const smsCount = webConversations.filter(c => getConversationChannel(c) === 'sms').length;
  const webVoiceCount = webConversations.filter(c => getConversationChannel(c) === 'web_voice').length;
  const igCount = webConversations.filter(c => getConversationChannel(c) === 'instagram').length;
  const waCount = webConversations.filter(c => getConversationChannel(c) === 'whatsapp').length;

  return (
    <>
      <div className="space-y-6">
        <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl">
          <h3 className="text-lg font-bold text-[var(--awb-color8)] mb-1">Communications Index</h3>
          <p className="text-xs text-[var(--awb-color6)]">
            Explore and review all customer communications across Web Chat, Web Voice, SMS, WhatsApp, and Instagram DMs.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Conversation List Panel */}
          <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl h-[700px] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h3 className="text-base font-bold text-[var(--awb-color8)] truncate">Conversation Explorer</h3>

              {/* Compact Channel Filter Dropdown (Strictly Contained) */}
              <div className="flex items-center gap-1.5 shrink-0">
                <select
                  value={channelFilter}
                  onChange={(e) => {
                    setChannelFilter(e.target.value as ChannelFilterOption);
                    setConvPage(0);
                  }}
                  className="w-[130px] sm:w-[155px] bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#260475] focus:outline-none focus:border-[#198fd9] shadow-sm truncate cursor-pointer"
                >
                  <option value="all">All Comms ({webConversations.length})</option>
                  <option value="chat">Web Chat ({chatCount})</option>
                  <option value="sms">SMS ({smsCount})</option>
                  <option value="web_voice">Web Voice ({webVoiceCount})</option>
                  <option value="instagram">Instagram ({igCount})</option>
                  <option value="whatsapp">WhatsApp ({waCount})</option>
                </select>

                <div className="flex gap-1 shrink-0">
                  <button 
                    onClick={() => setConvPage(p => Math.max(0, p - 1))}
                    disabled={convPage === 0}
                    className="p-1 rounded bg-[var(--awb-color2)] text-[var(--awb-color8)] disabled:opacity-30 hover:bg-gray-200"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                  </button>
                  <button 
                    onClick={() => setConvPage(p => p + 1)}
                    disabled={(convPage + 1) * 10 >= filteredConversations.length}
                    className="p-1 rounded bg-[var(--awb-color2)] text-[var(--awb-color8)] disabled:opacity-30 hover:bg-gray-200"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 styleflo-scrollbar mb-4">
              {filteredConversations.length === 0 ? (
                <div className="text-center text-xs text-[var(--awb-color6)] py-16 px-4 space-y-3">
                  <p className="italic">No communications found for the selected channel filter.</p>
                </div>
              ) : (
                filteredConversations.slice(convPage * 10, (convPage + 1) * 10).map((conv) => {
                  const chatbotName = chatbots.find(b => b.id === conv.chatbot_id)?.name || 'AI Bot';
                  return (
                    <button
                      key={conv.id}
                      onClick={() => setSelectedConversation(conv.id)}
                      className={`w-full text-left p-3.5 rounded-xl border text-xs transition-all flex flex-col gap-2 ${
                        selectedConversation === conv.id
                          ? 'bg-blue-50/80 border-indigo-500 text-[var(--awb-color8)] shadow-md ring-1 ring-indigo-500/20'
                          : 'bg-white border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      <div className="flex justify-between items-center w-full">
                        <span className="font-bold text-gray-900">{chatbotName}</span>
                        <span className="text-[10px] text-gray-500 font-mono">
                          {new Date(conv.created_at).toLocaleDateString()} {new Date(conv.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-center w-full">
                        <div className="font-mono text-[10px] truncate text-gray-500 max-w-[170px]">
                          {conv.caller_phone_number || conv.user_session_id}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {renderChannelBadge(conv)}
                          {conv.resulted_in_booking && (
                            <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[9px] font-bold">📅 Booked</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Transcript / Audio Viewer Panel */}
          <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl h-[700px] flex flex-col overflow-hidden">
            <h4 className="text-base font-bold text-[var(--awb-color8)] mb-4">Transcript & Audio Viewer</h4>
            
            <div className="flex-1 overflow-y-auto p-4 bg-white border border-[#f2f3f5] rounded-xl space-y-4 styleflo-scrollbar">
              {isFetchingMessages ? (
                <div className="h-full flex items-center justify-center text-xs text-gray-500">
                  Loading transcript data...
                </div>
              ) : selectedConversation && selectedConvObj ? (
                <div className="space-y-4">
                  {/* Web Voice Audio Player */}
                  {selectedConvObj.recording_url && (
                    <div className="bg-indigo-50/50 border border-indigo-100 p-4 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <h5 className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 016 0v6a3 3 0 01-3 3z"/></svg>
                          Web Voice Recording
                        </h5>
                        <span className="text-[10px] text-indigo-600 font-mono">Audio Stream</span>
                      </div>
                      <audio controls src={selectedConvObj.recording_url} className="w-full h-10 mt-1" />
                    </div>
                  )}

                  {/* Transcribed Text Block */}
                  {selectedConvObj.transcript && (
                    <div className="bg-gray-50 border border-gray-200 p-4 rounded-xl space-y-2">
                      <h5 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                        <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        Transcribed Speech Text
                      </h5>
                      <div className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed font-sans bg-white p-3 rounded-lg border border-gray-100">
                        {selectedConvObj.transcript}
                      </div>
                    </div>
                  )}

                  {/* Turn-by-Turn Chat / Voice Messages */}
                  {conversationMessages.length > 0 ? (
                    <div className="space-y-3 pt-2 border-t border-gray-100">
                      <h5 className="text-xs font-bold text-gray-700 mb-2">Turn-by-Turn Log</h5>
                      {conversationMessages.map((msg, i) => (
                        <div key={msg.id || i} className={`flex ${msg.sender_type === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`p-3.5 rounded-xl text-xs max-w-[85%] leading-relaxed whitespace-pre-wrap shadow-sm ${
                            msg.sender_type === 'user'
                              ? 'bg-[#198fd9] text-white font-semibold rounded-tr-none'
                              : 'bg-gray-100 text-gray-800 rounded-tl-none border border-gray-200'
                          }`}>
                            {msg.text_content}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : !selectedConvObj.transcript && !selectedConvObj.recording_url && (
                    <div className="h-full flex items-center justify-center text-xs text-gray-400 italic">
                      Empty session log.
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-gray-400 text-center italic">
                  Select any conversation session from the left explorer to view transcripts and audio recordings.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
