'use client';

import React, { useState, useEffect } from 'react';

type FloBotConfig = {
  name?: string;
  agentName?: string;
  agentRole?: string;
  primaryColor?: string;
  avatarUrl?: string | null;
  welcomeMessage?: string;
  voiceId?: string | null;
  voiceName?: string | null;
  voiceEnabled?: boolean;
  systemPrompt?: string;
};

type VoicePersona = {
  id: string;
  external_voice_id?: string;
  name: string;
  role?: string;
  gender?: string;
  nationality?: string;
  provider?: string;
  previewUrl?: string;
  preview_url?: string;
};

export default function FloBotProfileSettingsView({
  initialConfig
}: {
  initialConfig?: FloBotConfig | null;
}) {
  const [agentName, setAgentName] = useState(initialConfig?.agentName || 'Flo');
  const [agentRole, setAgentRole] = useState(initialConfig?.agentRole || 'StyleFlo AI Receptionist Builder');
  const [primaryColor, setPrimaryColor] = useState(initialConfig?.primaryColor || '#260475');
  const [avatarUrl, setAvatarUrl] = useState(initialConfig?.avatarUrl || '');
  const [welcomeMessage, setWelcomeMessage] = useState(
    initialConfig?.welcomeMessage || "Hi, I'm Flo, your AI registration assistant! Tell me, would you prefer to sign up using your Google account or an email address? (The Google sign-in button is at the top of this chat, or pass me your email address to get started!)"
  );
  
  const [voiceEnabled, setVoiceEnabled] = useState(initialConfig?.voiceEnabled ?? false);
  const [voiceId, setVoiceId] = useState(initialConfig?.voiceId || '');
  const [voiceName, setVoiceName] = useState(initialConfig?.voiceName || '');
  const [systemPrompt, setSystemPrompt] = useState(initialConfig?.systemPrompt || '');
  
  const [personas, setPersonas] = useState<VoicePersona[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [isLoadingPersonas, setIsLoadingPersonas] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch Voice Personas from /api/voice-personas
  useEffect(() => {
    async function loadPersonas() {
      setIsLoadingPersonas(true);
      try {
        const res = await fetch('/api/voice-personas');
        if (res.ok) {
          const data = await res.json();
          setPersonas(data || []);
          
          // Match initial voice ID if available
          if (initialConfig?.voiceId) {
            const match = data.find((p: VoicePersona) => p.id === initialConfig.voiceId || p.external_voice_id === initialConfig.voiceId);
            if (match) {
              setSelectedPersonaId(match.id);
              if (!initialConfig.voiceName) {
                setVoiceName(match.name);
              }
            }
          }
        }
      } catch (err) {
        console.error('Failed to load voice personas:', err);
      } finally {
        setIsLoadingPersonas(false);
      }
    }
    loadPersonas();
  }, [initialConfig]);

  const handlePersonaSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pId = e.target.value;
    setSelectedPersonaId(pId);
    if (!pId) {
      setVoiceId('');
      setVoiceName('');
      return;
    }

    const persona = personas.find(p => p.id === pId);
    if (persona) {
      const vId = persona.external_voice_id || persona.id;
      setVoiceId(vId);
      setVoiceName(persona.name);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('tenantId', '00000000-0000-0000-0000-000000000000');

      const res = await fetch('/api/chatbots/upload-avatar', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Avatar upload failed');

      const uploadedUrl = data.avatarUrl || data.url;
      setAvatarUrl(uploadedUrl);
      setMessage({ type: 'success', text: 'Avatar uploaded successfully!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Failed to upload avatar' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage(null);

    try {
      const flobot_config: FloBotConfig = {
        name: `${agentName}Bot`,
        agentName,
        agentRole,
        primaryColor,
        avatarUrl: avatarUrl || null,
        welcomeMessage,
        voiceId: voiceId || null,
        voiceName: voiceName || null,
        voiceEnabled,
        systemPrompt: systemPrompt || undefined,
      };

      const res = await fetch('/api/superadmin/global-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flobot_config }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update FloBot settings');

      setMessage({ type: 'success', text: 'FloBot Onboarding Profile & Voice Persona updated successfully!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Failed to save FloBot settings' });
    } finally {
      setIsSaving(false);
    }
  };

  const activePersona = personas.find(p => p.id === selectedPersonaId || p.external_voice_id === voiceId);

  return (
    <div className="bg-gray-900 border border-gray-800 p-6 rounded-2xl shadow-xl space-y-6">
      <div className="flex items-center justify-between border-b border-gray-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>⚡</span> FloBot Onboarding Profile & Voice Settings
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Customize the system-wide onboarding FloBot assistant picture, StyleFlo Voice Persona, role, and welcome greeting across styleflo.ai/onboard.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div 
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold border border-white/20 overflow-hidden shadow"
            style={{ backgroundColor: primaryColor }}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="FloBot" className="w-full h-full object-cover" />
            ) : (
              agentName.charAt(0) || 'F'
            )}
          </div>
        </div>
      </div>

      {message && (
        <div className={`p-3 rounded-xl text-xs font-semibold ${
          message.type === 'success' ? 'bg-emerald-950/80 border border-emerald-500/30 text-emerald-400' : 'bg-rose-950/80 border border-rose-500/30 text-rose-400'
        }`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        {/* Avatar Picture Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-950/50 p-4 rounded-xl border border-gray-800">
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-2">Profile Picture / Avatar</label>
            <div className="flex items-center gap-4">
              <div 
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-lg border border-gray-700 overflow-hidden shrink-0 shadow-md"
                style={{ backgroundColor: primaryColor }}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="FloBot Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span>⚡</span>
                )}
              </div>
              <div className="space-y-1.5 flex-1">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  disabled={isUploading}
                  className="block w-full text-xs text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 cursor-pointer"
                />
                <p className="text-[10px] text-gray-500">Max size 2MB (PNG, JPG, SVG)</p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1.5">Direct Image URL (Optional Override)</label>
            <input
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://example.com/avatar.png"
              className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Identity & Branding */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1.5">Agent Display Name</label>
            <input
              type="text"
              required
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1.5">Agent Role Title</label>
            <input
              type="text"
              required
              value={agentRole}
              onChange={(e) => setAgentRole(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1.5">Primary Theme Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-9 h-9 rounded-lg border border-gray-700 bg-transparent cursor-pointer"
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="flex-1 bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white font-mono uppercase focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Welcome Greeting */}
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1.5">Welcome Greeting Message</label>
          <textarea
            rows={2}
            value={welcomeMessage}
            onChange={(e) => setWelcomeMessage(e.target.value)}
            className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* StyleFlo Voice Persona Selection */}
        <div className="bg-gray-950/50 p-5 rounded-xl border border-gray-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>🎙️</span> StyleFlo Voice Persona & Speech Settings
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">Select a pre-recorded UK voice persona or enter a custom Vapi Voice ID</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={voiceEnabled}
                onChange={(e) => setVoiceEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          {voiceEnabled && (
            <div className="space-y-4 pt-2 border-t border-gray-800">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Voice Persona Dropdown */}
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                    Select Voice Persona {isLoadingPersonas && '(Loading...)'}
                  </label>
                  <select
                    value={selectedPersonaId}
                    onChange={handlePersonaSelect}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">-- Custom / Manual Voice ID --</option>
                    {personas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.gender || 'Voice'}, {p.nationality || 'GB'})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Custom Voice Name */}
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1.5">Custom Voice Label / Name</label>
                  <input
                    type="text"
                    value={voiceName}
                    onChange={(e) => setVoiceName(e.target.value)}
                    placeholder="e.g. Flo's British Receptionist Voice"
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Vapi External Voice ID */}
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1.5">Vapi External Voice ID</label>
                <input
                  type="text"
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  placeholder="e.g. c8MZcZcr0JnMAwkwnTIu or vapi-voice-id"
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Audio Preview Player */}
              {activePersona && (activePersona.preview_url || activePersona.previewUrl) && (
                <div className="bg-gray-900 p-3 rounded-xl border border-gray-800 space-y-2">
                  <p className="text-[11px] font-semibold text-indigo-400 flex items-center gap-1.5">
                    🔊 Audio Recording Sample: <span className="text-white font-bold">{activePersona.name}</span>
                  </p>
                  <audio 
                    controls 
                    src={activePersona.preview_url || activePersona.previewUrl} 
                    className="w-full h-8" 
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* System Prompt Override */}
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1.5">System Prompt Instructions (Optional Override)</label>
          <textarea
            rows={4}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Leave empty to use standard 6-State Onboarding system prompt..."
            className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-xs text-white font-mono placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving ? 'Saving Changes...' : 'Save FloBot Onboarding Profile'}
          </button>
        </div>
      </form>
    </div>
  );
}
