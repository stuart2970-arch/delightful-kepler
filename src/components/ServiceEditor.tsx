'use client';
import React, { useState } from 'react';
import { useDashboardStore } from '../lib/store';

export default function ServiceEditor({ tenantId, chatbotId, services, setServices, staff }: any) {
  const { chatbots, setChatbots } = useDashboardStore();
  const [showAddService, setShowAddService] = useState(false);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceDescription, setNewServiceDescription] = useState('');
  const [newServiceDuration, setNewServiceDuration] = useState(30);
  const [newServiceBuffer, setNewServiceBuffer] = useState(0);
  const [newServicePrice, setNewServicePrice] = useState(0);
  const [newServiceStaff, setNewServiceStaff] = useState<any[]>([]);
  
  // Drag & drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const activeChatbot = chatbots.find((b: any) => b.id === chatbotId);
  const orderedIds = activeChatbot?.configuration_json?.ordered_service_ids || [];

  // Sort services based on orderedIds list
  const sortedServices = [...services].sort((a: any, b: any) => {
    const indexA = orderedIds.indexOf(a.id);
    const indexB = orderedIds.indexOf(b.id);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return 0;
  });

  const handleSaveServiceOrder = async (orderedIdsList: string[]) => {
    if (!activeChatbot) return;

    const updatedConfig = {
      ...activeChatbot.configuration_json,
      ordered_service_ids: orderedIdsList
    };

    try {
      const res = await fetch(`/api/chatbots/${encodeURIComponent(chatbotId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: activeChatbot.name,
          primary_color: activeChatbot.primary_color,
          configuration_json: updatedConfig
        })
      });
      if (res.ok) {
        setChatbots(chatbots.map(b => b.id === chatbotId ? {
          ...b,
          configuration_json: updatedConfig
        } : b));
      } else {
        console.error('Failed to save service order to chatbot configuration');
      }
    } catch (err) {
      console.error('Error saving service order:', err);
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const reordered = [...sortedServices];
    const [removed] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, removed);

    // Keep other chatbots' services intact if present
    const otherServices = services.filter((s: any) => s.chatbot_id !== chatbotId && s.chatbot_id);
    const newServicesList = [...reordered, ...otherServices];
    setServices(newServicesList);

    const newOrderedIds = reordered.map(s => s.id);
    await handleSaveServiceOrder(newOrderedIds);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

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
        chatbot_id: chatbotId,
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
          if (activeChatbot) {
            const newOrderedIds = [...orderedIds, data.service.id];
            await handleSaveServiceOrder(newOrderedIds);
          }
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
        if (activeChatbot) {
          const newOrderedIds = orderedIds.filter((sid: string) => sid !== id);
          await handleSaveServiceOrder(newOrderedIds);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl flex flex-col h-[600px] relative">
      {showAddService ? (
        <div className="absolute inset-0 bg-[var(--awb-color1)] text-[var(--awb-color8)] border-[var(--awb-color3)] p-6 rounded-2xl z-20 flex flex-col overflow-y-auto styleflo-scrollbar">
          <h3 className="text-lg font-bold text-[var(--awb-color8)] mb-4">{editingServiceId ? 'Edit Service' : 'Add New Service'}</h3>
          <form onSubmit={handleSaveService} className="flex-1 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--awb-color6)] mb-1">Service Name</label>
              <input required type="text" value={newServiceName} onChange={e => setNewServiceName(e.target.value)} className="w-full bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-lg px-3 py-2 text-sm text-[var(--awb-color8)]" placeholder="e.g. Consultation" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--awb-color6)] mb-1">Brief Description</label>
              <textarea maxLength={255} value={newServiceDescription} onChange={e => setNewServiceDescription(e.target.value)} className="w-full bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-lg px-3 py-2 text-sm text-[var(--awb-color8)] resize-none h-20" placeholder="Optional brief description of this service (max 255 chars)" />
              <div className="text-right text-[10px] text-[var(--awb-color6)] mt-1">{newServiceDescription.length}/255</div>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--awb-color6)] mb-1">Duration (mins)</label>
                <input required type="number" min="5" step="5" value={newServiceDuration} onChange={e => setNewServiceDuration(parseInt(e.target.value))} className="w-full bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-lg px-3 py-2 text-sm text-[var(--awb-color8)]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--awb-color6)] mb-1">Buffer (mins)</label>
                <input required type="number" min="0" step="5" value={newServiceBuffer} onChange={e => setNewServiceBuffer(parseInt(e.target.value))} className="w-full bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-lg px-3 py-2 text-sm text-[var(--awb-color8)]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--awb-color6)] mb-1">Base Price ($)</label>
                <input type="number" min="0" step="1" value={newServicePrice} onChange={e => setNewServicePrice(parseInt(e.target.value))} className="w-full bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-lg px-3 py-2 text-sm text-[var(--awb-color8)]" />
              </div>
            </div>

            <div className="mt-4 border-t border-[var(--awb-color3)] pt-4">
              <label className="block text-xs font-semibold text-[var(--awb-color6)] mb-2">Assigned Staff & Specializations</label>
              {staff.length === 0 ? (
                <div className="text-sm text-gray-600 italic">No staff added yet. Add staff first to assign them.</div>
              ) : (
                <div className="space-y-3">
                  {staff.map((st: any) => {
                    const isAssigned = newServiceStaff.find(s => s.staff_id === st.id);
                    return (
                      <div key={st.id} className="p-3 bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-lg">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input type="checkbox" className="rounded border-[var(--awb-color3)] bg-[var(--awb-color2)] text-[var(--awb-color8)] text-indigo-500 focus:ring-indigo-500" 
                            checked={!!isAssigned} 
                            onChange={() => handleToggleStaff(st.id)} 
                          />
                          <span className="text-sm text-[var(--awb-color8)] font-medium">{st.name}</span>
                        </label>
                        {isAssigned && (
                          <div className="mt-3 pl-7 grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] text-[var(--awb-color6)] mb-1">Override Price ($)</label>
                              <input type="number" placeholder="Default" value={isAssigned.custom_price || ''} onChange={e => handleUpdateStaffMapping(st.id, 'custom_price', e.target.value)} className="w-full bg-white border border-[#f2f3f5] rounded px-2 py-1.5 text-xs text-[var(--awb-color8)]" />
                            </div>
                            <div>
                              <label className="block text-[10px] text-[var(--awb-color6)] mb-1">Override Duration (m)</label>
                              <input type="number" placeholder="Default" value={isAssigned.custom_duration || ''} onChange={e => handleUpdateStaffMapping(st.id, 'custom_duration', e.target.value)} className="w-full bg-white border border-[#f2f3f5] rounded px-2 py-1.5 text-xs text-[var(--awb-color8)]" />
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
              <button type="button" onClick={() => setShowAddService(false)} className="px-4 py-2 text-sm text-[var(--awb-color6)] hover:text-[var(--awb-color8)]">Cancel</button>
              <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-[var(--awb-color8)] rounded-lg font-bold">Save Service</button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-[var(--awb-color8)]">Services</h3>
        <button onClick={handleAddClick} className="bg-[var(--awb-color2)] text-[var(--awb-color8)] hover:bg-gray-700 text-[var(--awb-color8)] text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors">
          + Add Service
        </button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 styleflo-scrollbar pr-2">
        {sortedServices.length === 0 ? (
          <div className="text-sm text-[var(--awb-color6)] italic text-center mt-10">No services configured yet.</div>
        ) : sortedServices.map((srv: any, index: number) => (
          <div 
            key={srv.id} 
            draggable={true}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            onClick={() => handleEditClick(srv)} 
            className={`bg-white border p-4 rounded-xl flex items-center justify-between group hover:border-indigo-500/50 hover:bg-indigo-900/10 cursor-pointer transition-all ${
              draggedIndex === index ? 'opacity-30 border-dashed border-indigo-500' : 'border-[#f2f3f5]'
            }`}
          >
            <div className="flex items-center flex-1 min-w-0">
              <div 
                className="text-gray-400 hover:text-gray-200 cursor-grab active:cursor-grabbing mr-2 flex items-center shrink-0" 
                onClick={(e) => e.stopPropagation()}
                title="Drag to reorder"
              >
                <svg className="w-5 h-5 opacity-40 group-hover:opacity-100 transition-opacity" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm6-12c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
                </svg>
              </div>
              <div className="truncate">
                <div className="font-bold text-gray-200 text-sm truncate">{srv.name}</div>
                {srv.description && (
                  <div className="text-xs text-[var(--awb-color6)] mt-0.5 line-clamp-1 truncate">{srv.description}</div>
                )}
                <div className="text-xs text-[var(--awb-color6)] mt-0.5">{srv.duration_minutes}m duration • ${srv.price || 0}</div>
                {srv.staff_services && srv.staff_services.length > 0 && (
                  <div className="text-xs text-indigo-400 mt-1">
                    Assigned to {srv.staff_services.length} staff
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-4">
              <button onClick={(e) => { e.stopPropagation(); handleEditClick(srv); }} className="text-gray-400 hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Edit Service">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
              </button>
              <button onClick={(e) => { e.stopPropagation(); handleDeleteService(srv.id); }} className="text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete Service">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
