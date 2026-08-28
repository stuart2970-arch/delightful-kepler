'use client';

import React, { useState } from 'react';

type FloBotConfig = {
  name?: string;
  agentName?: string;
  agentRole?: string;
  primaryColor?: string;
  avatarUrl?: string | null;
  welcomeMessage?: string;
  voiceId?: string | null;
  voiceEnabled?: boolean;
  systemPrompt?: string;
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
    initialConfig?.welcomeMessage || "Hi, I'm Flo! I'm your StyleFlo AI assistant builder. Let's create your account and get your AI receptionist ready in under 60 seconds!"
  );
  const [voiceId, setVoiceId] = useState(initialConfig?.voiceId || '');
  const [voiceEnabled, setVoiceEnabled] = useState(initialConfig?.voiceEnabled ?? false);
  const [systemPrompt, setSystemPrompt] = useState(initialConfig?.systemPrompt || '');
  
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

      setAvatarUrl(data.avatarUrl);
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

      setMessage({ type: 'success', text: 'FloBot Onboarding Profile updated successfully!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Failed to save FloBot settings' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 p-6 rounded-2xl shadow-xl space-y-6">
      <div className="flex items-center justify-between border-b border-gray-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>⚡</span> FloBot Onboarding Profile & Voice Settings
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Customize the system-wide onboarding FloBot assistant picture, voice, role, and welcome greeting across styleflo.ai/onboard.
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

        {/* Voice Customization */}
        <div className="bg-gray-950/50 p-4 rounded-xl border border-gray-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-white">Voice Conversation Settings</h3>
              <p className="text-[11px] text-gray-400">Enable voice calls or speech synthesis for FloBot</p>
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
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5">Vapi / Voice Persona ID</label>
              <input
                type="text"
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                placeholder="e.g. 21m00Tcm4TlvDq8ikWAM or vapi-voice-id"
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              />
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
