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

  const filteredServices = services.filter(s => s.chatbot_id === targetChatbotId || !s.chatbot_id);
  const filteredStaff = staff.filter(s => s.chatbot_id === targetChatbotId || !s.chatbot_id);

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
  const [newStaffImageUrl, setNewStaffImageUrl] = useState('');
  const [newStaffSpecialistProduct, setNewStaffSpecialistProduct] = useState('');
  const [newStaffBio, setNewStaffBio] = useState('');
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [expandedBios, setExpandedBios] = useState<Record<string, boolean>>({});

  const handleStaffImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    setIsUploadingImage(true);
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
      setNewStaffImageUrl(url);
    } catch (err: any) {
      console.error('Error uploading staff image:', err);
      alert(`Failed to upload image: ${err.message}`);
    } finally {
      setIsUploadingImage(false);
      if (e.target) e.target.value = '';
    }
  };

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
    setNewStaffImageUrl(staffMember.image_url || '');
    setNewStaffSpecialistProduct(staffMember.specialist_product || '');
    setNewStaffBio(staffMember.bio || '');
    
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
        working_days: newStaffSchedule,
        image_url: newStaffImageUrl || null,
        specialist_product: newStaffSpecialistProduct || null,
        bio: newStaffBio || null
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
        setNewStaffImageUrl('');
        setNewStaffSpecialistProduct('');
        setNewStaffBio('');
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

  // Policy controls state
  const {
    generalOperatingHours, setGeneralOperatingHours,
    flexibleBreaks, setFlexibleBreaks,
    is247, setIs247,
    openPublicHolidays, setOpenPublicHolidays,
    maxAdvanceWeeks, setMaxAdvanceWeeks,
    appointments, setAppointments
  } = useDashboardStore();

  const [selectedRotaDate, setSelectedRotaDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedApptForInspection, setSelectedApptForInspection] = useState<any | null>(null);
  const [isSavingAppointment, setIsSavingAppointment] = useState(false);

  // Form fields for editing appointment
  const [editApptStaffId, setEditApptStaffId] = useState('');
  const [editApptStartTime, setEditApptStartTime] = useState('');
  const [editApptEndTime, setEditApptEndTime] = useState('');
  const [editApptNotes, setEditApptNotes] = useState('');
  const [editApptCustomerPhone, setEditApptCustomerPhone] = useState('');

  const daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  const generateTimeOptions = () => {
    const times: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 30) {
        const hh = h < 10 ? '0' + h : '' + h;
        const mm = m === 0 ? '00' : '30';
        times.push(`${hh}:${mm}`);
      }
    }
    return times;
  };
  const timeOptions = generateTimeOptions();

  const handleDayOperatingHoursChange = (day: string, field: 'closed' | 'open' | 'close', value: any) => {
    const existingDayObj = generalOperatingHours[day] || { closed: false, open: '09:00', close: '17:00' };
    const updatedDayObj = { ...existingDayObj };

    if (field === 'closed') {
      updatedDayObj.closed = Boolean(value);
    } else if (field === 'open') {
      updatedDayObj.open = value;
    } else if (field === 'close') {
      updatedDayObj.close = value;
    }

    const updatedHours = {
      ...generalOperatingHours,
      [day]: updatedDayObj
    };

    setGeneralOperatingHours(updatedHours);
  };

  const handleSaveCalendarPolicies = async () => {
    setIsSavingBookingMode(true);
    try {
      const res = await fetch('/api/tenants/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          bookingMode,
          bookingUrl,
          general_operating_hours: generalOperatingHours,
          flexible_breaks: flexibleBreaks,
          is_24_7: is247,
          open_public_holidays: openPublicHolidays,
          max_advance_weeks: maxAdvanceWeeks
        })
      });
      if (res.ok) {
        alert('Calendar settings and operating hours saved successfully!');
      } else {
        alert('Failed to save calendar settings.');
      }
    } catch (err) {
      console.error('Failed to save settings', err);
      alert('An error occurred while saving.');
    } finally {
      setIsSavingBookingMode(false);
    }
  };

  const openInspectAppointment = (appt: any) => {
    setSelectedApptForInspection(appt);
    setEditApptStaffId(appt.staff_id || '');
    setEditApptStartTime(appt.start_time || '');
    setEditApptEndTime(appt.end_time || '');
    setEditApptNotes(appt.notes || appt.comments || '');
    setEditApptCustomerPhone(appt.customer_phone || appt.caller_phone_number || '');
  };

  const handleSaveAmendedAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApptForInspection) return;

    setIsSavingAppointment(true);
    try {
      const staffMember = staff.find(s => s.id === editApptStaffId);
      const res = await fetch(`/api/appointments/${selectedApptForInspection.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          start_time: editApptStartTime,
          end_time: editApptEndTime,
          staff_id: editApptStaffId,
          staff_name: staffMember?.name || '',
          notes: editApptNotes,
          customer_phone: editApptCustomerPhone
        })
      });

      if (res.ok) {
        const data = await res.json();
        setAppointments(appointments.map(a => a.id === selectedApptForInspection.id ? data.appointment : a));
        alert('Appointment amended successfully! Confirmation email and iCal (.ics) attachment generated.');
        setSelectedApptForInspection(null);
      } else {
        alert('Failed to amend appointment.');
      }
    } catch (err: any) {
      alert('Error amending appointment: ' + err.message);
    } finally {
      setIsSavingAppointment(false);
    }
  };

  // Filter appointments for selected date
  const rotaAppointments = appointments.filter(a => {
    if (!a.start_time) return false;
    const apptDateStr = new Date(a.start_time).toISOString().split('T')[0];
    return apptDateStr === selectedRotaDate;
  });

  return (
    <>
      <div className="space-y-6">
        {/* Operating Booking Mode & Google Calendar */}
        <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl space-y-4">
          <div>
            <h3 className="text-lg font-bold text-[var(--awb-color8)]">Scheduling & Booking Mode</h3>
            <p className="text-xs text-[var(--awb-color6)] mt-1">Configure your booking mode and calendar policy settings.</p>
          </div>

          <div className="bg-white border border-[#f2f3f5] p-4 rounded-xl">
            <h4 className="text-sm font-bold text-gray-200 mb-3">Operating Booking Mode</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              {[
                { id: 'walk_in_only', label: 'Walk-ins Only', desc: 'No appointments. Bots tell users to just walk in.' },
                { id: 'single_calendar', label: 'Single Unified Calendar', desc: 'All bookings drop into one central Google Calendar.' },
                { id: 'multi_calendar', label: 'Multi-Calendar (Per Staff)', desc: 'Bookings map to individual Google Calendars per staff.' },
                { id: 'external_platform', label: 'External Booking Link', desc: 'Use an existing system like Vagaro or Fresha.' }
              ].map(mode => (
                <label key={mode.id} className={`flex flex-col p-3 rounded-xl border cursor-pointer transition-colors ${
                  bookingMode === mode.id ? 'bg-blue-50 border border-blue-200 border-indigo-500/50' : 'bg-[var(--awb-color1)] border-[var(--awb-color3)] hover:border-[var(--awb-color3)]'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <input type="radio" name="bookingMode" value={mode.id} checked={bookingMode === mode.id} onChange={(e) => setBookingMode(e.target.value)} className="text-indigo-600 focus:ring-indigo-600" />
                    <span className="text-sm font-bold text-gray-200">{mode.label}</span>
                  </div>
                  <span className="text-[10px] text-[var(--awb-color6)] pl-6">{mode.desc}</span>
                </label>
              ))}
            </div>

            {bookingMode === 'external_platform' && (
              <div className="mb-4 pl-1">
                <label className="block text-xs font-semibold text-[var(--awb-color6)] mb-1">External Booking URL</label>
                <input type="url" value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} className="w-full bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-lg px-3 py-2 text-sm text-[var(--awb-color8)] focus:border-indigo-500 outline-none" placeholder="https://www.fresha.com/a/your-salon" />
              </div>
            )}

            <button onClick={handleSaveCalendarPolicies} disabled={isSavingBookingMode} className="bg-[#198fd9] text-white font-semibold rounded-[4px] px-6 py-2 text-xs transition-colors disabled:opacity-50">
              {isSavingBookingMode ? 'Saving Settings...' : 'Save Settings & Policies'}
            </button>
          </div>
        </div>

        {/* Standard Operating Hours (Mon-Sun) */}
        <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl space-y-4">
          <div>
            <h3 className="text-lg font-bold text-[var(--awb-color8)]">Standard Operating Hours</h3>
            <p className="text-xs text-[var(--awb-color6)] mt-0.5">Define your standard opening and closing times. Drives web page displays when Google Places is unlinked.</p>
          </div>

          <div className="bg-white border border-[#f2f3f5] p-4 rounded-xl divide-y divide-gray-100">
            {daysOfWeek.map(day => {
              const dayData = generalOperatingHours[day] || { closed: false, open: '09:00', close: '17:00' };
              return (
                <div key={day} className="py-3 flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="w-32 flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-700 capitalize">{day}</span>
                  </div>

                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(dayData.closed)}
                        onChange={e => handleDayOperatingHoursChange(day, 'closed', e.target.checked)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>Closed</span>
                    </label>

                    {!dayData.closed && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 font-semibold">Open:</span>
                        <select
                          value={dayData.open || '09:00'}
                          onChange={e => handleDayOperatingHoursChange(day, 'open', e.target.value)}
                          className="bg-gray-50 border border-gray-300 rounded px-2 py-1 text-xs text-gray-800 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          {timeOptions.map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>

                        <span className="text-xs text-gray-500 font-semibold ml-2">Closed:</span>
                        <select
                          value={dayData.close || '17:00'}
                          onChange={e => handleDayOperatingHoursChange(day, 'close', e.target.value)}
                          className="bg-gray-50 border border-gray-300 rounded px-2 py-1 text-xs text-gray-800 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          {timeOptions.map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Secondary Calendar Policy Dropdowns */}
          <div className="bg-white border border-[#f2f3f5] p-4 rounded-xl space-y-4">
            <h4 className="text-sm font-bold text-gray-800">Advanced Calendar Policies</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Flexible Personal Breaks</label>
                <select
                  value={flexibleBreaks ? 'true' : 'false'}
                  onChange={e => setFlexibleBreaks(e.target.value === 'true')}
                  className="w-full bg-gray-50 border border-gray-300 rounded px-3 py-2 text-xs font-semibold text-gray-800"
                >
                  <option value="true">Breaks ≤30m ARE flexible (can adjust ±30m for bookings)</option>
                  <option value="false">Breaks ARE NOT flexible (fixed duration)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">24/7 Operations</label>
                <select
                  value={is247 ? 'true' : 'false'}
                  onChange={e => setIs247(e.target.value === 'true')}
                  className="w-full bg-gray-50 border border-gray-300 rounded px-3 py-2 text-xs font-semibold text-gray-800"
                >
                  <option value="false">We ARE NOT a 24/7 365 operation</option>
                  <option value="true">We ARE a 24/7 365 online operation</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Public Holidays</label>
                <select
                  value={openPublicHolidays ? 'true' : 'false'}
                  onChange={e => setOpenPublicHolidays(e.target.value === 'true')}
                  className="w-full bg-gray-50 border border-gray-300 rounded px-3 py-2 text-xs font-semibold text-gray-800"
                >
                  <option value="false">We DO NOT open on Public Holidays</option>
                  <option value="true">We DO open on Public Holidays</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Max Advance Booking Window</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={maxAdvanceWeeks}
                    onChange={e => setMaxAdvanceWeeks(Number(e.target.value))}
                    className="w-24 bg-gray-50 border border-gray-300 rounded px-3 py-2 text-xs font-semibold text-gray-800"
                  />
                  <span className="text-xs text-gray-600 font-semibold">weeks in advance</span>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button onClick={handleSaveCalendarPolicies} disabled={isSavingBookingMode} className="bg-[#198fd9] text-white font-semibold rounded px-5 py-2 text-xs transition-colors">
                Save All Calendar Policies
              </button>
            </div>
          </div>
        </div>

        {/* Daily Rota Calendar Grid & Appointment Inspection */}
        <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl space-y-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-[var(--awb-color8)]">Daily Bookings Rota</h3>
              <p className="text-xs text-[var(--awb-color6)] mt-0.5">View and inspect customer appointments for any date.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-600 font-semibold">Select Date:</span>
              <input
                type="date"
                value={selectedRotaDate}
                onChange={e => setSelectedRotaDate(e.target.value)}
                className="bg-white border border-gray-300 rounded px-3 py-1.5 text-xs text-gray-800 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="bg-white border border-[#f2f3f5] p-4 rounded-xl">
            {rotaAppointments.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400 italic">
                No appointments scheduled for {selectedRotaDate}.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {rotaAppointments.map((appt) => {
                  const staffMember = staff.find(s => s.id === appt.staff_id);
                  const startTimeStr = appt.start_time ? new Date(appt.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                  const endTimeStr = appt.end_time ? new Date(appt.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

                  return (
                    <div
                      key={appt.id}
                      onClick={() => openInspectAppointment(appt)}
                      className="bg-gray-50 border border-gray-200 hover:border-indigo-500 p-4 rounded-xl cursor-pointer transition-all hover:shadow-md space-y-2 group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                          {startTimeStr} - {endTimeStr}
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono">Inspect / Amend →</span>
                      </div>

                      <div>
                        <h4 className="text-sm font-bold text-gray-800">{appt.customer_name || 'Customer Booking'}</h4>
                        <p className="text-xs text-gray-500">{appt.service_name || 'Service'}</p>
                      </div>

                      <div className="pt-2 border-t border-gray-200 flex items-center justify-between text-xs text-gray-600">
                        <span>Staff: <strong>{staffMember?.name || 'Unassigned'}</strong></span>
                        <span className="font-semibold text-emerald-600">📞 {appt.customer_phone || appt.caller_phone_number || 'N/A'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Appointment Inspection & Edit Modal */}
        {selectedApptForInspection && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-6 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <h3 className="text-lg font-bold text-gray-800">Inspect & Amend Appointment</h3>
                <button onClick={() => setSelectedApptForInspection(null)} className="text-gray-400 hover:text-gray-600 text-lg font-bold">✕</button>
              </div>

              <form onSubmit={handleSaveAmendedAppointment} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Customer Name</label>
                  <input type="text" readOnly value={selectedApptForInspection.customer_name || 'N/A'} className="w-full bg-gray-100 border border-gray-200 rounded px-3 py-2 text-xs font-semibold text-gray-700" />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Customer Mobile Phone Number</label>
                  <input
                    type="tel"
                    value={editApptCustomerPhone}
                    onChange={e => setEditApptCustomerPhone(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 rounded px-3 py-2 text-xs font-semibold text-gray-800"
                    placeholder="e.g. +44 7123 456789"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Assigned Colleague</label>
                  <select
                    value={editApptStaffId}
                    onChange={e => setEditApptStaffId(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 rounded px-3 py-2 text-xs font-semibold text-gray-800"
                  >
                    <option value="">Select staff...</option>
                    {staff.map(stf => (
                      <option key={stf.id} value={stf.id}>{stf.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Start Time (ISO)</label>
                    <input
                      type="datetime-local"
                      value={editApptStartTime ? new Date(editApptStartTime).toISOString().slice(0, 16) : ''}
                      onChange={e => setEditApptStartTime(new Date(e.target.value).toISOString())}
                      className="w-full bg-gray-50 border border-gray-300 rounded px-3 py-2 text-xs font-semibold text-gray-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">End Time (ISO)</label>
                    <input
                      type="datetime-local"
                      value={editApptEndTime ? new Date(editApptEndTime).toISOString().slice(0, 16) : ''}
                      onChange={e => setEditApptEndTime(new Date(e.target.value).toISOString())}
                      className="w-full bg-gray-50 border border-gray-300 rounded px-3 py-2 text-xs font-semibold text-gray-800"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Customer Requested Comments & Notes</label>
                  <textarea
                    rows={3}
                    value={editApptNotes}
                    onChange={e => setEditApptNotes(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 rounded px-3 py-2 text-xs text-gray-800"
                    placeholder="Customer requested notes or staff instructions..."
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-100">
                  <button type="button" onClick={() => setSelectedApptForInspection(null)} className="px-4 py-2 text-xs text-gray-600 hover:text-gray-800 font-semibold">Cancel</button>
                  <button type="submit" disabled={isSavingAppointment} className="px-5 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow-lg transition-colors">
                    {isSavingAppointment ? 'Saving Amendment...' : 'Amend & Send iCal Confirmation'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
