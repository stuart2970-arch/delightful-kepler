import React, { useState, useEffect } from 'react';
import { useDashboardStore, Message } from '../../lib/store';
import { createBrowserClient } from '@supabase/ssr';

export default function InboxView() {
  const { tenantId, conversations, chatbots } = useDashboardStore();
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<Message[]>([]);
  const [isFetchingMessages, setIsFetchingMessages] = useState(false);
  const [convPage, setConvPage] = useState(0);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = supabaseUrl && supabaseAnonKey ? createBrowserClient(supabaseUrl, supabaseAnonKey) : null;

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
          const sortedMessages = (resData.messages || []).sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          setConversationMessages(sortedMessages);
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
              const sortedMessages = data.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
              setConversationMessages(sortedMessages);
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

  return (
    <>
            <div className="space-y-6">
              <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl">
                <h3 className="text-lg font-bold text-white mb-2">Conversation Session Index</h3>
                <p className="text-xs text-gray-400">Select any chat session from the explorer panel to browse user transcripts.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl h-[700px] flex flex-col">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-base font-bold text-white">Conversation Explorer</h3>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setConvPage(p => Math.max(0, p - 1))}
                        disabled={convPage === 0}
                        className="p-1 rounded bg-gray-800 disabled:opacity-30 hover:bg-gray-700 text-white"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                      </button>
                      <button 
                        onClick={() => setConvPage(p => p + 1)}
                        disabled={(convPage + 1) * 10 >= conversations.length}
                        className="p-1 rounded bg-gray-800 disabled:opacity-30 hover:bg-gray-700 text-white"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 styleflo-scrollbar mb-4">
                    {conversations.length === 0 ? (
                      <div className="text-center text-xs text-gray-500 py-10">No sessions logged yet.</div>
                    ) : (
                      conversations.slice(convPage * 10, (convPage + 1) * 10).map((conv) => {
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
                </div>

                <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl h-[700px] flex flex-col">
                  <h4 className="text-base font-bold text-white mb-4">Transcript Viewer</h4>
                  <div className="flex-1 overflow-y-auto p-4 bg-gray-950 border border-gray-950 rounded-xl space-y-4 styleflo-scrollbar">
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
                            <div className={`p-4 rounded-xl text-sm max-w-[90%] leading-relaxed whitespace-pre-wrap shadow-sm ${
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
                        Select a session from the explorer to view chat transcripts.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
    </>
  );
}
