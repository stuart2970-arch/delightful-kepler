// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { useDashboardStore, Chatbot } from '../../lib/store';
import { createBrowserClient } from '@supabase/ssr';



export default function ChatbotManagerView() {
  const { chatbots, setChatbots, setMetrics, tenantId, isSuperAdmin, appointments, setActiveTab } = useDashboardStore();
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [instagramEnabled, setInstagramEnabled] = useState(false);
  const [instagramHandle, setInstagramHandle] = useState('');
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [smsNumber, setSmsNumber] = useState('');

  const [testWidgetBotId, setTestWidgetBotId] = useState<string | null>(null);
  const [newBotName, setNewBotName] = useState('');
  const [newBotColor, setNewBotColor] = useState('#4F46E5');
  const [newBotWelcome, setNewBotWelcome] = useState('Hello! How can I help you today?');
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentRole, setNewAgentRole] = useState('AI Assistant');
  const [newAgentAvatar, setNewAgentAvatar] = useState('/avatars/avatar1.png');
  const [newVoiceEnabled, setNewVoiceEnabled] = useState(false);
  const [fileUploadEnabled, setFileUploadEnabled] = useState(false);
  const [newVoiceId, setNewVoiceId] = useState('');
  const [backgroundSound, setBackgroundSound] = useState('office');
  const [newAdminEmail, setNewAdminEmail] = useState('');
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
    if (!file) return;

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
      const formData = new FormData();
      formData.append('file', file);
      formData.append('tenantId', tenantId);

      const response = await fetch('/api/chatbots/upload-avatar', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || response.statusText);
      }

      const { url } = await response.json();
      setNewAgentAvatar(url);
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
    const configPayload = {
      welcome_message: newBotWelcome,
      agent_name: newAgentName.trim() || newBotName,
      agent_role: newAgentRole.trim(),
      agent_avatar_url: newAgentAvatar,
      voice_id: newVoiceId,
      background_sound: backgroundSound,
      admin_email: newAdminEmail.trim(),
      whatsapp_enabled: whatsappEnabled,
      whatsapp_number: whatsappNumber.trim(),
      instagram_enabled: instagramEnabled,
      instagram_handle: instagramHandle.trim(),
      sms_enabled: smsEnabled,
      sms_number: smsNumber.trim(),
      file_upload_enabled: fileUploadEnabled,
    };

    const newChatbot: Chatbot = {
      id: newId,
      name: newBotName,
      primary_color: newBotColor,
      voice_enabled: newVoiceEnabled,
      configuration_json: configPayload,
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
          configuration_json: configPayload,
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
      setFileUploadEnabled(false);
      setBackgroundSound('office');
      setNewAdminEmail('');
      setWhatsappEnabled(false);
      setWhatsappNumber('');
      setInstagramEnabled(false);
      setInstagramHandle('');
      setSmsEnabled(false);
      setSmsNumber('');
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
      background_sound: backgroundSound,
      admin_email: newAdminEmail.trim(),
      whatsapp_enabled: whatsappEnabled,
      whatsapp_number: whatsappNumber.trim(),
      instagram_enabled: instagramEnabled,
      instagram_handle: instagramHandle.trim(),
      sms_enabled: smsEnabled,
      sms_number: smsNumber.trim(),
      file_upload_enabled: fileUploadEnabled,
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
      setFileUploadEnabled(false);
      setBackgroundSound('office');
      setWhatsappEnabled(false);
      setWhatsappNumber('');
      setInstagramEnabled(false);
      setInstagramHandle('');
      setSmsEnabled(false);
      setSmsNumber('');
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
      alert('Chatbot successfully deleted. All associated data has been permanently wiped.');
    }
    setIsDeletingBot(false);
  };

  // Filter appointments for the current week (Monday 00:00:00 to Sunday 23:59:59 local time)
  const getWeeklyAppointmentsCount = () => {
    if (!appointments || !Array.isArray(appointments)) return 0;
    
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const startOfWeek = new Date(now.setDate(diff));
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek.getTime());
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    return appointments.filter(appt => {
      if (appt.is_blockout) return false;
      const apptDate = new Date(appt.start_time);
      return apptDate >= startOfWeek && apptDate < endOfWeek;
    }).length;
  };

  return (
    <>
            <div className="space-y-6">
              {/* Weekly Performance Overview Banner */}
              <div className="bg-gradient-to-r from-indigo-900 via-indigo-950 to-purple-950 border border-indigo-500/30 p-6 rounded-2xl shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
                <div className="space-y-1 z-10">
                  <span className="text-[10px] tracking-wider uppercase font-bold bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20" style={{ color: '#a5b4fc' }}>
                    Weekly Performance Overview
                  </span>
                  <h3 className="text-xl md:text-2xl font-extrabold mt-2" style={{ color: '#ffffff' }}>
                    Chatbot Bookings Statistics
                  </h3>
                  <p className="text-xs mt-1" style={{ color: '#c7d2fe' }}>
                    Track automated appointments scheduled for the current week (Monday to Sunday).
                  </p>
                </div>
                <div className="flex items-center gap-4 z-10 bg-indigo-950/50 border border-indigo-500/20 p-4 rounded-xl shadow-inner min-w-[200px] justify-between">
                  <div>
                    <span className="text-xs font-medium block" style={{ color: '#a5b4fc' }}>Appointments Booked</span>
                    <span className="text-2xl md:text-3xl font-black" style={{ color: '#ffffff' }}>{getWeeklyAppointmentsCount()}</span>
                  </div>
                  <div className="w-12 h-12 bg-green-500/10 border border-green-500/30 rounded-xl flex items-center justify-center text-green-400 shadow">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                </div>
              </div>
              {/* Create / Edit Chatbot Form Card (Only shown if 0 chatbots exist or if editing an existing chatbot) */}
              {(!chatbots.filter(b => b.id !== globalBotId).length || editingBotId) && (
                <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-sm">
                <h3 className="text-lg font-bold text-[var(--awb-color8)] mb-6">
                  {editingBotId ? `Edit Chatbot: ${newBotName}` : 'Create New Chatbot'}
                </h3>

                <div className="mb-8 mt-2 px-2 md:px-8">
                  <div className="flex justify-between relative">
                    <div className="absolute top-4 left-0 w-full h-0.5 bg-[var(--awb-color3)] -z-10 rounded-full"></div>
                    {[
                      { step: 1, label: 'Basics' },
                      { step: 2, label: 'Persona' },
                      { step: 3, label: 'Avatar' },
                      { step: 4, label: 'Voice' },
                    ].map((s) => (
                      <button
                        key={s.step}
                        type="button"
                        onClick={() => setWizardStep(s.step)}
                        className="flex flex-col items-center gap-2 cursor-pointer group"
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                          wizardStep === s.step ? 'bg-[#198fd9] text-white shadow-md ring-4 ring-blue-100' : wizardStep > s.step ? 'bg-[#65bd7d] text-white' : 'bg-[var(--awb-color1)] border-2 border-[var(--awb-color3)] text-[var(--awb-color6)]'
                        }`}>
                          {wizardStep > s.step ? '✓' : s.step}
                        </div>
                        <span className={`text-[10px] uppercase tracking-wider font-bold transition-colors duration-300 ${wizardStep === s.step ? 'text-[#198fd9]' : 'text-[var(--awb-color6)] group-hover:text-[var(--awb-color8)]'}`}>
                          {s.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

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
                          <label className="block text-xs font-semibold text-[var(--awb-color7)] mb-1.5">Chatbot Name</label>
                          <input
                            type="text"
                            placeholder="e.g. Acme Support Bot"
                            value={newBotName}
                            onChange={(e) => setNewBotName(e.target.value)}
                            className="w-full h-[50px] bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-[6px] px-3.5 py-2 text-sm text-[var(--awb-color8)] focus:outline-none focus:border-[var(--awb-color4)]"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[var(--awb-color7)] mb-1.5">Branding Accent Color</label>
                          <div className="flex gap-2.5 items-center">
                            <input
                              type="color"
                              value={newBotColor}
                              onChange={(e) => setNewBotColor(e.target.value)}
                              className="w-12 h-[50px] bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-[6px] cursor-pointer p-1"
                            />
                            <input
                              type="text"
                              value={newBotColor}
                              onChange={(e) => setNewBotColor(e.target.value)}
                              className="flex-1 h-[50px] bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-[6px] px-3.5 py-2 text-sm text-[var(--awb-color8)] font-mono"
                            />
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-[var(--awb-color7)] mb-1.5">Admin Notification Email</label>
                        <input
                          type="email"
                          placeholder="e.g. admin@yourbusiness.com (receives consolidated lead emails)"
                          value={newAdminEmail}
                          onChange={(e) => setNewAdminEmail(e.target.value)}
                          className="w-full h-[50px] bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-[6px] px-3.5 py-2 text-sm text-[var(--awb-color8)] focus:outline-none focus:border-[var(--awb-color4)]"
                        />
                        <p className="text-[11px] text-[var(--awb-color6)] mt-1">
                          Consolidated lead notifications (Email + Mobile Tel + Intent & Transcript) for this chatbot will be sent to this email address. If blank, notifications fall back to your account owner email.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Step 2: Persona & Messaging */}
                  {(editingBotId || wizardStep === 2) && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div>
                        <label className="block text-xs font-semibold text-[var(--awb-color7)] mb-1.5">Welcome Message</label>
                        <textarea
                          value={newBotWelcome}
                          onChange={(e) => setNewBotWelcome(e.target.value)}
                          className="w-full min-h-[50px] focus:min-h-[120px] transition-all bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-[6px] px-3.5 py-3 text-sm text-[var(--awb-color8)] focus:outline-none focus:border-[#198fd9] resize-none overflow-y-auto"
                          required
                        />
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-[var(--awb-color7)] mb-1.5">Agent Display Name</label>
                          <input
                            type="text"
                            placeholder="e.g. Emma (AI Agent)"
                            value={newAgentName}
                            onChange={(e) => setNewAgentName(e.target.value)}
                            className="w-full h-[50px] bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-[6px] px-3.5 py-2 text-sm text-[var(--awb-color8)] focus:outline-none focus:border-[var(--awb-color4)]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[var(--awb-color7)] mb-1.5">Agent Role Subtitle</label>
                          <input
                            type="text"
                            placeholder="e.g. StyleFlo Advisor"
                            value={newAgentRole}
                            onChange={(e) => setNewAgentRole(e.target.value)}
                            className="w-full h-[50px] bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-[6px] px-3.5 py-2 text-sm text-[var(--awb-color8)] focus:outline-none focus:border-[var(--awb-color4)]"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step 3: Avatar Selection */}
                  {(editingBotId || wizardStep === 3) && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div>
                      <label className="block text-xs font-semibold text-[var(--awb-color7)] mb-2">Select Agent Avatar Preset</label>
                      
                      <div className="grid grid-cols-4 md:grid-cols-8 gap-3 mb-4 max-h-64 overflow-y-auto styleflo-scrollbar pr-2">
                        {generatedAvatars.map((url, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setNewAgentAvatar(url)}
                            className={`relative aspect-square rounded-full border-2 transition-all p-0.5 overflow-hidden ${
                              newAgentAvatar === url
                                ? 'border-[var(--awb-color5)] shadow-md bg-[var(--awb-color2)]'
                                : 'border-transparent hover:border-[var(--awb-color3)] bg-[var(--awb-color2)]'
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
                              className="w-12 h-12 rounded-full border border-[var(--awb-color5)] object-cover bg-white shadow-sm"
                            />
                          )}
                        </div>
                        <label className={`relative flex items-center justify-center gap-2 px-4 py-2 border border-[var(--awb-color3)] bg-[var(--awb-color1)] rounded-xl cursor-pointer hover:bg-[var(--awb-color2)] transition-colors ${isUploadingAvatar ? 'opacity-50 pointer-events-none' : ''}`}>
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            onChange={handleCustomAvatarUpload}
                            disabled={isUploadingAvatar}
                          />
                          <span className="text-xs font-semibold text-[var(--awb-color8)]">
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
                      <div className="flex items-center justify-between bg-[var(--awb-color2)] p-4 rounded-xl border border-[var(--awb-color3)]">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${newVoiceEnabled ? 'bg-[#198fd9] text-white' : 'bg-[var(--awb-color3)]'}`}>
                          <svg className={`w-5 h-5 ${newVoiceEnabled ? 'text-white' : 'text-[var(--awb-color6)]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          </svg>
                        </div>
                        <div className="flex-1 ml-4">
                          <label className="block text-sm font-bold text-[var(--awb-color8)] mb-0.5">Enable Voice (Beta)</label>
                          <p className="text-xs text-[var(--awb-color6)]">Allow customers to talk to this chatbot using voice streaming.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setNewVoiceEnabled(!newVoiceEnabled)}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${newVoiceEnabled ? 'bg-[#198fd9] text-white' : 'bg-[var(--awb-color3)]'}`}
                        >
                          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${newVoiceEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                      </div>

                      {newVoiceEnabled && (
                        <div className="mt-4 space-y-4">
                          <div>
                            <label className="block text-xs font-semibold text-[var(--awb-color7)] mb-2">Select Voice Persona</label>
                            <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-xl max-h-[300px] overflow-y-auto styleflo-scrollbar divide-y divide-[var(--awb-color3)]">
                              {voicePersonas.map((voice) => (
                                <div key={voice.id} className={`flex items-center justify-between p-3 transition-colors ${newVoiceId === voice.id ? 'bg-[var(--awb-color2)]' : 'hover:bg-[var(--awb-color2)]/50'}`}>
                                  <div className="flex items-center gap-3 flex-1 cursor-pointer" onClick={() => setNewVoiceId(voice.id)}>
                                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${newVoiceId === voice.id ? 'border-[var(--awb-color5)] bg-[#198fd9] text-white' : 'border-[var(--awb-color3)]'}`}>
                                      {newVoiceId === voice.id && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                                    </div>
                                    <div>
                                      <div className="text-xs font-bold text-[var(--awb-color8)] flex items-center gap-2">
                                        {voice.name}
                                        <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-[var(--awb-color3)] text-[var(--awb-color8)]">{voice.nationality}</span>
                                      </div>
                                      <div className="text-[10px] text-[var(--awb-color6)] mt-0.5">{voice.role}</div>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handlePlayPreview(voice.previewUrl)}
                                    className={`ml-3 p-2 rounded-full flex-shrink-0 transition-colors ${playingAudio === voice.previewUrl ? 'bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px] shadow-md' : 'bg-[var(--awb-color3)] text-[var(--awb-color7)]'}`}
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

                          <div className="bg-[var(--awb-color2)] p-4 rounded-xl border border-[var(--awb-color3)] space-y-2">
                            <label className="block text-xs font-bold text-[var(--awb-color8)]">
                              🎧 Background Ambient Sound (Room Atmosphere)
                            </label>
                            <p className="text-[11px] text-[var(--awb-color6)]">
                              Eliminates dead silence during voice calls by playing subtle ambient room sound while the caller speaks or listens. Mastered at a 30% reduced level to protect speech clarity.
                            </p>
                            <div className="flex items-center gap-2">
                              <select
                                value={backgroundSound}
                                onChange={(e) => setBackgroundSound(e.target.value)}
                                className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-lg px-3 py-2 text-xs font-semibold text-[var(--awb-color8)] focus:outline-none focus:border-[#198fd9]"
                              >
                                <option value="office">🏢 Office / Professional</option>
                                <option value="salon">✂️ Hair Salon & Spa</option>
                                <option value="barber">💈 Barber Shop</option>
                                <option value="coffee-shop">☕ Coffee Shop</option>
                                <option value="restaurant">🍽️ Restaurant & Bistro</option>
                                <option value="diner">🍔 Diner & Lounge</option>
                                <option value="off">🔇 Off (Silent)</option>
                              </select>
                              {backgroundSound !== 'off' && (
                                <button
                                  type="button"
                                  onClick={() => handlePlayPreview(`/audio/ambient/${backgroundSound}.wav`)}
                                  title="Preview Ambient Sound Level"
                                  className={`p-2 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                                    playingAudio === `/audio/ambient/${backgroundSound}.wav`
                                      ? 'bg-[#198fd9] text-white shadow-md'
                                      : 'bg-[var(--awb-color3)] text-[var(--awb-color8)] hover:bg-[var(--awb-color5)]/20'
                                  }`}
                                >
                                  {playingAudio === `/audio/ambient/${backgroundSound}.wav` ? (
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                                  ) : (
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* File Uploads (Paperclip) Toggle */}
                      <div className="flex items-center justify-between bg-[var(--awb-color2)] p-4 rounded-xl border border-[var(--awb-color3)]">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${fileUploadEnabled ? 'bg-[#198fd9] text-white' : 'bg-[var(--awb-color3)]'}`}>
                          <svg className={`w-5 h-5 ${fileUploadEnabled ? 'text-white' : 'text-[var(--awb-color6)]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                        </div>
                        <div className="flex-1 ml-4">
                          <label className="block text-sm font-bold text-[var(--awb-color8)] mb-0.5">File Uploads (Paperclip)</label>
                          <p className="text-xs text-[var(--awb-color6)]">Allow website visitors to upload documents/files directly through the chat widget.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setFileUploadEnabled(!fileUploadEnabled)}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${fileUploadEnabled ? 'bg-[#198fd9] text-white' : 'bg-[var(--awb-color3)]'}`}
                        >
                          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${fileUploadEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                      </div>

                      {/* OPENCLAW OMNICHANNEL CHANNELS */}
                      <div className="pt-4 border-t border-[var(--awb-color3)] space-y-4">
                        <h4 className="text-sm font-bold text-[var(--awb-color8)] flex items-center gap-2">
                          💬 Omnichannel 2-Way Messaging Channels
                        </h4>

                        {/* WhatsApp Toggle & Number */}
                        <div className="bg-[var(--awb-color2)] p-4 rounded-xl border border-[var(--awb-color3)] space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-emerald-500 font-bold text-base">🟢</span>
                              <label className="text-xs font-bold text-[var(--awb-color8)]">WhatsApp Auto-Reply</label>
                            </div>
                            <input
                              type="checkbox"
                              checked={whatsappEnabled}
                              onChange={(e) => setWhatsappEnabled(e.target.checked)}
                              className="w-4 h-4 text-[#198fd9] rounded border-gray-300"
                            />
                          </div>
                          {whatsappEnabled && (
                            <div>
                              <label className="block text-[11px] text-[var(--awb-color6)] font-semibold mb-1">Business WhatsApp Phone Number</label>
                              <input
                                type="text"
                                value={whatsappNumber}
                                onChange={(e) => setWhatsappNumber(e.target.value)}
                                className="w-full bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-lg px-3 py-2 text-xs text-[var(--awb-color8)] focus:outline-none focus:border-[#198fd9]"
                                placeholder="e.g. +447700900077"
                              />
                            </div>
                          )}
                        </div>

                        {/* Instagram Toggle & Handle */}
                        <div className="bg-[var(--awb-color2)] p-4 rounded-xl border border-[var(--awb-color3)] space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-purple-500 font-bold text-base">📸</span>
                              <label className="text-xs font-bold text-[var(--awb-color8)]">Instagram Direct DM Auto-Reply</label>
                            </div>
                            <input
                              type="checkbox"
                              checked={instagramEnabled}
                              onChange={(e) => setInstagramEnabled(e.target.checked)}
                              className="w-4 h-4 text-[#198fd9] rounded border-gray-300"
                            />
                          </div>
                          {instagramEnabled && (
                            <div>
                              <label className="block text-[11px] text-[var(--awb-color6)] font-semibold mb-1">Instagram Business Handle</label>
                              <input
                                type="text"
                                value={instagramHandle}
                                onChange={(e) => setInstagramHandle(e.target.value)}
                                className="w-full bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-lg px-3 py-2 text-xs text-[var(--awb-color8)] focus:outline-none focus:border-[#198fd9]"
                                placeholder="e.g. @crew_barbers"
                              />
                            </div>
                          )}
                        </div>

                        {/* SMS Toggle & Number */}
                        <div className="bg-[var(--awb-color2)] p-4 rounded-xl border border-[var(--awb-color3)] space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-blue-500 font-bold text-base">💬</span>
                              <label className="text-xs font-bold text-[var(--awb-color8)]">Twilio 2-Way SMS Reminders</label>
                            </div>
                            <input
                              type="checkbox"
                              checked={smsEnabled}
                              onChange={(e) => setSmsEnabled(e.target.checked)}
                              className="w-4 h-4 text-[#198fd9] rounded border-gray-300"
                            />
                          </div>
                          {smsEnabled && (
                            <div>
                              <label className="block text-[11px] text-[var(--awb-color6)] font-semibold mb-1">Twilio SMS Sender Number</label>
                              <input
                                type="text"
                                value={smsNumber}
                                onChange={(e) => setSmsNumber(e.target.value)}
                                className="w-full bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-lg px-3 py-2 text-xs text-[var(--awb-color8)] focus:outline-none focus:border-[#198fd9]"
                                placeholder="e.g. +447700900077"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                    {/* Step Navigation Buttons */}
                    <div className="flex items-center justify-between pt-4 border-t border-[var(--awb-color3)]">
                      {!editingBotId ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setWizardStep(Math.max(1, wizardStep - 1))}
                            disabled={wizardStep === 1}
                            className="bg-[var(--awb-color2)] text-[var(--awb-color7)] px-5 py-2.5 rounded-xl text-xs font-bold hover:bg-[var(--awb-color3)] transition-colors disabled:opacity-40"
                          >
                            Back
                          </button>

                          {wizardStep < 4 ? (
                            <button
                              type="button"
                              onClick={() => setWizardStep(Math.min(4, wizardStep + 1))}
                              className="bg-[#198fd9] hover:bg-[#157ab9] text-white px-6 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm"
                            >
                              Next Step
                            </button>
                          ) : (
                            <button
                              type="submit"
                              disabled={isCreatingBot}
                              className="bg-[#198fd9] hover:bg-[#157ab9] text-white px-7 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md disabled:opacity-50"
                            >
                              {isCreatingBot ? 'Creating...' : 'Finish & Launch Chatbot'}
                            </button>
                          )}
                        </>
                      ) : (
                        <div className="flex gap-3">
                          <button
                            type="submit"
                            disabled={isCreatingBot}
                            className="bg-[#198fd9] hover:bg-[#157ab9] text-white px-6 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md disabled:opacity-50"
                          >
                            {isCreatingBot ? 'Saving...' : 'Save Changes'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingBotId(null);
                              setWizardStep(1);
                              setNewBotName('');
                              setNewBotColor('#4F46E5');
                              setNewBotWelcome('Hello! How can I help you today?');
                              setNewAgentName('');
                              setNewAgentRole('AI Assistant');
                              setNewAgentAvatar('/avatars/avatar1.png');
                              setNewVoiceEnabled(false);
                              setNewVoiceId('');
                              setNewAdminEmail('');
                              setWhatsappEnabled(false);
                              setWhatsappNumber('');
                              setInstagramEnabled(false);
                              setInstagramHandle('');
                              setSmsEnabled(false);
                              setSmsNumber('');
                            }}
                            className="bg-[var(--awb-color2)] text-[var(--awb-color8)] hover:bg-gray-200 text-sm font-semibold py-2 px-5 rounded-xl transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </form>
                </div>
              )}

              {/* Chatbot Display Card & Embed Code Snippet (Displayed adjacent when chatbot exists) */}
              {!editingBotId && chatbots.filter(b => b.id !== globalBotId).length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                  {chatbots.filter(b => b.id !== globalBotId).map((bot) => (
                    <React.Fragment key={bot.id}>
                      {/* Left Card: Chatbot Configuration */}
                      <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-sm space-y-5 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-2 h-full" style={{ backgroundColor: bot.primary_color }} />
                        
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="text-[10px] tracking-wider uppercase font-bold text-gray-400 block mb-1">Active Chatbot</span>
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-[var(--awb-color8)] text-xl">{bot.name}</h4>
                              {bot.voice_enabled ? (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-[#198fd9] border border-blue-200 inline-flex items-center gap-1 shadow-sm">
                                  📞 Voice Active
                                </span>
                              ) : (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500 border border-gray-200">
                                  💬 Text Only
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-[var(--awb-color6)] font-mono mt-1 select-all">ID: {bot.id}</p>
                          </div>
                          <span className="w-3.5 h-3.5 rounded-full shadow-sm" style={{ backgroundColor: bot.primary_color }} />
                        </div>

                        <div className="bg-[var(--awb-color2)] p-4 rounded-xl text-xs text-[var(--awb-color7)] italic border border-[var(--awb-color3)] leading-relaxed">
                          "{bot.configuration_json?.welcome_message || 'Hello! How can I help you today?'}"
                        </div>

                        <div className="flex items-center gap-3 bg-white p-3 rounded-xl border border-[var(--awb-color3)] shadow-sm">
                          <img
                            src={bot.configuration_json?.agent_avatar_url || '/avatars/avatar1.png'}
                            alt="Agent Avatar"
                            className="w-10 h-10 rounded-full border bg-white object-cover shadow-sm"
                            style={{ borderColor: bot.primary_color }}
                          />
                          <div>
                            <div className="text-sm font-bold text-[var(--awb-color8)]">
                              {bot.configuration_json?.agent_name || bot.name}
                            </div>
                            <div className="text-xs text-[var(--awb-color6)]">
                              {bot.configuration_json?.agent_role || 'AI Assistant'}
                            </div>
                          </div>
                        </div>

                        <div className="pt-2">
                          <button
                            onClick={() => {
                              const config = bot.configuration_json || {};
                              setEditingBotId(bot.id);
                              setWizardStep(1);
                              setNewBotName(bot.name);
                              setNewBotColor(bot.primary_color);
                              setNewBotWelcome(config.welcome_message || 'Hello!');
                              setNewAgentName(config.agent_name || bot.name);
                              setNewAgentRole(config.agent_role || 'AI Assistant');
                              setNewAgentAvatar(config.agent_avatar_url || '/avatars/avatar1.png');
                              setNewVoiceEnabled(bot.voice_enabled || false);
                              setNewVoiceId(config.voice_id || '');
                              setBackgroundSound(config.background_sound || 'office');
                              setNewAdminEmail(config.admin_email || config.notification_email || '');
                              setWhatsappEnabled(Boolean(config.whatsapp_enabled));
                              setWhatsappNumber(config.whatsapp_number || '');
                              setInstagramEnabled(Boolean(config.instagram_enabled));
                              setInstagramHandle(config.instagram_handle || '');
                              setSmsEnabled(Boolean(config.sms_enabled));
                              setSmsNumber(config.sms_number || '');
                              setFileUploadEnabled(Boolean(config.file_upload_enabled));
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="w-full bg-[#198fd9] hover:bg-[#157ab9] text-white border border-[#198fd9] py-2.5 px-3 rounded-xl text-xs font-bold transition-all shadow-sm text-center flex items-center justify-center gap-1.5"
                          >
                            ✏️ Edit Agent
                          </button>
                        </div>
                      </div>

                      {/* Right Card: Website Embed Snippet (Adjacent!) */}
                      <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-sm space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-[var(--awb-color8)] text-base flex items-center gap-2">
                            <span>⚡ Website Embed Snippet</span>
                          </h4>
                          <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2.5 py-0.5 rounded-full font-bold border border-emerald-200">
                            Ready to Embed
                          </span>
                        </div>
                        <p className="text-xs text-[var(--awb-color6)] leading-relaxed">
                          Copy and paste these script tags into your website HTML to launch your chatbot widget instantly.
                        </p>

                        <div className="space-y-4 pt-1">
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <label className="text-xs font-bold text-[var(--awb-color7)]">Floating Popup Widget</label>
                              <button
                                onClick={() => {
                                  const snippet = `<!-- StyleFlo Widget Injection -->\n<script\n  src="${window.location.origin}/widget.js"\n  data-api-host="${window.location.origin}"\n  data-bot-id="${bot.id}">\n</script>`;
                                  navigator.clipboard.writeText(snippet);
                                  alert('Popup Widget snippet copied to clipboard!');
                                }}
                                className="text-[11px] text-[#198fd9] hover:underline font-bold"
                              >
                                Copy Snippet 📋
                              </button>
                            </div>
                            <pre className="p-3 bg-[var(--awb-color2)] border border-[var(--awb-color3)] text-[11px] rounded-xl overflow-x-auto text-[var(--awb-color8)] font-mono leading-relaxed select-all">
                              {`<!-- StyleFlo Widget Injection -->\n<script\n  src="${window.location.origin}/widget.js"\n  data-api-host="${window.location.origin}"\n  data-bot-id="${bot.id}">\n</script>`}
                            </pre>
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <label className="text-xs font-bold text-[var(--awb-color7)]">Inline Page Embed</label>
                              <button
                                onClick={() => {
                                  const snippet = `<!-- StyleFlo Inline Embed -->\n<div id="styleflo-chatbot-container" style="width: 100%; height: 500px;"></div>\n<script\n  src="${window.location.origin}/embed.js"\n  data-api-host="${window.location.origin}"\n  data-bot-id="${bot.id}"\n  data-container-id="styleflo-chatbot-container">\n</script>`;
                                  navigator.clipboard.writeText(snippet);
                                  alert('Inline Embed snippet copied to clipboard!');
                                }}
                                className="text-[11px] text-[#198fd9] hover:underline font-bold"
                              >
                                Copy Snippet 📋
                              </button>
                            </div>
                            <pre className="p-3 bg-[var(--awb-color2)] border border-[var(--awb-color3)] text-[11px] rounded-xl overflow-x-auto text-[var(--awb-color8)] font-mono leading-relaxed select-all">
                              {`<!-- StyleFlo Inline Embed -->\n<div id="styleflo-chatbot-container" style="width: 100%; height: 500px;"></div>\n<script\n  src="${window.location.origin}/embed.js"\n  data-api-host="${window.location.origin}"\n  data-bot-id="${bot.id}"\n  data-container-id="styleflo-chatbot-container">\n</script>`}
                            </pre>
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              )}
              </div>

            {/* Delete Confirmation Modal */}
            {showDeleteModal && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                <div className="bg-white border border-[var(--awb-color3)] rounded-2xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-red-600"></div>
                  <h3 className="text-xl font-bold text-[var(--awb-color8)] mb-2">Delete Chatbot?</h3>
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
                    <p className="text-sm text-red-700 font-semibold mb-2">⚠️ Warning: This action cannot be undone.</p>
                    <p className="text-xs text-red-600 leading-relaxed">
                      This will permanently delete your chatbot, including any customer data collated by the chatbot, conversations, and any data stored in its knowledgebase.
                    </p>
                  </div>
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => setShowDeleteModal(null)}
                      disabled={isDeletingBot}
                      className="px-4 py-2 rounded-xl text-sm font-semibold text-[var(--awb-color6)] hover:text-[var(--awb-color7)] transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDeleteChatbot}
                      disabled={isDeletingBot}
                      className="px-5 py-2 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700 text-[var(--awb-color8)] shadow-md transition-all disabled:opacity-50 flex items-center gap-2"
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
