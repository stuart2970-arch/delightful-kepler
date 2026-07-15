'use client';

import React, { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function SuperAdminVoiceManagerView() {
  const [personas, setPersonas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    external_voice_id: '',
    name: '',
    role: '',
    gender: 'Female',
    preview_url: '',
    nationality: 'US',
    provider: '11labs'
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

  const fetchPersonas = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/voice-personas');
      if (!res.ok) throw new Error('Failed to load personas');
      const data = await res.json();
      setPersonas(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPersonas();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        const res = await fetch(`/api/voice-personas/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
        if (!res.ok) throw new Error('Failed to update persona');
      } else {
        const res = await fetch('/api/voice-personas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
        if (!res.ok) throw new Error('Failed to create persona');
      }
      setEditingId(null);
      setFormData({
        external_voice_id: '',
        name: '',
        role: '',
        gender: 'Female',
        preview_url: '',
        nationality: 'US',
        provider: '11labs'
      });
      fetchPersonas();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this voice persona?')) return;
    try {
      const res = await fetch(`/api/voice-personas/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete persona');
      fetchPersonas();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">Voice Personas Mapping</h2>
        <button
          onClick={() => {
            setEditingId(null);
            setFormData({
              external_voice_id: '',
              name: '',
              role: '',
              gender: 'Female',
              preview_url: '',
              nationality: 'US',
              provider: '11labs'
            });
          }}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Clear Form
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form Panel */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 h-fit">
          <h3 className="text-sm font-bold text-gray-300 mb-4">{editingId ? 'Edit Persona' : 'Add New Persona'}</h3>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Display Name</label>
              <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm text-white" placeholder="e.g. British Female - Crisp" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">External Voice ID (ElevenLabs / PlayHT)</label>
              <input required type="text" value={formData.external_voice_id} onChange={e => setFormData({...formData, external_voice_id: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm text-white" placeholder="e.g. zrHiDhphv9ZnVBTiNxbM" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">Gender</label>
                <select value={formData.gender} onChange={e => setFormData({...formData, gender: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm text-white">
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">Provider</label>
                <select value={formData.provider} onChange={e => setFormData({...formData, provider: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm text-white">
                  <option value="11labs">ElevenLabs</option>
                  <option value="playht">PlayHT</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Role / Vibe</label>
              <input type="text" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm text-white" placeholder="e.g. Corporate, Executive" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Nationality</label>
              <input type="text" value={formData.nationality} onChange={e => setFormData({...formData, nationality: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm text-white" placeholder="e.g. British" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Preview Audio URL</label>
              <input type="text" value={formData.preview_url} onChange={e => setFormData({...formData, preview_url: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm text-white" placeholder="/audio/sample.mp3" />
            </div>
            <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors mt-2">
              {editingId ? 'Update Persona' : 'Create Persona'}
            </button>
          </form>
        </div>

        {/* List Panel */}
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-gray-500">Loading personas...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-300">
                <thead className="bg-gray-950/50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Display Name</th>
                    <th className="px-4 py-3">External ID</th>
                    <th className="px-4 py-3">Provider</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {personas.map((p: any) => (
                    <tr key={p.id} className="hover:bg-gray-800/30">
                      <td className="px-4 py-3 font-medium text-white">{p.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-indigo-300">{p.external_voice_id}</td>
                      <td className="px-4 py-3">{p.provider}</td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button onClick={() => {
                          setEditingId(p.id);
                          setFormData({
                            external_voice_id: p.external_voice_id || '',
                            name: p.name || '',
                            role: p.role || '',
                            gender: p.gender || 'Female',
                            preview_url: p.preview_url || '',
                            nationality: p.nationality || '',
                            provider: p.provider || '11labs'
                          });
                        }} className="text-blue-400 hover:text-blue-300 text-xs">Edit</button>
                        <button onClick={() => handleDelete(p.id)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                      </td>
                    </tr>
                  ))}
                  {personas.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">No voice personas found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
