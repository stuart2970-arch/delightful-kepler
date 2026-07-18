import React, { useState } from 'react';
import { useDashboardStore, DailySchedule, WeeklySchedule } from '../../lib/store';
import ServiceEditor from '../ServiceEditor';

export default function SchedulingView() {
  const { tenantId, chatbots, services, setServices, staff, setStaff, bookingMode, setBookingMode, bookingUrl, setBookingUrl, isGoogleConnected, setIsGoogleConnected } = useDashboardStore();

  const realBots = chatbots.filter(b => b.id !== '00000000-0000-0000-0000-000000000000' && b.id !== 'global');
  const [targetChatbotId, setTargetChatbotId] = useState(realBots[0]?.id || '');

  React.useEffect(() => {
    if (!targetChatbotId && realBots.length > 0) {
      setTargetChatbotId(realBots[0].id);
    }
  }, [chatbots, targetChatbotId]);

  const filteredServices = services.filter(s => s.chatbot_id === targetChatbotId);
  const filteredStaff = staff.filter(s => s.chatbot_id === targetChatbotId);

  const [activeWeekIndex, setActiveWeekIndex] = useState(0);
  const [isSavingBookingMode, setIsSavingBookingMode] = useState(false);

  const handleSaveBookingMode = async () => {
    setIsSavingBookingMode(true);
    try {
      const res = await fetch('/api/tenants/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, bookingMode, bookingUrl })
      });
      if (res.ok) {
        alert('Booking settings saved successfully!');
      } else {
        alert('Failed to save booking settings.');
      }
    } catch (err) {
      console.error('Failed to save booking settings', err);
      alert('An error occurred while saving.');
    } finally {
      setIsSavingBookingMode(false);
    }
  };
  const handleDisconnectCalendar = async () => {};
  const [isFetchingScheduling, setIsFetchingScheduling] = useState(false);

  const [showAddService, setShowAddService] = useState(false);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceDuration, setNewServiceDuration] = useState(30);
  const [newServiceBuffer, setNewServiceBuffer] = useState(0);

  const [showStaffModal, setShowStaffModal] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffCalId, setNewStaffCalId] = useState('');

  const createEmptySchedule = (weekDate?: string): WeeklySchedule => ({
    weekCommencingDate: weekDate || new Date().toISOString().split('T')[0],
    monday: { unavailable: false, am: null, pm: null },
    tuesday: { unavailable: false, am: null, pm: null },
    wednesday: { unavailable: false, am: null, pm: null },
    thursday: { unavailable: false, am: null, pm: null },
    friday: { unavailable: false, am: null, pm: null },
    saturday: { unavailable: false, am: null, pm: null },
    sunday: { unavailable: false, am: null, pm: null },
  });

  const [newStaffSchedule, setNewStaffSchedule] = useState<{weeks: WeeklySchedule[]}>({
    weeks: [
      createEmptySchedule(),
      createEmptySchedule(),
      createEmptySchedule(),
      createEmptySchedule()
    ]
  });

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          chatbot_id: targetChatbotId,
          name: newServiceName,
          duration_minutes: newServiceDuration,
          buffer_minutes: newServiceBuffer
        })
      });
      if (res.ok) {
        const data = await res.json();
        setServices([...services, data.service]);
        setShowAddService(false);
        setNewServiceName('');
        setNewServiceDuration(30);
        setNewServiceBuffer(0);
      } else {
        alert('Failed to add service');
      }
    } catch (err) {
      console.error(err);
      alert('Error adding service');
    }
  };

  const handleDeleteService = async (id: string) => {
    if (!confirm('Are you sure you want to delete this service?')) return;
    try {
      const res = await fetch(`/api/services?id=${id}&tenantId=${tenantId}`, { method: 'DELETE' });
      if (res.ok) {
        setServices(services.filter(s => s.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleScheduleChange = (day: keyof Omit<WeeklySchedule, 'weekCommencingDate'>, shift: 'am' | 'pm', field: 'start' | 'end', value: string) => {
    setNewStaffSchedule(prev => {
      const newWeeks = [...prev.weeks];
      const activeWeek = { ...newWeeks[activeWeekIndex] };
      
      const newSched = { ...activeWeek };
      if (!newSched[day][shift]) {
        if (!value) return prev; // if empty string and null, do nothing
        newSched[day][shift] = { start: '', end: '' };
      }
      if (value) {
        newSched[day][shift]![field] = value;
      } else {
        // If clearing, and the other field is also empty, set back to null
        newSched[day][shift]![field] = '';
        if (!newSched[day][shift]!.start && !newSched[day][shift]!.end) {
          newSched[day][shift] = null;
        }
      }
      newWeeks[activeWeekIndex] = newSched;
      return { weeks: newWeeks };
    });
  };

  const handleUnavailableChange = (day: keyof Omit<WeeklySchedule, 'weekCommencingDate'>, checked: boolean) => {
    setNewStaffSchedule(prev => {
      const newWeeks = [...prev.weeks];
      const activeWeek = { ...newWeeks[activeWeekIndex] };
      const newSched = { ...activeWeek };
      
      newSched[day] = { ...newSched[day], unavailable: checked };
      if (checked) {
        // Clear times if marking unavailable
        newSched[day].am = null;
        newSched[day].pm = null;
      }
      
      newWeeks[activeWeekIndex] = newSched;
      return { weeks: newWeeks };
    });
  }

  const handleDateChange = (dateStr: string) => {
    const selectedDate = new Date(dateStr);
    // Enforce Monday selection (getDay() === 1)
    if (selectedDate.getDay() !== 1) {
      alert('Please select a Monday for the week commencing date.');
      return;
    }
    
    setNewStaffSchedule(prev => {
      const newWeeks = [...prev.weeks];
      newWeeks[activeWeekIndex] = { ...newWeeks[activeWeekIndex], weekCommencingDate: dateStr };
      return { weeks: newWeeks };
    });
  }

  const copyToNextWeek = () => {
    if (activeWeekIndex >= 3) {
      alert('You can only copy to the next week within the 4-week window.');
      return;
    }
    setNewStaffSchedule(prev => {
      const newWeeks = [...prev.weeks];
      const currentWeek = newWeeks[activeWeekIndex];
      
      // Calculate next week's date (+7 days)
      const currentDate = new Date(currentWeek.weekCommencingDate);
      currentDate.setDate(currentDate.getDate() + 7);
      const nextWeekDateStr = currentDate.toISOString().split('T')[0];
      
      // Copy structure but not the weekCommencingDate
      newWeeks[activeWeekIndex + 1] = {
        ...JSON.parse(JSON.stringify(currentWeek)),
        weekCommencingDate: nextWeekDateStr
      };
      
      return { weeks: newWeeks };
    });
    // Auto switch to the next week tab
    setActiveWeekIndex(activeWeekIndex + 1);
  };

  const openEditStaff = (staffMember: any) => {
    setEditingStaffId(staffMember.id);
    setNewStaffName(staffMember.name);
    setNewStaffEmail(staffMember.email);
    setNewStaffCalId(staffMember.google_calendar_id === 'primary' ? '' : staffMember.google_calendar_id);
    
    // Load existing weeks or create empty ones
    const existingWeeks = staffMember.working_days?.weeks || [];
    const weeksToLoad = [];
    for (let i = 0; i < 4; i++) {
      if (existingWeeks[i]) {
        weeksToLoad.push(existingWeeks[i]);
      } else {
        weeksToLoad.push(createEmptySchedule());
      }
    }
    
    setNewStaffSchedule({ weeks: weeksToLoad });
    setActiveWeekIndex(0);
    setShowStaffModal(true);
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const isUpdate = !!editingStaffId;
      const method = isUpdate ? 'PUT' : 'POST';
      const bodyPayload: any = {
        tenant_id: tenantId,
        chatbot_id: targetChatbotId,
        name: newStaffName,
        email: newStaffEmail,
        google_calendar_id: newStaffCalId || 'primary',
        working_days: newStaffSchedule
      };
      if (isUpdate) {
        bodyPayload.id = editingStaffId;
      }

      const res = await fetch('/api/staff', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });
      if (res.ok) {
        const data = await res.json();
        if (isUpdate) {
          setStaff(staff.map(s => s.id === editingStaffId ? data.staff : s));
        } else {
          setStaff([...staff, data.staff]);
        }
        setShowStaffModal(false);
        setEditingStaffId(null);
        setNewStaffName('');
        setNewStaffEmail('');
        setNewStaffCalId('');
        setNewStaffSchedule({
          weeks: [createEmptySchedule(), createEmptySchedule(), createEmptySchedule(), createEmptySchedule()]
        });
        setActiveWeekIndex(0);
      } else {
        alert(isUpdate ? 'Failed to update staff' : 'Failed to add staff');
      }
    } catch (err) {
      console.error(err);
      alert('Error saving staff');
    }
  };

  const handleDeleteStaff = async (id: string) => {
    if (!confirm('Are you sure you want to delete this staff member?')) return;
    try {
      const res = await fetch(`/api/staff?id=${id}&tenantId=${tenantId}`, { method: 'DELETE' });
      if (res.ok) {
        setStaff(staff.filter(s => s.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <>
          {true && (
            <div className="space-y-6">

              <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-white">Scheduling & Calendar</h3>
                  <p className="text-xs text-gray-400 mt-1">Configure your booking mode and manage external calendar connections.</p>
                </div>

                <div className="bg-gray-950 border border-gray-800 p-4 rounded-xl">
                  <h4 className="text-sm font-bold text-gray-200 mb-3">Operating Booking Mode</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    {[
                      { id: 'walk_in_only', label: 'Walk-ins Only', desc: 'No appointments. Bots tell users to just walk in.' },
                      { id: 'single_calendar', label: 'Single Unified Calendar', desc: 'All bookings drop into one central Google Calendar.' },
                      { id: 'multi_calendar', label: 'Multi-Calendar (Per Staff)', desc: 'Bookings map to individual Google Calendars per staff.' },
                      { id: 'external_platform', label: 'External Booking Link', desc: 'Use an existing system like Vagaro or Fresha.' }
                    ].map(mode => (
                      <label key={mode.id} className={`flex flex-col p-3 rounded-xl border cursor-pointer transition-colors ${
                        bookingMode === mode.id ? 'bg-indigo-950/30 border-indigo-500/50' : 'bg-gray-900/50 border-gray-800 hover:border-gray-700'
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <input type="radio" name="bookingMode" value={mode.id} checked={bookingMode === mode.id} onChange={(e) => setBookingMode(e.target.value)} className="text-indigo-600 bg-gray-900 border-gray-700 focus:ring-indigo-600 focus:ring-offset-gray-900" />
                          <span className="text-sm font-bold text-gray-200">{mode.label}</span>
                        </div>
                        <span className="text-[10px] text-gray-400 pl-6">{mode.desc}</span>
                      </label>
                    ))}
                  </div>
                  
                  {bookingMode === 'external_platform' && (
                    <div className="mb-4 pl-1">
                      <label className="block text-xs font-semibold text-gray-400 mb-1">External Booking URL</label>
                      <input type="url" value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none" placeholder="https://www.fresha.com/a/your-salon" />
                    </div>
                  )}
                  
                  <button onClick={handleSaveBookingMode} disabled={isSavingBookingMode} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50">
                    {isSavingBookingMode ? 'Saving...' : 'Save Booking Mode'}
                  </button>
                </div>

                {bookingMode !== 'walk_in_only' && bookingMode !== 'external_platform' && (
                  <div className="bg-gray-950 border border-gray-800 p-4 rounded-xl flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-gray-200">Google Calendar Status</h4>
                      <p className="text-xs text-gray-400 mt-0.5">Authorize the primary workspace calendar to push and pull appointments.</p>
                      {isGoogleConnected && (
                        <div className="inline-flex items-center gap-1.5 mt-2 bg-emerald-950/40 text-emerald-400 text-[10px] px-2 py-1 rounded-full border border-emerald-500/20 font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          Connected & Syncing
                        </div>
                      )}
                    </div>
                    <div>
                      {isGoogleConnected ? (
                        <div className="flex flex-col items-end gap-2">
                          <button onClick={handleDisconnectCalendar} className="text-xs text-red-400 hover:text-red-300 font-semibold transition-colors">
                            Disconnect
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => window.location.href = `/api/integrations/google/authorize?tenantId=${tenantId}`}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg transition-colors flex items-center gap-2"
                        >
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574s3.345-7.574 7.439-7.574c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z"/>
                          </svg>
                          Connect Calendar
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {bookingMode !== 'walk_in_only' && bookingMode !== 'external_platform' && (
                <div className="bg-gray-950 border border-gray-800 p-4 rounded-xl">
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5">Target Chatbot for Scheduling</label>
                  <select
                    value={targetChatbotId}
                    onChange={(e) => setTargetChatbotId(e.target.value)}
                    className="w-full md:w-1/3 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    required
                  >
                    <option value="" disabled>Select chatbot...</option>
                    {realBots.map((bot) => (
                      <option key={bot.id} value={bot.id}>
                        {bot.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {bookingMode !== 'walk_in_only' && bookingMode !== 'external_platform' && targetChatbotId && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Services List using ServiceEditor */}
                  <ServiceEditor 
                    tenantId={tenantId} 
                    services={filteredServices} 
                    setServices={setServices} 
                    staff={filteredStaff} 
                  />

                  {/* Staff List */}
                  <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl flex flex-col h-[500px] relative lg:col-span-2">
                    {showStaffModal ? (
                      <div className="absolute inset-0 bg-gray-950 p-6 rounded-2xl z-10 flex flex-col overflow-y-auto styleflo-scrollbar">
                        <h3 className="text-lg font-bold text-white mb-4">
                          {editingStaffId ? 'Edit Staff Member' : 'Add Staff Member'}
                        </h3>
                        <form onSubmit={handleSaveStaff} className="flex-1 flex flex-col gap-6">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-gray-400 mb-1">Name</label>
                              <input required type="text" value={newStaffName} onChange={e => setNewStaffName(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. John Doe" />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-400 mb-1">Email</label>
                              <input required type="email" value={newStaffEmail} onChange={e => setNewStaffEmail(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" placeholder="john@example.com" />
                            </div>
                            {bookingMode === 'multi_calendar' && (
                              <div>
                                <label className="block text-xs font-semibold text-gray-400 mb-1">Google Calendar ID</label>
                                <input type="text" value={newStaffCalId} onChange={e => setNewStaffCalId(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" placeholder="Defaults to 'primary'" />
                              </div>
                            )}
                          </div>

                        {/* Schedule Spreadsheet Grid */}
                        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden flex flex-col">
                          {/* Week Tabs */}
                          <div className="flex border-b border-gray-800">
                            {[0, 1, 2, 3].map(weekIdx => (
                              <button
                                key={weekIdx}
                                type="button"
                                onClick={() => setActiveWeekIndex(weekIdx)}
                                className={`flex-1 py-2 text-xs font-bold transition-colors ${activeWeekIndex === weekIdx ? 'bg-indigo-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
                              >
                                Week {weekIdx + 1}
                              </button>
                            ))}
                          </div>
                          
                          <div className="flex items-center justify-between bg-gray-800/30 px-4 py-3 border-b border-gray-800">
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-bold text-gray-200">Week Commencing (Monday)</span>
                              <input 
                                type="date" 
                                required
                                value={newStaffSchedule.weeks[activeWeekIndex].weekCommencingDate}
                                onChange={e => handleDateChange(e.target.value)}
                                className="bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-xs text-white focus:border-indigo-500 outline-none"
                              />
                            </div>
                          </div>
                          
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-gray-900 text-[10px] text-gray-400 uppercase tracking-wider border-b border-gray-800">
                                <th className="p-3 font-semibold w-24">Day</th>
                                <th className="p-3 font-semibold text-center border-l border-gray-800 w-16">N/A</th>
                                <th className="p-3 font-semibold border-l border-gray-800 text-center" colSpan={2}>AM Shift</th>
                                <th className="p-3 font-semibold border-l border-gray-800 text-center" colSpan={2}>PM Shift</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                              {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as Array<keyof Omit<WeeklySchedule, 'weekCommencingDate'>>).map(day => {
                                const currentDayData = newStaffSchedule.weeks[activeWeekIndex][day];
                                const isUnavail = currentDayData.unavailable;
                                
                                // Calculate if this specific day is in the past
                                const dayOffsets: Record<string, number> = { 'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3, 'friday': 4, 'saturday': 5, 'sunday': 6 };
                                const currentDayDate = new Date(newStaffSchedule.weeks[activeWeekIndex].weekCommencingDate);
                                currentDayDate.setDate(currentDayDate.getDate() + dayOffsets[day]);
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                const isPast = currentDayDate < today;
                                const isDisabled = isUnavail || isPast;

                                return (
                                  <tr key={day} className={`transition-colors ${isUnavail || isPast ? 'bg-gray-900/50' : 'hover:bg-gray-800/30'}`}>
                                    <td className="p-3 text-sm font-medium text-gray-300 capitalize">
                                      {day.substring(0, 3)}
                                      {isPast && <span className="block text-[9px] text-red-400 mt-0.5">Past</span>}
                                    </td>
                                    
                                    <td className="p-3 text-center border-l border-gray-800">
                                      <input 
                                        type="checkbox" 
                                        disabled={isPast}
                                        checked={isUnavail}
                                        onChange={e => handleUnavailableChange(day, e.target.checked)}
                                        className="w-4 h-4 rounded bg-gray-900 border-gray-700 text-indigo-600 focus:ring-indigo-600 focus:ring-offset-gray-900 disabled:opacity-30"
                                      />
                                    </td>
                                    
                                    {/* AM Shift */}
                                    <td className="p-2 border-l border-gray-800 text-center">
                                      <input type="time" disabled={isDisabled} value={currentDayData.am?.start || ''} onChange={e => handleScheduleChange(day, 'am', 'start', e.target.value)} className="bg-gray-950 disabled:opacity-30 border border-gray-700 rounded px-2 py-1 text-xs text-white w-24 focus:border-indigo-500 outline-none" />
                                    </td>
                                    <td className="p-2 text-center">
                                      <input type="time" disabled={isDisabled} value={currentDayData.am?.end || ''} onChange={e => handleScheduleChange(day, 'am', 'end', e.target.value)} className="bg-gray-950 disabled:opacity-30 border border-gray-700 rounded px-2 py-1 text-xs text-white w-24 focus:border-indigo-500 outline-none" />
                                    </td>
                                    
                                    {/* PM Shift */}
                                    <td className="p-2 border-l border-gray-800 text-center">
                                      <input type="time" disabled={isDisabled} value={currentDayData.pm?.start || ''} onChange={e => handleScheduleChange(day, 'pm', 'start', e.target.value)} className="bg-gray-950 disabled:opacity-30 border border-gray-700 rounded px-2 py-1 text-xs text-white w-24 focus:border-indigo-500 outline-none" />
                                    </td>
                                    <td className="p-2 text-center">
                                      <input type="time" disabled={isDisabled} value={currentDayData.pm?.end || ''} onChange={e => handleScheduleChange(day, 'pm', 'end', e.target.value)} className="bg-gray-950 disabled:opacity-30 border border-gray-700 rounded px-2 py-1 text-xs text-white w-24 focus:border-indigo-500 outline-none" />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          <div className="bg-gray-900 p-3 border-t border-gray-800 flex justify-center">
                            <button 
                              type="button" 
                              onClick={copyToNextWeek}
                              disabled={activeWeekIndex >= 3}
                              className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold bg-indigo-500/10 px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              Copy this rota to next week →
                            </button>
                          </div>
                        </div>

                        <div className="mt-auto flex justify-end gap-3 pt-4 border-t border-gray-800">
                          <button type="button" onClick={() => {
                            setShowStaffModal(false);
                            setEditingStaffId(null);
                          }} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
                          <button type="submit" className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg transition-transform active:scale-95">
                            {editingStaffId ? 'Update Staff Member' : 'Save Staff Member'}
                          </button>
                        </div>
                      </form>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white">Staff Schedule</h3>
                    <button onClick={() => {
                      setEditingStaffId(null);
                      setNewStaffName('');
                      setNewStaffEmail('');
                      setNewStaffCalId('');
                      setNewStaffSchedule({
                        weeks: [createEmptySchedule(), createEmptySchedule(), createEmptySchedule(), createEmptySchedule()]
                      });
                      setActiveWeekIndex(0);
                      setShowStaffModal(true);
                    }} className="bg-gray-800 hover:bg-gray-700 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors">
                      + Add Staff
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-3 styleflo-scrollbar pr-2">
                    {filteredStaff.length === 0 ? (
                      <div className="text-sm text-gray-500 italic text-center mt-10">No staff configured yet.</div>
                    ) : filteredStaff.map(stf => (
                      <div key={stf.id} className="bg-gray-950 border border-gray-800 p-4 rounded-xl flex flex-col gap-2 group hover:border-gray-700 transition-colors">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-bold text-gray-200 text-sm">{stf.name}</div>
                            <div className="text-[10px] text-gray-500 font-mono mt-0.5">{stf.email}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => openEditStaff(stf)} className="text-gray-600 hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                            </button>
                            <button onClick={() => handleDeleteStaff(stf.id)} className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                          </div>
                        </div>
                        {bookingMode === 'multi_calendar' && (
                          <div className="text-[11px] text-gray-400 bg-gray-900 p-2 rounded-lg">
                            Cal ID: <span className="text-indigo-400 break-all">{stf.google_calendar_id}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            </div>
          )}
    </>
  );
}
