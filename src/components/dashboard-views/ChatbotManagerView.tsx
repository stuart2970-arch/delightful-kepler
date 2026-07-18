import React, { useState, useRef, useEffect } from 'react';
import { useDashboardStore, Chatbot } from '../../lib/store';
import { createBrowserClient } from '@supabase/ssr';



export default function ChatbotManagerView() {
  const { chatbots, setChatbots, setMetrics, tenantId, isSuperAdmin } = useDashboardStore();
  const [testWidgetBotId, setTestWidgetBotId] = useState<string | null>(null);
  const [newBotName, setNewBotName] = useState('');
  const [newBotColor, setNewBotColor] = useState('#4F46E5');
  const [newBotWelcome, setNewBotWelcome] = useState('Hello! How can I help you today?');
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentRole, setNewAgentRole] = useState('AI Assistant');
  const [newAgentAvatar, setNewAgentAvatar] = useState('/avatars/avatar1.png');
  const [newVoiceEnabled, setNewVoiceEnabled] = useState(false);
  const [newVoiceId, setNewVoiceId] = useState('');
  const [isCreatingBot, setIsCreatingBot] = useState(false);
  const [editingBotId, setEditingBotId] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [voicePersonas, setVoicePersonas] = useState<any[]>([]);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);
  const [isDeletingBot, setIsDeletingBot] = useState(false);
  
  const generatedAvatars = [
    '/avatars/robot_waiter_1.png',
    '/avatars/robot_waiter_2.png',
    '/avatars/robot_waiter_3.png',
    '/avatars/robot_waiter_4.png',
    '/avatars/robot_waiter_5.png',
    '/avatars/robot_stylist_1.png',
    '/avatars/robot_stylist_2.png',
    '/avatars/robot_stylist_3.png',
    '/avatars/robot_stylist_4.png',
    '/avatars/robot_stylist_5.png',
    '/avatars/robot_nail_tech_1.png',
    '/avatars/robot_nail_tech_2.png',
    '/avatars/robot_nail_tech_3.png',
    '/avatars/avatar1.png',
    '/avatars/avatar2.png',
    '/avatars/avatar3.png'
  ];

  useEffect(() => {
    fetch('/api/voice-personas')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setVoicePersonas(data);
        }
      })
      .catch(err => console.error('Error fetching voice personas:', err));
  }, []);

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

  const handleCustomAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !supabase) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file.');
      return;
    }
    
    if (file.size > 2 * 1024 * 1024) {
      alert('Image size must be less than 2MB.');
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${tenantId}/${crypto.randomUUID()}.${fileExt}`;
      
      const arrayBuffer = await file.arrayBuffer();
      
      const { error: uploadError, data } = await supabase.storage
        .from('chatbot-assets')
        .upload(fileName, arrayBuffer, { 
          upsert: true,
          contentType: file.type
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('chatbot-assets')
        .getPublicUrl(fileName);

      setNewAgentAvatar(publicUrlData.publicUrl);
    } catch (err: any) {
      console.error('Error uploading avatar:', err);
      alert(`Failed to upload avatar: ${err.message}`);
    } finally {
      setIsUploadingAvatar(false);
      // Reset input
      if (e.target) e.target.value = '';
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
        voice_id: newVoiceId,
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
            voice_id: newVoiceId,
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
      setWizardStep(1);
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
      voice_id: newVoiceId,
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
        configuration_json: updatedConfig
      } : bot));
      
      setEditingBotId(null);
      setNewBotName('');
      setNewBotWelcome('Hello! How can I help you today?');
      setNewAgentName('');
      setNewAgentRole('AI Assistant');
      setNewAgentAvatar('/avatars/avatar1.png');
      setNewVoiceEnabled(false);
    }
    setIsCreatingBot(false);
  };

  const handleDeleteChatbot = async () => {
    if (!showDeleteModal) return;
    setIsDeletingBot(true);
    let successfullyDeleted = false;
    try {
      const response = await fetch(`/api/chatbots/${encodeURIComponent(showDeleteModal)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || response.statusText);
      }
      successfullyDeleted = true;
    } catch (err: any) {
      console.error('Failed to delete chatbot:', err);
      if (!supabase) {
        console.warn('Operating in visual-only mode, mockup deleting locally.');
        successfullyDeleted = true;
      } else {
        alert(`Failed to delete chatbot: ${err.message}`);
      }
    }

    if (successfullyDeleted) {
      setChatbots(chatbots.filter(bot => bot.id !== showDeleteModal));
      setMetrics((prev) => ({
        ...prev,
        chatbotsCount: Math.max(0, prev.chatbotsCount - 1),
      }));
      setShowDeleteModal(null);
      if (editingBotId === showDeleteModal) {
        setEditingBotId(null);
      }
    }
    setIsDeletingBot(false);
  };

  return (
    <>
            <div className="space-y-6">
              {/* Create Chatbot Card */}
              <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl">
                <h3 className="text-lg font-bold text-white mb-6">
                  {editingBotId ? `Edit Chatbot: ${newBotName}` : 'Create New Chatbot'}
                </h3>

                {!editingBotId && (
                  <div className="mb-8 mt-2 px-2 md:px-8">
                    <div className="flex justify-between relative">
                      <div className="absolute top-4 left-0 w-full h-0.5 bg-gray-800 -z-10 rounded-full"></div>
                      {[
                        { step: 1, label: 'Basics' },
                        { step: 2, label: 'Persona' },
                        { step: 3, label: 'Avatar' },
                        { step: 4, label: 'Voice' },
                      ].map((s) => (
                        <div key={s.step} className="flex flex-col items-center gap-2">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                            wizardStep >= s.step ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' : 'bg-gray-900 border-2 border-gray-700 text-gray-500'
                          }`}>
                            {wizardStep > s.step ? '✓' : s.step}
                          </div>
                          <span className={`text-[10px] uppercase tracking-wider font-bold transition-colors duration-300 ${wizardStep >= s.step ? 'text-indigo-400' : 'text-gray-500'}`}>
                            {s.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <form onSubmit={(e) => {
                  e.preventDefault();
                  // We only submit on step 4 or if editing
                  if (editingBotId || wizardStep === 4) {
                    if (editingBotId) handleUpdateChatbot(e);
                    else handleCreateChatbot(e);
                  }
                }} className="space-y-6">
                  
                  {/* Step 1: Basics & Branding */}
                  {(editingBotId || wizardStep === 1) && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
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
                    </div>
                  )}

                  {/* Step 2: Persona & Messaging */}
                  {(editingBotId || wizardStep === 2) && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
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
                    </div>
                  )}

                  {/* Step 3: Avatar Selection */}
                  {(editingBotId || wizardStep === 3) && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div>
                      <label className="block text-xs font-semibold text-gray-400 mb-2">Select Agent Avatar Preset</label>
                      
                      <div className="grid grid-cols-5 md:grid-cols-10 gap-2 mb-4 max-h-48 overflow-y-auto styleflo-scrollbar pr-2">
                        {generatedAvatars.map((url, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setNewAgentAvatar(url)}
                            className={`relative aspect-square rounded-full border-2 transition-all p-0.5 overflow-hidden ${
                              newAgentAvatar === url
                                ? 'border-indigo-500 shadow-md shadow-indigo-500/20 bg-indigo-500/10'
                                : 'border-transparent hover:border-gray-600 bg-gray-900/50'
                            }`}
                          >
                            <img
                              src={url}
                              alt={`Avatar ${idx}`}
                              className="w-full h-full object-cover rounded-full bg-white"
                            />
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="relative">
                          {newAgentAvatar && !generatedAvatars.includes(newAgentAvatar) && (
                            <img
                              src={newAgentAvatar}
                              alt="Custom Avatar"
                              className="w-12 h-12 rounded-full border border-indigo-500 object-cover bg-gray-900 shadow-md"
                            />
                          )}
                        </div>
                        <label className={`relative flex items-center justify-center gap-2 px-4 py-2 border border-gray-700 rounded-xl cursor-pointer hover:bg-gray-800 transition-colors ${isUploadingAvatar ? 'opacity-50 pointer-events-none' : ''}`}>
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            onChange={handleCustomAvatarUpload}
                            disabled={isUploadingAvatar}
                          />
                          <span className="text-xs font-semibold text-gray-300">
                            {isUploadingAvatar ? 'Uploading...' : 'Upload Custom Image (1:1)'}
                          </span>
                        </label>
                      </div>
                      </div>
                    </div>
                  )}
                  {/* Step 4: VAPI VOICE CONFIGURATION */}
                  {(editingBotId || wizardStep === 4) && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex items-center justify-between bg-gray-950 p-4 rounded-xl border border-gray-800">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${newVoiceEnabled ? 'bg-indigo-600' : 'bg-gray-800'}`}>
                          <svg className={`w-5 h-5 ${newVoiceEnabled ? 'text-white' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          </svg>
                        </div>
                        <div className="flex-1 ml-4">
                          <label className="block text-sm font-bold text-white mb-0.5">Enable Voice (Beta)</label>
                          <p className="text-xs text-gray-400">Allow customers to talk to this chatbot using voice streaming.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setNewVoiceEnabled(!newVoiceEnabled)}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${newVoiceEnabled ? 'bg-indigo-600' : 'bg-gray-700'}`}
                        >
                          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${newVoiceEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                      </div>

                      {newVoiceEnabled && (
                        <div className="mt-4">
                          <label className="block text-xs font-semibold text-gray-400 mb-2">Select Voice Persona</label>
                          <div className="bg-gray-950 border border-gray-800 rounded-xl max-h-[300px] overflow-y-auto styleflo-scrollbar divide-y divide-gray-800/50">
                            {voicePersonas.map((voice) => (
                              <div key={voice.id} className={`flex items-center justify-between p-3 transition-colors ${newVoiceId === voice.id ? 'bg-indigo-900/20' : 'hover:bg-gray-900/50'}`}>
                                <div className="flex items-center gap-3 flex-1 cursor-pointer" onClick={() => setNewVoiceId(voice.id)}>
                                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${newVoiceId === voice.id ? 'border-indigo-500 bg-indigo-500' : 'border-gray-600'}`}>
                                    {newVoiceId === voice.id && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                                  </div>
                                  <div>
                                    <div className="text-xs font-bold text-white flex items-center gap-2">
                                      {voice.name}
                                      <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-indigo-500/20 text-indigo-300">{voice.nationality}</span>
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-0.5">{voice.role}</div>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handlePlayPreview(voice.previewUrl)}
                                  className={`ml-3 p-2 rounded-full flex-shrink-0 transition-colors ${playingAudio === voice.previewUrl ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
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
                  )}

                  {/* Navigation Controls */}
                  <div className="pt-6 mt-6 border-t border-gray-800 flex justify-between items-center">
                    {!editingBotId && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setWizardStep(Math.max(1, wizardStep - 1))}
                          disabled={wizardStep === 1}
                          className="bg-gray-800 hover:bg-gray-700 text-white text-sm font-semibold py-2 px-5 rounded-xl disabled:opacity-50 transition-colors"
                        >
                          Back
                        </button>
                        {wizardStep < 4 && (
                          <button
                            type="button"
                            onClick={() => setWizardStep(Math.min(4, wizardStep + 1))}
                            disabled={wizardStep === 1 && !newBotName.trim()}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-2 px-5 rounded-xl transition-colors disabled:opacity-50"
                          >
                            Next Step
                          </button>
                        )}
                      </div>
                    )}

                    {(editingBotId || wizardStep === 4) && (
                      <button
                        type="submit"
                        disabled={isCreatingBot || !newBotName}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold py-2 px-6 rounded-xl shadow-lg shadow-emerald-500/20 transition-all ml-auto disabled:opacity-50"
                      >
                        {isCreatingBot ? 'Saving...' : (editingBotId ? 'Update Chatbot' : 'Finish & Save Chatbot')}
                      </button>
                    )}
                    
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
                          setNewVoiceId('');
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
                          const config = bot.configuration_json || {};
                          setEditingBotId(bot.id);
                          setNewBotName(bot.name);
                          setNewBotColor(bot.primary_color);
                          setNewBotWelcome(config.welcome_message || 'Hello!');
                          setNewAgentName(config.agent_name || bot.name);
                          setNewAgentRole(config.agent_role || 'AI Assistant');
                          setNewAgentAvatar(config.agent_avatar_url || '/avatars/avatar1.png');
                          setNewVoiceEnabled(bot.voice_enabled || false);
                          setNewVoiceId(config.voice_id || '');
                          
                          // Scroll form into view
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="flex-1 bg-indigo-950/40 hover:bg-indigo-950/70 text-indigo-300 hover:text-indigo-200 border border-indigo-900/50 py-1.5 px-3 rounded-xl text-xs font-semibold transition-colors"
                      >
                        Edit Persona
                      </button>
                      <button
                        onClick={() => setShowDeleteModal(bot.id)}
                        className="flex-1 bg-red-950/40 hover:bg-red-950/70 text-red-400 hover:text-red-300 border border-red-900/50 py-1.5 px-3 rounded-xl text-xs font-semibold transition-colors"
                      >
                        Delete
                      </button>
                    </div>

                    {/* Embed Code Section */}
                    {testWidgetBotId === bot.id && (
                      <div className="pt-2 text-left space-y-2 border-t border-gray-800 mt-2">
                        <label className="block text-[10px] font-semibold text-gray-400">Host Injection Snippet:</label>
                        <pre className="p-2.5 bg-gray-950 border border-gray-800 text-[10px] rounded-xl overflow-x-auto text-gray-300 font-mono leading-relaxed select-all">
                          {`<!-- StyleFlo Widget Injection -->\n<script\n  src="${window.location.origin}/widget.js"\n  data-api-host="${window.location.origin}"\n  data-bot-id="${bot.id}">\n</script>`}
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

            {/* Delete Confirmation Modal */}
            {showDeleteModal && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-red-600"></div>
                  <h3 className="text-xl font-bold text-white mb-2">Delete Chatbot?</h3>
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6">
                    <p className="text-sm text-red-400 font-semibold mb-2">⚠️ Warning: This action cannot be undone.</p>
                    <p className="text-xs text-red-300 leading-relaxed">
                      This will permanently delete your chatbot, including any customer data collated by the chatbot, conversations, and any data stored in its knowledgebase.
                    </p>
                  </div>
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => setShowDeleteModal(null)}
                      disabled={isDeletingBot}
                      className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-300 hover:text-white transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDeleteChatbot}
                      disabled={isDeletingBot}
                      className="px-5 py-2 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20 transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                      {isDeletingBot ? 'Deleting...' : 'Yes, Delete Chatbot'}
                    </button>
                  </div>
                </div>
              </div>
            )}
    </>
  );
}
