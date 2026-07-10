import React, { useState, useRef } from 'react';
import { useDashboardStore, Chatbot } from '../../lib/store';
import { createBrowserClient } from '@supabase/ssr';

const VOICE_PERSONAS = [
  // Female
  { id: 'vapi-f-1', name: 'Polished, articulate, professional', role: 'Corporate, executive presentations, news', gender: 'Female', previewUrl: '/audio/f1.mp3' },
  { id: 'vapi-f-2', name: 'Crisp, authoritative, clear', role: 'Instructions, tutorials, technical support', gender: 'Female', previewUrl: '/audio/f2.mp3' },
  { id: 'vapi-f-3', name: 'Energetic, bright, youthful', role: 'Fitness apps, entertainment, casual chat', gender: 'Female', previewUrl: '/audio/f3.mp3' },
  { id: 'vapi-f-4', name: 'Smooth, calming, melodic', role: 'Meditation, sleep aid, luxury branding', gender: 'Female', previewUrl: '/audio/f4.mp3' },
  { id: 'vapi-f-5', name: 'Friendly, peer-like, natural', role: 'Conversational assistant, daily logging', gender: 'Female', previewUrl: '/audio/f5.mp3' },
  { id: 'vapi-f-6', name: 'Direct, confident, reassuring', role: 'Financial assistance, customer service', gender: 'Female', previewUrl: '/audio/f6.mp3' },
  { id: 'vapi-f-7', name: 'Warm, expressive, maternal', role: 'Audiobooks, storytelling, educational tools', gender: 'Female', previewUrl: '/audio/f7.mp3' },
  { id: 'vapi-f-8', name: 'Vibrant, fast-paced, bubbly', role: 'Gaming, pop culture, youth-focused apps', gender: 'Female', previewUrl: '/audio/f8.mp3' },
  { id: 'vapi-f-9', name: 'Deep, confident, sophisticated', role: 'Luxury retail, premium brand navigation', gender: 'Female', previewUrl: '/audio/f9.mp3' },
  { id: 'vapi-f-10', name: 'Soft, airy, gentle', role: 'Wellness, lifestyle, customer check-ins', gender: 'Female', previewUrl: '/audio/f10.mp3' },
  { id: 'vapi-f-11', name: 'Casual, conversational, relatable', role: 'E-commerce, lifestyle assistant', gender: 'Female', previewUrl: '/audio/f11.mp3' },
  { id: 'vapi-f-12', name: 'Edgy, modern, confident', role: 'Fashion, design, creative tools', gender: 'Female', previewUrl: '/audio/f12.mp3' },
  { id: 'vapi-f-13', name: 'Rich, textured, slightly dramatic', role: 'Audiobooks, gaming narratives', gender: 'Female', previewUrl: '/audio/f13.mp3' },
  { id: 'vapi-f-14', name: 'Empathetic, supportive, smooth', role: 'Healthcare, coaching, personal development', gender: 'Female', previewUrl: '/audio/f14.mp3' },
  { id: 'vapi-f-15', name: 'Upbeat, crisp, welcoming', role: 'Hospitality, travel guides, scheduling', gender: 'Female', previewUrl: '/audio/f15.mp3' },
  { id: 'vapi-f-16', name: 'Practical, straightforward, steady', role: 'Productivity tools, data reading', gender: 'Female', previewUrl: '/audio/f16.mp3' },
  { id: 'vapi-f-17', name: 'Wise, measured, clinical', role: 'Medical contexts, academic summaries', gender: 'Female', previewUrl: '/audio/f17.mp3' },
  { id: 'vapi-f-18', name: 'Athletic, punchy, motivational', role: 'Sports, active routines, coaching', gender: 'Female', previewUrl: '/audio/f18.mp3' },
  { id: 'vapi-f-19', name: 'Elegant, smooth, cosmopolitan', role: 'Travel, high-end concierges', gender: 'Female', previewUrl: '/audio/f19.mp3' },
  { id: 'vapi-f-20', name: 'Down-to-earth, friendly, rustic', role: 'Local service directories, community apps', gender: 'Female', previewUrl: '/audio/f20.mp3' },
  // Male
  { id: 'vapi-m-1', name: 'Deep, textured, conversational', role: 'General assistant, podcast reading', gender: 'Male', previewUrl: '/audio/m1.mp3' },
  { id: 'vapi-m-2', name: 'Command, authoritative, resonant', role: 'Security, executive tools, formal alerts', gender: 'Male', previewUrl: '/audio/m2.mp3' },
  { id: 'vapi-m-3', name: 'Casual, relatable, warm', role: 'Everyday apps, companion bots', gender: 'Male', previewUrl: '/audio/m3.mp3' },
  { id: 'vapi-m-4', name: 'Crisp, intelligent, tech-forward', role: 'Technical documentation, coding support', gender: 'Male', previewUrl: '/audio/m4.mp3' },
  { id: 'vapi-m-5', name: 'Low, bass-heavy, smooth', role: 'Night-mode reading, premium audiobooks', gender: 'Male', previewUrl: '/audio/m5.mp3' },
  { id: 'vapi-m-6', name: 'Measured, thoughtful, deliberate', role: 'Financial analysis, legal tech, serious topics', gender: 'Male', previewUrl: '/audio/m6.mp3' },
  { id: 'vapi-m-7', name: 'Urban, smooth, friendly', role: 'Lifestyle, food apps, personal scheduling', gender: 'Male', previewUrl: '/audio/m7.mp3' },
  { id: 'vapi-m-8', name: 'Gentle, empathetic, calm', role: 'Mental health, customer support', gender: 'Male', previewUrl: '/audio/m8.mp3' },
  { id: 'vapi-m-9', name: 'High-energy, optimistic, bright', role: 'Fitness tracking, interactive games', gender: 'Male', previewUrl: '/audio/m9.mp3' },
  { id: 'vapi-m-10', name: 'Steady, structured, trustworthy', role: 'Long-form narration, tutorials', gender: 'Male', previewUrl: '/audio/m10.mp3' },
  { id: 'vapi-m-11', name: 'Warm, approachable, intellectual', role: 'Education, smart-home management', gender: 'Male', previewUrl: '/audio/m11.mp3' },
  { id: 'vapi-m-12', name: 'Sharp, precise, clinical', role: 'Analytics, diagnostics, B2B software', gender: 'Male', previewUrl: '/audio/m12.mp3' },
  { id: 'vapi-m-13', name: 'Charismatic, bold, engaging', role: 'Marketing tools, presentations, sales', gender: 'Male', previewUrl: '/audio/m13.mp3' },
  { id: 'vapi-m-14', name: 'Playful, quick, friendly', role: 'Creative platforms, casual messaging', gender: 'Male', previewUrl: '/audio/m14.mp3' },
  { id: 'vapi-m-15', name: 'Balanced, conversational, neutral', role: 'Standard customer service portals', gender: 'Male', previewUrl: '/audio/m15.mp3' },
  { id: 'vapi-m-16', name: 'Dynamic, intense, suspenseful', role: 'Action narrations, high-stakes alerts', gender: 'Male', previewUrl: '/audio/m16.mp3' },
  { id: 'vapi-m-17', name: 'Witty, clever, dry', role: 'Smart assistants with an edge', gender: 'Male', previewUrl: '/audio/m17.mp3' },
  { id: 'vapi-m-18', name: 'Relaxed, smooth, coastal', role: 'Travel, meditation, casual browsing', gender: 'Male', previewUrl: '/audio/m18.mp3' },
  { id: 'vapi-m-19', name: 'Classic, rich, vintage resonance', role: 'Narration, storytelling, high-end guidance', gender: 'Male', previewUrl: '/audio/m19.mp3' },
  { id: 'vapi-m-20', name: 'Modern, punchy, youthful', role: 'Trendy apps, social media clip generation', gender: 'Male', previewUrl: '/audio/m20.mp3' },
];

