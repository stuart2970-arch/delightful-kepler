'use client';
import React, { useState } from 'react';

export default function ServiceEditor({ tenantId, services, setServices, staff }: any) {
  const [showAddService, setShowAddService] = useState(false);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceDescription, setNewServiceDescription] = useState('');
  const [newServiceDuration, setNewServiceDuration] = useState(30);
  const [newServiceBuffer, setNewServiceBuffer] = useState(0);
  const [newServicePrice, setNewServicePrice] = useState(0);
  const [newServiceStaff, setNewServiceStaff] = useState<any[]>([]);

  const handleEditClick = (srv: any) => {
    setEditingServiceId(srv.id);
    setNewServiceName(srv.name);
    setNewServiceDescription(srv.description || '');
    setNewServiceDuration(srv.duration_minutes || 30);
    setNewServiceBuffer(srv.buffer_minutes || 0);
    setNewServicePrice(srv.price || 0);
    setNewServiceStaff(srv.staff_services || []);
    setShowAddService(true);
  };

  const handleAddClick = () => {
    setEditingServiceId(null);
    setNewServiceName('');
    setNewServiceDescription('');
    setNewServiceDuration(30);
    setNewServiceBuffer(0);
    setNewServicePrice(0);
    setNewServiceStaff([]);
    setShowAddService(true);
  };

  const handleToggleStaff = (staffId: string) => {
    setNewServiceStaff(prev => {
      if (prev.find(s => s.staff_id === staffId)) {
        return prev.filter(s => s.staff_id !== staffId);
      } else {
        return [...prev, { staff_id: staffId, custom_price: '', custom_duration: '' }];
      }
    });
  };

  const handleUpdateStaffMapping = (staffId: string, field: string, value: string) => {
    setNewServiceStaff(prev => prev.map(s => {
      if (s.staff_id === staffId) {
        return { ...s, [field]: value };
      }
      return s;
    }));
  };

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const method = editingServiceId ? 'PUT' : 'POST';
      const body = {
        id: editingServiceId,
        tenant_id: tenantId,
        name: newServiceName,
        description: newServiceDescription,
        duration_minutes: newServiceDuration,
        buffer_minutes: newServiceBuffer,
        price: newServicePrice,
        assigned_staff: newServiceStaff.map(s => ({
          staff_id: s.staff_id,
          custom_price: s.custom_price ? parseFloat(s.custom_price) : null,
          custom_duration: s.custom_duration ? parseInt(s.custom_duration, 10) : null
        }))
      };

      const res = await fetch('/api/services', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const data = await res.json();
        if (editingServiceId) {
          setServices(services.map((s: any) => s.id === editingServiceId ? data.service : s));
        } else {
          setServices([...services, data.service]);
        }
        setShowAddService(false);
      } else {
        alert('Failed to save service');
      }
    } catch (err) {
      console.error(err);
      alert('Error saving service');
    }
  };

  const handleDeleteService = async (id: string) => {
    if (!confirm('Are you sure you want to delete this service?')) return;
    try {
      const res = await fetch(`/api/services?id=${id}&tenantId=${tenantId}`, { method: 'DELETE' });
      if (res.ok) {
        setServices(services.filter((s: any) => s.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl flex flex-col h-[600px] relative">
      {showAddService ? (
        <div className="absolute inset-0 bg-gray-950 p-6 rounded-2xl z-20 flex flex-col overflow-y-auto styleflo-scrollbar">
          <h3 className="text-lg font-bold text-white mb-4">{editingServiceId ? 'Edit Service' : 'Add New Service'}</h3>
          <form onSubmit={handleSaveService} className="flex-1 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Service Name</label>
              <input required type="text" value={newServiceName} onChange={e => setNewServiceName(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. Consultation" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Brief Description</label>
              <textarea maxLength={255} value={newServiceDescription} onChange={e => setNewServiceDescription(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white resize-none h-20" placeholder="Optional brief description of this service (max 255 chars)" />
              <div className="text-right text-[10px] text-gray-500 mt-1">{newServiceDescription.length}/255</div>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">Duration (mins)</label>
                <input required type="number" min="5" step="5" value={newServiceDuration} onChange={e => setNewServiceDuration(parseInt(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">Buffer (mins)</label>
                <input required type="number" min="0" step="5" value={newServiceBuffer} onChange={e => setNewServiceBuffer(parseInt(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">Base Price ($)</label>
                <input type="number" min="0" step="1" value={newServicePrice} onChange={e => setNewServicePrice(parseInt(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
            </div>

            <div className="mt-4 border-t border-gray-800 pt-4">
              <label className="block text-xs font-semibold text-gray-400 mb-2">Assigned Staff & Specializations</label>
              {staff.length === 0 ? (
                <div className="text-sm text-gray-600 italic">No staff added yet. Add staff first to assign them.</div>
              ) : (
                <div className="space-y-3">
                  {staff.map((st: any) => {
                    const isAssigned = newServiceStaff.find(s => s.staff_id === st.id);
                    return (
                      <div key={st.id} className="p-3 bg-gray-900 border border-gray-800 rounded-lg">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input type="checkbox" className="rounded border-gray-700 bg-gray-800 text-indigo-500 focus:ring-indigo-500" 
                            checked={!!isAssigned} 
                            onChange={() => handleToggleStaff(st.id)} 
                          />
                          <span className="text-sm text-white font-medium">{st.name}</span>
                        </label>
                        {isAssigned && (
                          <div className="mt-3 pl-7 grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] text-gray-500 mb-1">Override Price ($)</label>
                              <input type="number" placeholder="Default" value={isAssigned.custom_price || ''} onChange={e => handleUpdateStaffMapping(st.id, 'custom_price', e.target.value)} className="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-xs text-white" />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-500 mb-1">Override Duration (m)</label>
                              <input type="number" placeholder="Default" value={isAssigned.custom_duration || ''} onChange={e => handleUpdateStaffMapping(st.id, 'custom_duration', e.target.value)} className="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-xs text-white" />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-auto flex justify-end gap-3 pt-4">
              <button type="button" onClick={() => setShowAddService(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold">Save Service</button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">Services</h3>
        <button onClick={handleAddClick} className="bg-gray-800 hover:bg-gray-700 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors">
          + Add Service
        </button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 styleflo-scrollbar pr-2">
        {services.length === 0 ? (
          <div className="text-sm text-gray-500 italic text-center mt-10">No services configured yet.</div>
        ) : services.map((srv: any) => (
          <div key={srv.id} onClick={() => handleEditClick(srv)} className="bg-gray-950 border border-gray-800 p-4 rounded-xl flex items-center justify-between group hover:border-indigo-500/50 hover:bg-indigo-900/10 cursor-pointer transition-all">
            <div>
              <div className="font-bold text-gray-200 text-sm">{srv.name}</div>
              {srv.description && (
                <div className="text-xs text-gray-400 mt-0.5 line-clamp-1">{srv.description}</div>
              )}
              <div className="text-xs text-gray-500 mt-0.5">{srv.duration_minutes}m duration • ${srv.price || 0}</div>
              {srv.staff_services && srv.staff_services.length > 0 && (
                <div className="text-xs text-indigo-400 mt-1">
                  Assigned to {srv.staff_services.length} staff
                </div>
              )}
            </div>
            <button onClick={(e) => { e.stopPropagation(); handleDeleteService(srv.id); }} className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
