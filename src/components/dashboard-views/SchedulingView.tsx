import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDashboardStore, DailySchedule, WeeklySchedule } from '../../lib/store';
import ServiceEditor from '../ServiceEditor';
import { getMondayDate, formatMondayTabLabel, formatMondayFull, generateRollingSchedule, addDaysToDate } from '../../lib/dateUtils';


export default function SchedulingView() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const {
    tenantId,
    chatbots,
    services,
    setServices,
    staff,
    setStaff,
    bookingMode,
    setBookingMode,
    bookingUrl,
    setBookingUrl,
    isGoogleConnected,
    setIsGoogleConnected,
    maxAdvanceWeeks,
    setMaxAdvanceWeeks,
    generalOperatingHours,
    setGeneralOperatingHours,
    flexibleBreaks,
    setFlexibleBreaks,
    is247,
    setIs247,
    openPublicHolidays,
    setOpenPublicHolidays,
    appointments,
    setAppointments
  } = useDashboardStore();

  const safeChatbots = Array.isArray(chatbots) ? chatbots : [];
  const safeServices = Array.isArray(services) ? services : [];
  const safeStaff = Array.isArray(staff) ? staff : [];

  const realBots = safeChatbots.filter(b => b && b.id !== '00000000-0000-0000-0000-000000000000' && b.id !== 'global');
  const [targetChatbotId, setTargetChatbotId] = useState(realBots[0]?.id || '');

  const staffTabsRef = useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!targetChatbotId && realBots.length > 0) {
      setTargetChatbotId(realBots[0].id);
    }
  }, [chatbots, targetChatbotId]);

  const filteredServices = safeServices.filter(s => s && (s.chatbot_id === targetChatbotId || !s.chatbot_id));
  const filteredStaff = safeStaff.filter(s => s && (s.chatbot_id === targetChatbotId || !s.chatbot_id));

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
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceDescription, setNewServiceDescription] = useState('');
  const [newServiceDuration, setNewServiceDuration] = useState(30);
  const [newServiceBuffer, setNewServiceBuffer] = useState(0);
  const [newServicePrice, setNewServicePrice] = useState(0);
  const [newServiceStaff, setNewServiceStaff] = useState<any[]>([]);

  const openAddService = () => {
    setEditingServiceId(null);
    setNewServiceName('');
    setNewServiceDescription('');
    setNewServiceDuration(30);
    setNewServiceBuffer(0);
    setNewServicePrice(0);
    setNewServiceStaff(staff.map(st => ({ staff_id: st.id, custom_price: '', custom_duration: '' })));
    setShowAddService(true);
  };

  const openEditService = (service: any) => {
    setEditingServiceId(service.id);
    setNewServiceName(service.name);
    setNewServiceDescription(service.description || '');
    setNewServiceDuration(service.duration_minutes || 30);
    setNewServiceBuffer(service.buffer_minutes || 0);
    setNewServicePrice(service.price || 0);
    setNewServiceStaff(service.staff_services || []);
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

  const [showStaffModal, setShowStaffModal] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('');
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
    weekCommencingDate: weekDate ? getMondayDate(weekDate) : getMondayDate(),
    monday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
    tuesday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
    wednesday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
    thursday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
    friday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
    saturday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
    sunday: { unavailable: true, am: null, pm: null },
  });

  const [newStaffSchedule, setNewStaffSchedule] = useState<{weeks: WeeklySchedule[]}>(() => {
    const rolling = generateRollingSchedule([], maxAdvanceWeeks || 4, createEmptySchedule);
    return { weeks: rolling.weeks };
  });

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const isUpdate = !!editingServiceId;
      const method = isUpdate ? 'PUT' : 'POST';
      const bodyPayload: any = {
        tenant_id: tenantId,
        chatbot_id: targetChatbotId,
        name: newServiceName,
        description: newServiceDescription || null,
        duration_minutes: newServiceDuration,
        buffer_minutes: newServiceBuffer,
        price: newServicePrice || 0,
        assigned_staff: newServiceStaff.map(s => ({
          staff_id: s.staff_id,
          custom_price: s.custom_price ? parseFloat(String(s.custom_price)) : null,
          custom_duration: s.custom_duration ? parseInt(String(s.custom_duration), 10) : null
        }))
      };
      if (isUpdate) {
        bodyPayload.id = editingServiceId;
      }

      const res = await fetch('/api/services', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });
      if (res.ok) {
        const data = await res.json();
        if (isUpdate) {
          setServices(services.map(s => s.id === editingServiceId ? (data.service || { ...s, ...bodyPayload }) : s));
        } else {
          setServices([...services, data.service]);
        }
        setShowAddService(false);
        setEditingServiceId(null);
        setNewServiceName('');
        setNewServiceDescription('');
        setNewServiceDuration(30);
        setNewServiceBuffer(0);
        setNewServicePrice(0);
        setNewServiceStaff([]);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || (isUpdate ? 'Failed to update service' : 'Failed to add service'));
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
  };

  const handleDateChange = (dateStr: string) => {
    const mondayStr = getMondayDate(dateStr);
    
    setNewStaffSchedule(prev => {
      const newWeeks = [...prev.weeks];
      newWeeks[activeWeekIndex] = { ...newWeeks[activeWeekIndex], weekCommencingDate: mondayStr };
      return { weeks: newWeeks };
    });
  };

  const copyToNextWeek = () => {
    if (activeWeekIndex >= newStaffSchedule.weeks.length - 1) {
      alert(`You have reached the end of the ${maxAdvanceWeeks || 4}-week booking window.`);
      return;
    }
    setNewStaffSchedule(prev => {
      const newWeeks = [...prev.weeks];
      const currentWeek = newWeeks[activeWeekIndex];
      const nextWeekDate = newWeeks[activeWeekIndex + 1].weekCommencingDate;
      
      // Copy schedule structure while preserving the next week's Monday date
      newWeeks[activeWeekIndex + 1] = {
        ...JSON.parse(JSON.stringify(currentWeek)),
        weekCommencingDate: nextWeekDate
      };
      
      return { weeks: newWeeks };
    });
    // Auto switch to the next week tab
    setActiveWeekIndex(activeWeekIndex + 1);
  };

  const openAddStaff = () => {
    setEditingStaffId(null);
    setNewStaffName('');
    setNewStaffRole('');
    setNewStaffEmail('');
    setNewStaffCalId('');
    setNewStaffImageUrl('');
    setNewStaffSpecialistProduct('');
    setNewStaffBio('');

    const rolling = generateRollingSchedule([], maxAdvanceWeeks || 4, createEmptySchedule);
    setNewStaffSchedule({ weeks: rolling.weeks });
    setActiveWeekIndex(rolling.currentWeekIndex);
    setShowStaffModal(true);
  };

  const openEditStaff = (staffMember: any) => {
    setEditingStaffId(staffMember.id);
    setNewStaffName(staffMember.name);
    setNewStaffRole(staffMember.role && staffMember.role.toLowerCase() !== 'specialist' ? staffMember.role : '');
    setNewStaffEmail(staffMember.email);
    setNewStaffCalId(staffMember.google_calendar_id === 'primary' ? '' : staffMember.google_calendar_id);
    setNewStaffImageUrl(staffMember.image_url || '');
    setNewStaffSpecialistProduct(staffMember.specialist_product || '');
    setNewStaffBio(staffMember.bio || '');
    
    // Load existing weeks using rolling schedule calculation
    const existingWeeks = staffMember.working_days?.weeks || [];
    const rolling = generateRollingSchedule(existingWeeks, maxAdvanceWeeks || 4, createEmptySchedule);
    
    setNewStaffSchedule({ weeks: rolling.weeks });
    setActiveWeekIndex(rolling.currentWeekIndex);
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
        role: newStaffRole || null,
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
        setNewStaffRole('');
        setNewStaffEmail('');
        setNewStaffCalId('');
        setNewStaffImageUrl('');
        setNewStaffSpecialistProduct('');
        setNewStaffBio('');
        const rolling = generateRollingSchedule([], maxAdvanceWeeks || 4, createEmptySchedule);
        setNewStaffSchedule({ weeks: rolling.weeks });
        setActiveWeekIndex(rolling.currentWeekIndex);
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || (isUpdate ? 'Failed to update staff' : 'Failed to add staff'));
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
        const errData = await res.json().catch(() => ({}));
        alert(`Failed to save calendar settings: ${errData.error || 'Server error (' + res.status + ')'}`);
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
        const errData = await res.json().catch(() => ({}));
        alert(`Failed to amend appointment: ${errData.error || 'Server returned status ' + res.status}`);
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
        {/* Google Calendar Authorization Banner */}
        <div className="bg-gradient-to-r from-slate-900 to-indigo-950 p-6 rounded-2xl text-white shadow-xl flex flex-col xl:flex-row items-start xl:items-center justify-between gap-5">
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">📅</span>
              <h3 className="text-lg font-bold text-white tracking-tight">Google Calendar Integration</h3>
            </div>
            <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
              Synchronize appointments two-way with Google Calendar in real-time. Prevents double-booking and updates staff rotas automatically.
            </p>
            {isGoogleConnected ? (
              <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/20 text-emerald-300 rounded-full text-xs font-semibold border border-emerald-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Connected to Google Calendar API
              </div>
            ) : (
              <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 bg-amber-500/20 text-amber-300 rounded-full text-xs font-semibold border border-amber-500/30">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                Not Connected to Google Calendar
              </div>
            )}
          </div>

          <a
            href="/api/integrations/google/authorize"
            target="_top"
            rel="noopener noreferrer"
            className="w-full sm:w-auto px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-sm whitespace-nowrap shrink-0 self-stretch sm:self-start xl:self-center"
          >
            <span>{isGoogleConnected ? '🔄 Re-authorize Google Calendar' : '🔗 Connect Google Calendar'}</span>
          </a>
        </div>

        {/* Services & Treatment Catalog */}
        <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-[var(--awb-color8)]">Services & Treatment Catalog</h3>
              <p className="text-xs text-[var(--awb-color6)] mt-0.5">Manage services, durations, and buffer times available for AI booking.</p>
            </div>
            <button
              type="button"
              onClick={openAddService}
              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5 shrink-0"
            >
              <span>+ Add Service</span>
            </button>
          </div>

          {/* Services List */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredServices.length === 0 ? (
              <div className="col-span-full py-8 text-center text-xs text-gray-400 italic bg-white border border-[#f2f3f5] rounded-xl">
                No services configured yet. Click "+ Add Service" to create your first service.
              </div>
            ) : (
              filteredServices.map(service => {
                const assignedStaffIds = (service.staff_services || []).map((ss: any) => ss.staff_id);
                const assignedStaffMembers = staff.filter(st => assignedStaffIds.includes(st.id));

                return (
                  <div key={service.id} className="bg-white border border-[#f2f3f5] p-4 rounded-xl shadow-sm space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-bold text-gray-800 truncate">{service.name}</h4>
                        <p className="text-xs text-gray-500 mt-0.5">⏱️ {service.duration_minutes || 30} mins {service.buffer_minutes ? `(+${service.buffer_minutes}m buffer)` : ''} {service.price ? `• £${service.price}` : ''}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditService(service)}
                          className="text-indigo-600 hover:text-indigo-800 text-xs font-semibold px-2 py-1 rounded hover:bg-indigo-50 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteService(service.id)}
                          className="text-rose-500 hover:text-rose-700 text-xs font-semibold px-2 py-1 rounded hover:bg-rose-50 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-gray-100 flex items-center gap-1.5 text-xs text-slate-600">
                      <span className="text-[11px] font-semibold text-slate-400">Assigned:</span>
                      {assignedStaffMembers.length === 0 ? (
                        <span className="text-[11px] text-indigo-600 font-medium bg-indigo-50 px-2 py-0.5 rounded-full">All Colleagues</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {assignedStaffMembers.map(st => (
                            <span key={st.id} className="text-[11px] bg-slate-100 text-slate-700 font-medium px-2 py-0.5 rounded-full">
                              {st.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Staff Members & Rotas */}
        <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-[var(--awb-color8)]">Staff Members & Rotas</h3>
              <p className="text-xs text-[var(--awb-color6)] mt-0.5">Manage team members, individual Google Calendar IDs, and {maxAdvanceWeeks || 4}-week rolling shift & holiday rotas.</p>
            </div>
            <button
              type="button"
              onClick={openAddStaff}
              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5 shrink-0"
            >
              <span>+ Add Staff Member</span>
            </button>
          </div>

          {/* Staff Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredStaff.length === 0 ? (
              <div className="col-span-full py-8 text-center text-xs text-gray-400 italic bg-white border border-[#f2f3f5] rounded-xl">
                No staff members added yet. Click "+ Add Staff Member" to add your team.
              </div>
            ) : (
              filteredStaff.map(member => (
                <div key={member.id} className="bg-white border border-[#f2f3f5] p-4 rounded-xl shadow-sm space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center overflow-hidden shrink-0">
                      {member.image_url ? (
                        <img src={member.image_url} alt={member.name} className="w-full h-full object-cover" />
                      ) : (
                        member.name?.[0] || 'S'
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-bold text-gray-800 truncate">{member.name}</h4>
                      <p className="text-xs text-gray-500 truncate">{member.email || 'No email'}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-xs">
                    <span className="text-gray-500 truncate mr-2">Calendar: <strong className="text-slate-700">{member.google_calendar_id || 'primary'}</strong></span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" onClick={() => openEditStaff(member)} className="text-indigo-600 hover:text-indigo-800 font-semibold">Edit Rota</button>
                      <button type="button" onClick={() => handleDeleteStaff(member.id)} className="text-rose-500 hover:text-rose-700 font-semibold">Delete</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Operating Booking Mode & Google Calendar */}
        <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl space-y-4">
          <div>
            <h3 className="text-lg font-bold text-[var(--awb-color8)]">Scheduling & Booking Mode</h3>
            <p className="text-xs text-[var(--awb-color6)] mt-1">Configure your booking mode and calendar policy settings.</p>
          </div>

          <div className="bg-white border border-[#f2f3f5] p-4 rounded-xl">
            <h4 className="text-sm font-bold text-slate-900 mb-3">Operating Booking Mode</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
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
                    <span className="text-sm font-bold text-slate-900">{mode.label}</span>
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
                <div key={day} className="py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="w-32 flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-700 capitalize">{day}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
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
                      <div className="flex flex-wrap items-center gap-2">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Flexible Personal Breaks</label>
                <select
                  value={flexibleBreaks ? 'true' : 'false'}
                  onChange={e => setFlexibleBreaks(e.target.value === 'true')}
                  className="w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap bg-gray-50 border border-gray-300 rounded px-3 py-2 text-xs font-semibold text-gray-800"
                >
                  <option value="true">Breaks ≤30m flexible (±30m)</option>
                  <option value="false">Breaks fixed (no adjust)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">24/7 Operations</label>
                <select
                  value={is247 ? 'true' : 'false'}
                  onChange={e => setIs247(e.target.value === 'true')}
                  className="w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap bg-gray-50 border border-gray-300 rounded px-3 py-2 text-xs font-semibold text-gray-800"
                >
                  <option value="false">Standard Hours</option>
                  <option value="true">24/7 Online Operation</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Public Holidays</label>
                <select
                  value={openPublicHolidays ? 'true' : 'false'}
                  onChange={e => setOpenPublicHolidays(e.target.value === 'true')}
                  className="w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap bg-gray-50 border border-gray-300 rounded px-3 py-2 text-xs font-semibold text-gray-800"
                >
                  <option value="false">Closed on Public Holidays</option>
                  <option value="true">Open on Public Holidays</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Max Advance Booking Window</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={maxAdvanceWeeks}
                    onChange={e => setMaxAdvanceWeeks(Number(e.target.value))}
                    className="w-24 bg-gray-50 border border-gray-300 rounded px-3 py-2 text-xs font-semibold text-gray-800"
                  />
                  <span className="text-xs text-gray-600 font-semibold whitespace-nowrap">weeks in advance</span>
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
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
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

        {/* Add / Edit Service Modal */}
        {mounted && showAddService && createPortal(
          <div className="fixed inset-0 z-[99999] overflow-y-auto bg-black/75 backdrop-blur-md">
            <div className="min-h-full flex items-center justify-center p-4 sm:p-6 text-center">
              <div className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-8 space-y-5 shadow-2xl border border-slate-200 text-left my-8 transform transition-all max-h-[90vh] overflow-y-auto styleflo-scrollbar">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{editingServiceId ? '✏️ Edit Service' : '✨ Add New Service'}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Configure service duration, price, and assign qualified colleagues.</p>
                  </div>
                  <button type="button" onClick={() => setShowAddService(false)} className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-bold text-xs flex items-center justify-center">✕</button>
                </div>

                <form onSubmit={handleSaveService} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Service Name</label>
                    <input
                      type="text"
                      required
                      value={newServiceName}
                      onChange={e => setNewServiceName(e.target.value)}
                      placeholder="e.g. Cut & Blow Dry"
                      className="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Brief Description (Optional)</label>
                    <input
                      type="text"
                      value={newServiceDescription}
                      onChange={e => setNewServiceDescription(e.target.value)}
                      placeholder="e.g. Complete styling session with wash and blow dry"
                      className="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Duration (mins)</label>
                      <input
                        type="number"
                        required
                        min={5}
                        max={480}
                        value={newServiceDuration}
                        onChange={e => setNewServiceDuration(Number(e.target.value))}
                        className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Buffer (mins)</label>
                      <input
                        type="number"
                        min={0}
                        max={120}
                        value={newServiceBuffer}
                        onChange={e => setNewServiceBuffer(Number(e.target.value))}
                        className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Base Price (£)</label>
                      <input
                        type="number"
                        min={0}
                        value={newServicePrice}
                        onChange={e => setNewServicePrice(Number(e.target.value))}
                        className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                  </div>

                  {/* Assigned Staff Members Checklist */}
                  <div className="pt-3 border-t border-slate-100 space-y-2.5">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      👥 Assigned Colleagues & Specialists
                    </label>
                    <p className="text-[11px] text-slate-500">Check which colleagues provide this service. If none are selected, all colleagues will be eligible.</p>

                    {staff.length === 0 ? (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 italic">
                        No colleagues added yet. Add team members below to assign them.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {staff.map(st => {
                          const isAssigned = newServiceStaff.find(s => s.staff_id === st.id);
                          return (
                            <div key={st.id} className={`p-2.5 rounded-xl border transition-colors ${isAssigned ? 'bg-indigo-50/50 border-indigo-200' : 'bg-slate-50 border-slate-200'}`}>
                              <label className="flex items-center justify-between cursor-pointer">
                                <div className="flex items-center gap-2.5">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(isAssigned)}
                                    onChange={() => handleToggleStaff(st.id)}
                                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                                  />
                                  <span className="text-xs font-bold text-slate-800">{st.name}</span>
                                </div>
                                <span className="text-[10px] text-slate-400">{st.email || 'Staff member'}</span>
                              </label>

                              {isAssigned && (
                                <div className="mt-2 pl-6 grid grid-cols-2 gap-2 text-xs">
                                  <div>
                                    <label className="block text-[10px] text-slate-500 mb-0.5">Custom Price (£)</label>
                                    <input
                                      type="number"
                                      placeholder="Default price"
                                      value={isAssigned.custom_price || ''}
                                      onChange={e => handleUpdateStaffMapping(st.id, 'custom_price', e.target.value)}
                                      className="w-full h-8 px-2 bg-white border border-slate-200 rounded-lg text-xs"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] text-slate-500 mb-0.5">Custom Duration (mins)</label>
                                    <input
                                      type="number"
                                      placeholder="Default duration"
                                      value={isAssigned.custom_duration || ''}
                                      onChange={e => handleUpdateStaffMapping(st.id, 'custom_duration', e.target.value)}
                                      className="w-full h-8 px-2 bg-white border border-slate-200 rounded-lg text-xs"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
                    <button type="button" onClick={() => setShowAddService(false)} className="px-4 py-2.5 text-xs text-slate-600 font-semibold hover:text-slate-800">Cancel</button>
                    <button type="submit" className="px-5 py-2.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-md transition-colors">
                      {editingServiceId ? 'Save Service Changes' : 'Create Service'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Add / Edit Staff & Rota Modal */}
        {mounted && showStaffModal && createPortal(
          <div className="fixed inset-0 z-[99999] overflow-y-auto bg-black/75 backdrop-blur-md">
            <div className="min-h-full flex items-center justify-center p-4 sm:p-6 text-center">
              <div className="w-full max-w-2xl bg-white rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl border border-slate-200 text-left my-8 transform transition-all max-h-[90vh] overflow-y-auto styleflo-scrollbar">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">{editingStaffId ? '✏️ Edit Staff & Shift Rota' : '👤 Add New Staff Member'}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Configure colleague profile, photo avatar, bio, and {maxAdvanceWeeks || 4}-week rolling shift & holiday rota.</p>
                  </div>
                  <button type="button" onClick={() => setShowStaffModal(false)} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-bold text-sm flex items-center justify-center transition-colors">✕</button>
                </div>

                <form onSubmit={handleSaveStaff} className="space-y-6">
                  {/* Basic Info: Name, Role & Email */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Staff Member Name</label>
                      <input
                        type="text"
                        required
                        value={newStaffName}
                        onChange={e => setNewStaffName(e.target.value)}
                        placeholder="e.g. Jessica Taylor"
                        className="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Job Title / Role</label>
                      <input
                        type="text"
                        value={newStaffRole}
                        onChange={e => setNewStaffRole(e.target.value)}
                        placeholder="e.g. Senior Stylist, Barber, Director"
                        className="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Email Address</label>
                      <input
                        type="email"
                        value={newStaffEmail}
                        onChange={e => setNewStaffEmail(e.target.value)}
                        placeholder="jessica@salon.com"
                        className="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                  </div>

                  {/* Profile Photo / Image Upload */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Profile Photo / Avatar</label>
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-full overflow-hidden bg-slate-100 border-2 border-slate-200 flex-shrink-0 flex items-center justify-center text-xl font-bold text-slate-400">
                        {newStaffImageUrl ? (
                          <img src={newStaffImageUrl} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          newStaffName?.[0] || 'S'
                        )}
                      </div>
                      <div className="flex-1 space-y-2">
                        <input
                          type="url"
                          placeholder="https://example.com/avatar.jpg"
                          value={newStaffImageUrl}
                          onChange={(e) => setNewStaffImageUrl(e.target.value)}
                          className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                        />
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleStaffImageUpload}
                          disabled={isUploadingImage}
                          className="text-xs text-slate-500 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Google Calendar ID */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Google Calendar ID</label>
                    <input
                      type="text"
                      value={newStaffCalId}
                      onChange={e => setNewStaffCalId(e.target.value)}
                      placeholder="primary or calendar-id@group.calendar.google.com"
                      className="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">Leave empty to use primary default Google Calendar.</p>
                  </div>

                  {/* Specialist Products / Services */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Specialist Services & Specialties</label>
                    <input
                      type="text"
                      value={newStaffSpecialistProduct}
                      onChange={e => setNewStaffSpecialistProduct(e.target.value)}
                      placeholder="e.g. Balayage, Precision Cutting, Extensions"
                      className="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>

                  {/* Professional Bio */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Professional Bio</label>
                    <textarea
                      rows={3}
                      value={newStaffBio}
                      onChange={e => setNewStaffBio(e.target.value)}
                      placeholder="Describe qualifications, stylist experience, and client specialisms..."
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>

                  {/* Dynamic Rolling Shift Rota & Holiday Planner */}
                  <div className="pt-4 border-t border-slate-200 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">📅 Rolling Shift Rota & Colleague Holidays ({maxAdvanceWeeks || 4} Weeks)</h4>
                        <p className="text-[11px] text-slate-500">Configure AM/PM shift hours and mark booked holiday/time off across the {maxAdvanceWeeks || 4}-week booking window.</p>
                      </div>
                      <button
                        type="button"
                        onClick={copyToNextWeek}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg border border-indigo-200 transition-colors shrink-0"
                      >
                        Copy to Next Week →
                      </button>
                    </div>

                    {/* Scrollable Week Tabs with Arrow Navigation */}
                    <div className="relative flex items-center gap-1.5 border-b border-slate-200 pb-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (staffTabsRef.current) {
                            staffTabsRef.current.scrollBy({ left: -200, behavior: 'smooth' });
                          }
                        }}
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center shrink-0 transition-colors text-sm shadow-sm"
                        title="Scroll to previous weeks"
                      >
                        ‹
                      </button>

                      <div
                        ref={staffTabsRef}
                        className="flex gap-2 overflow-x-auto scroll-smooth py-1 px-1 flex-1 no-scrollbar"
                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                      >
                        {newStaffSchedule.weeks.map((week, weekIdx) => {
                          const currentMonday = getMondayDate();
                          const isCurrent = week.weekCommencingDate === currentMonday;
                          const isPast = Boolean(week.weekCommencingDate && week.weekCommencingDate < currentMonday);
                          const isSelected = activeWeekIndex === weekIdx;

                          return (
                            <button
                              key={week.weekCommencingDate || weekIdx}
                              type="button"
                              onClick={() => setActiveWeekIndex(weekIdx)}
                              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 ${
                                isSelected
                                  ? 'bg-indigo-600 text-white shadow-md ring-2 ring-indigo-300'
                                  : isPast
                                  ? 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              }`}
                            >
                              <span>{formatMondayTabLabel(week.weekCommencingDate)}</span>
                              {isCurrent && (
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${isSelected ? 'bg-indigo-700 text-indigo-100' : 'bg-indigo-100 text-indigo-700'}`}>
                                  Current
                                </span>
                              )}
                              {isPast && (
                                <span className="text-[9px] text-slate-400 font-normal">(Past)</span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (staffTabsRef.current) {
                            staffTabsRef.current.scrollBy({ left: 200, behavior: 'smooth' });
                          }
                        }}
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center shrink-0 transition-colors text-sm shadow-sm"
                        title="Scroll to next weeks"
                      >
                        ›
                      </button>
                    </div>

                    {/* Active Week Table */}
                    {newStaffSchedule.weeks && newStaffSchedule.weeks[activeWeekIndex] && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200">
                          <div className="flex items-center gap-3">
                            <label className="text-xs font-bold text-slate-700">Week Commencing (Monday):</label>
                            <input
                              type="date"
                              value={newStaffSchedule.weeks[activeWeekIndex].weekCommencingDate || ''}
                              onChange={(e) => handleDateChange(e.target.value)}
                              className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>
                          <span className="text-xs text-indigo-700 font-medium">
                            {formatMondayFull(newStaffSchedule.weeks[activeWeekIndex].weekCommencingDate)}
                          </span>
                        </div>

                        <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl bg-white overflow-hidden">
                          {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const).map((day) => {
                            const daySched = newStaffSchedule.weeks[activeWeekIndex][day] || { unavailable: false, am: null, pm: null };
                            return (
                              <div key={day} className={`p-2.5 flex flex-col md:flex-row md:items-center justify-between gap-2.5 text-xs transition-colors ${daySched.unavailable ? 'bg-rose-50/40' : ''}`}>
                                <div className="w-32 font-bold capitalize text-slate-800 flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={!daySched.unavailable}
                                    onChange={(e) => handleUnavailableChange(day, !e.target.checked)}
                                    className="w-4 h-4 text-indigo-600 rounded border-slate-300"
                                  />
                                  <span>{day}</span>
                                </div>

                                {daySched.unavailable ? (
                                  <div className="flex items-center gap-2 flex-1">
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-rose-100 text-rose-700 text-xs font-semibold rounded-md border border-rose-200">
                                      <span>🌴</span> Holiday / Day Off (Unavailable)
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap items-center gap-3 flex-1">
                                    {/* AM Shift */}
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] font-semibold text-slate-500">AM:</span>
                                      <input
                                        type="time"
                                        value={daySched.am?.start || '09:00'}
                                        onChange={(e) => handleScheduleChange(day, 'am', 'start', e.target.value)}
                                        className="px-2 py-1 bg-slate-50 border border-slate-300 rounded text-[11px]"
                                      />
                                      <span className="text-slate-400">-</span>
                                      <input
                                        type="time"
                                        value={daySched.am?.end || '13:00'}
                                        onChange={(e) => handleScheduleChange(day, 'am', 'end', e.target.value)}
                                        className="px-2 py-1 bg-slate-50 border border-slate-300 rounded text-[11px]"
                                      />
                                    </div>

                                    {/* PM Shift */}
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] font-semibold text-slate-500">PM:</span>
                                      <input
                                        type="time"
                                        value={daySched.pm?.start || '14:00'}
                                        onChange={(e) => handleScheduleChange(day, 'pm', 'start', e.target.value)}
                                        className="px-2 py-1 bg-slate-50 border border-slate-300 rounded text-[11px]"
                                      />
                                      <span className="text-slate-400">-</span>
                                      <input
                                        type="time"
                                        value={daySched.pm?.end || '18:00'}
                                        onChange={(e) => handleScheduleChange(day, 'pm', 'end', e.target.value)}
                                        className="px-2 py-1 bg-slate-50 border border-slate-300 rounded text-[11px]"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                    <button type="button" onClick={() => setShowStaffModal(false)} className="px-4 py-2.5 text-xs text-slate-600 hover:text-slate-800 font-semibold">Cancel</button>
                    <button type="submit" className="px-6 py-2.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-md transition-colors">
                      {editingStaffId ? 'Save Staff & Rota Changes' : 'Add Staff Member'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Appointment Inspection & Edit Modal */}
        {mounted && selectedApptForInspection && createPortal(
          <div className="fixed inset-0 z-[99999] overflow-y-auto bg-black/75 backdrop-blur-md">
            <div className="min-h-full flex items-center justify-center p-4 sm:p-6 text-center">
              <div className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl border border-slate-200 text-left my-8 transform transition-all max-h-[90vh] overflow-y-auto styleflo-scrollbar">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="text-lg font-bold text-slate-900">Inspect & Amend Appointment</h3>
                  <button type="button" onClick={() => setSelectedApptForInspection(null)} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 font-bold text-sm flex items-center justify-center transition-colors">✕</button>
                </div>

                <form onSubmit={handleSaveAmendedAppointment} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Customer Name</label>
                    <input type="text" readOnly value={selectedApptForInspection.customer_name || 'N/A'} className="w-full h-11 px-4 bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700" />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Customer Mobile Phone Number</label>
                    <input
                      type="tel"
                      value={editApptCustomerPhone}
                      onChange={e => setEditApptCustomerPhone(e.target.value)}
                      className="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      placeholder="e.g. +44 7123 456789"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Assigned Colleague</label>
                    <select
                      value={editApptStaffId}
                      onChange={e => setEditApptStaffId(e.target.value)}
                      className="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    >
                      <option value="">Select staff...</option>
                      {staff.map(stf => (
                        <option key={stf.id} value={stf.id}>{stf.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Start Time (ISO)</label>
                      <input
                        type="datetime-local"
                        value={editApptStartTime && !isNaN(new Date(editApptStartTime).getTime()) ? new Date(new Date(editApptStartTime).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
                        onChange={e => {
                          if (e.target.value) {
                            const d = new Date(e.target.value);
                            if (!isNaN(d.getTime())) setEditApptStartTime(d.toISOString());
                          } else {
                            setEditApptStartTime('');
                          }
                        }}
                        className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">End Time (ISO)</label>
                      <input
                        type="datetime-local"
                        value={editApptEndTime && !isNaN(new Date(editApptEndTime).getTime()) ? new Date(new Date(editApptEndTime).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
                        onChange={e => {
                          if (e.target.value) {
                            const d = new Date(e.target.value);
                            if (!isNaN(d.getTime())) setEditApptEndTime(d.toISOString());
                          } else {
                            setEditApptEndTime('');
                          }
                        }}
                        className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Customer Requested Comments & Notes</label>
                    <textarea
                      rows={3}
                      value={editApptNotes}
                      onChange={e => setEditApptNotes(e.target.value)}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900"
                      placeholder="Customer requested notes or staff instructions..."
                    />
                  </div>

                  <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
                    <button type="button" onClick={() => setSelectedApptForInspection(null)} className="px-4 py-2.5 text-xs text-slate-600 font-semibold hover:text-slate-800">Cancel</button>
                    <button type="submit" disabled={isSavingAppointment} className="px-5 py-2.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-md transition-colors">
                      {isSavingAppointment ? 'Saving Amendment...' : 'Amend & Send iCal Confirmation'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </>
  );
}