export default function ChatbotManagerView() {
  const { chatbots, setChatbots, setMetrics, tenantId, isSuperAdmin, testWidgetBotId, setTestWidgetBotId } = useDashboardStore();
  const [newBotName, setNewBotName] = useState('');
  const [newBotColor, setNewBotColor] = useState('#4F46E5');
  const [newBotWelcome, setNewBotWelcome] = useState('Hello! How can I help you today?');
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentRole, setNewAgentRole] = useState('AI Assistant');
  const [newAgentAvatar, setNewAgentAvatar] = useState('/avatars/avatar1.png');
  const [newVoiceEnabled, setNewVoiceEnabled] = useState(false);
  const [newVapiAssistantId, setNewVapiAssistantId] = useState('');
  const [isCreatingBot, setIsCreatingBot] = useState(false);
  const [editingBotId, setEditingBotId] = useState<string | null>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = supabaseUrl && supabaseAnonKey ? createBrowserClient(supabaseUrl, supabaseAnonKey) : null;
  const globalBotId = '00000000-0000-0000-0000-000000000000';

  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlayPreview = (url: string) => {
    if (playingAudio === url && audioRef.current) {
      audioRef.current.pause();
      setPlayingAudio(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(url);
      audio.play().catch(e => console.log("Audio playback simulated for preview:", url));
      audio.onended = () => setPlayingAudio(null);
      audioRef.current = audio;
      setPlayingAudio(url);
    }
  };

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
      voice_enabled: newVoiceEnabled,
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
          voice_enabled: newVoiceEnabled,
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
      setNewVoiceEnabled(false);
      setNewVapiAssistantId('');
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
          voice_enabled: newVoiceEnabled,
          vapi_assistant_id: newVapiAssistantId,
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
        voice_enabled: newVoiceEnabled,
        vapi_assistant_id: newVapiAssistantId,
        configuration_json: updatedConfig
      } : bot));
      
      setEditingBotId(null);
      setNewBotName('');
      setNewBotWelcome('Hello! How can I help you today?');
      setNewAgentName('');
      setNewAgentRole('AI Assistant');
      setNewAgentAvatar('/avatars/avatar1.png');
      setNewVoiceEnabled(false);
      setNewVapiAssistantId('');
    }
    setIsCreatingBot(false);
  };

  return (
    <>
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

                  {/* VAPI VOICE CONFIGURATION */}
                  <div className="space-y-4 pt-4 border-t border-gray-800">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${newVoiceEnabled ? 'bg-indigo-600' : 'bg-gray-800'}`}>
                        <svg className={`w-5 h-5 ${newVoiceEnabled ? 'text-white' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <label className="block text-sm font-bold text-white mb-0.5">Enable Voice (Beta)</label>
                        <p className="text-xs text-gray-400">Allow customers to talk to this chatbot using voice streaming. Consumes Voice Minutes.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setNewVoiceEnabled(!newVoiceEnabled)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 focus:ring-offset-gray-950 ${newVoiceEnabled ? 'bg-indigo-600' : 'bg-gray-700'}`}
                      >
                        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${newVoiceEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                      </button>
                    </div>
                    {newVoiceEnabled && (
                      <div className="mt-4">
                        <label className="block text-xs font-semibold text-gray-400 mb-2">Select Voice Persona</label>
                        <div className="bg-gray-950 border border-gray-800 rounded-xl max-h-[300px] overflow-y-auto styleflo-scrollbar divide-y divide-gray-800/50">
                          {VOICE_PERSONAS.map((voice) => (
                            <div key={voice.id} className={`flex items-center justify-between p-3 transition-colors ${newVapiAssistantId === voice.id ? 'bg-indigo-900/20' : 'hover:bg-gray-900/50'}`}>
                              <div className="flex items-center gap-3 flex-1 cursor-pointer" onClick={() => setNewVapiAssistantId(voice.id)}>
                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${newVapiAssistantId === voice.id ? 'border-indigo-500 bg-indigo-500' : 'border-gray-600'}`}>
                                  {newVapiAssistantId === voice.id && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                                </div>
                                <div>
                                  <div className="text-xs font-bold text-white flex items-center gap-2">
                                    {voice.name}
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${voice.gender === 'Female' ? 'bg-pink-500/20 text-pink-300' : 'bg-blue-500/20 text-blue-300'}`}>{voice.gender}</span>
                                  </div>
                                  <div className="text-[10px] text-gray-500 mt-0.5">{voice.role}</div>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handlePlayPreview(voice.previewUrl)}
                                className={`ml-3 p-2 rounded-full flex-shrink-0 transition-colors ${playingAudio === voice.previewUrl ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
                                title="Preview Voice"
                              >
                                {playingAudio === voice.previewUrl ? (
                                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                )}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
                          setNewVoiceEnabled(false);
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
                          setNewVoiceEnabled(bot.voice_enabled || false);
                          setNewVapiAssistantId(bot.vapi_assistant_id || '');
                          
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
    </>
  );
}
