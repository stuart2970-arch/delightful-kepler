import React, { useState, useEffect, useRef } from 'react';
import { useDashboardStore } from '../../lib/store';
import { getMondayDate, formatMondayTabLabel, formatMondayFull, generateRollingSchedule, addDaysToDate } from '../../lib/dateUtils';

export default function MyProfileView() {
  const { tenantId, userEmail, userName, maxAdvanceWeeks } = useDashboardStore();
  const profileTabsRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const [staffData, setStaffData] = useState<any>(null);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [googleCalendarId, setGoogleCalendarId] = useState('');
  const [workingDays, setWorkingDays] = useState<any>({});
  const [isUploading, setIsUploading] = useState(false);

  const createEmptySchedule = (weekDate?: string) => ({
    weekCommencingDate: weekDate ? getMondayDate(weekDate) : getMondayDate(),
    monday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
    tuesday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
    wednesday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
    thursday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
    friday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
    saturday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '17:00' } },
    sunday: { unavailable: true, am: null, pm: null },
  });

  const [activeWeekIndex, setActiveWeekIndex] = useState(0);
  const [rotaSchedule, setRotaSchedule] = useState<{ weeks: any[] }>(() => {
    const rolling = generateRollingSchedule([], maxAdvanceWeeks || 4, createEmptySchedule);
    return { weeks: rolling.weeks };
  });

  useEffect(() => {
    fetchMyProfile();
  }, []);

  const fetchMyProfile = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/staff/me');
      if (res.ok) {
        const data = await res.json();
        setStaffData(data);
        setName(data.name || userName || '');
        setBio(data.bio || '');
        setAvatarUrl(data.avatar_url || data.image_url || '');
        setGoogleCalendarId(data.google_calendar_id || 'primary');
        
        const existingWeeks = data.working_days?.weeks || [];
        const rolling = generateRollingSchedule(existingWeeks, maxAdvanceWeeks || 4, createEmptySchedule);
        setRotaSchedule({ weeks: rolling.weeks });
        setActiveWeekIndex(rolling.currentWeekIndex);
      } else {
        setMessage({ type: 'error', text: 'Could not find your linked colleague record.' });
      }
    } catch (err: any) {
      console.error('Error loading my profile:', err);
      setMessage({ type: 'error', text: err.message || 'Failed to load profile.' });
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file.');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('tenantId', tenantId);

      const res = await fetch('/api/chatbots/upload-avatar', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Failed to upload image');
      const { url } = await res.json();
      setAvatarUrl(url);
    } catch (err: any) {
      alert(`Upload error: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/staff/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          bio,
          avatar_url: avatarUrl,
          working_days: rotaSchedule,
          google_calendar_id: googleCalendarId,
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setStaffData(updated);
        setMessage({ type: 'success', text: 'Your profile and calendar settings were saved successfully!' });
      } else {
        const err = await res.json();
        setMessage({ type: 'error', text: err.error || 'Failed to save changes.' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'An error occurred.' });
    } finally {
      setSaving(false);
    }
  };

  const isGoogleConnected = !!(staffData?.google_access_token || staffData?.google_refresh_token);

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500">
        <div className="animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto mb-4"></div>
        Loading your colleague profile...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center justify-between border-b pb-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">👤 My Profile & Personal Calendar</h2>
            <p className="text-sm text-slate-500">Manage your shift rota, bio, avatar, and individual Google Calendar integration.</p>
          </div>
          {staffData?.tenant?.company_name && (
            <span className="px-3 py-1 bg-indigo-50 text-indigo-700 font-semibold rounded-full text-xs border border-indigo-200">
              Workspace: {staffData.tenant.company_name}
            </span>
          )}
        </div>

        {message && (
          <div className={`p-4 rounded-xl mb-6 text-sm font-semibold ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
            {message.text}
          </div>
        )}

        {/* Google Calendar Authorization Card */}
        <div className="bg-gradient-to-r from-slate-900 to-indigo-950 p-6 rounded-xl text-white mb-8 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">📅</span>
              <h3 className="text-lg font-bold">Personal Google Calendar OAuth Integration</h3>
            </div>
            <p className="text-xs text-slate-300 max-w-xl">
              Connect your personal Google Calendar so that appointments are dynamically synchronized to your schedule without exposing company finances or platform settings.
            </p>
            {isGoogleConnected ? (
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/20 text-emerald-300 rounded-full text-xs font-semibold border border-emerald-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Connected to Google Calendar API
              </div>
            ) : (
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 bg-amber-500/20 text-amber-300 rounded-full text-xs font-semibold border border-amber-500/30">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                Not Connected
              </div>
            )}
          </div>

          <a
            href={`/api/integrations/google/authorize?staffId=${staffData?.id}`}
            target="_top"
            rel="noopener noreferrer"
            className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-md transition-all flex items-center gap-2 text-sm whitespace-nowrap"
          >
            <span>{isGoogleConnected ? '🔄 Re-authorize Google Calendar' : '🔗 Connect Google Calendar'}</span>
          </a>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Name */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Display Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Email (Read-Only) */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Work Email (Linked Account)</label>
              <input
                type="email"
                value={staffData?.email || userEmail}
                disabled
                className="w-full px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-sm text-slate-500 cursor-not-allowed"
              />
            </div>
          </div>

          {/* Avatar Upload / URL */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Profile Avatar / Photo</label>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full overflow-hidden bg-slate-100 border-2 border-slate-200 flex-shrink-0 flex items-center justify-center text-xl font-bold text-slate-400">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  name?.[0] || 'S'
                )}
              </div>
              <div className="flex-1 space-y-2">
                <input
                  type="url"
                  placeholder="https://example.com/avatar.jpg"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  disabled={isUploading}
                  className="text-xs text-slate-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />
              </div>
            </div>
          </div>

          {/* Google Calendar ID */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Target Google Calendar ID</label>
            <input
              type="text"
              value={googleCalendarId}
              onChange={(e) => setGoogleCalendarId(e.target.value)}
              placeholder="primary or calendar-id@group.calendar.google.com"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-slate-400 mt-1">Use 'primary' for your default Google account calendar or enter a specific Calendar ID.</p>
          </div>

          {/* Professional Bio */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Professional Bio & Specialisms</label>
            <textarea
              rows={4}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Describe your qualifications, specialties, and stylist experience..."
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Rolling Shift Rota & Working Hours Editor */}
          <div className="pt-6 border-t border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">📅 My Working Shift Rota & Holiday Planner ({maxAdvanceWeeks || 4} Weeks)</h3>
                <p className="text-xs text-slate-500 mt-0.5">Define your available working hours or mark booked holidays/time off across the {maxAdvanceWeeks || 4}-week booking window.</p>
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
                  if (profileTabsRef.current) {
                    profileTabsRef.current.scrollBy({ left: -200, behavior: 'smooth' });
                  }
                }}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center shrink-0 transition-colors text-sm shadow-sm"
                title="Scroll to previous weeks"
              >
                ‹
              </button>

              <div
                ref={profileTabsRef}
                className="flex gap-2 overflow-x-auto scroll-smooth py-1 px-1 flex-1 no-scrollbar"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {rotaSchedule.weeks.map((week, weekIdx) => {
                  const currentMonday = getMondayDate();
                  const isCurrent = week.weekCommencingDate === currentMonday;
                  const isPast = Boolean(week.weekCommencingDate && week.weekCommencingDate < currentMonday);
                  const isSelected = activeWeekIndex === weekIdx;

                  return (
                    <button
                      key={week.weekCommencingDate || weekIdx}
                      type="button"
                      onClick={() => setActiveWeekIndex(weekIdx)}
                      className={`px-4 py-2 text-xs font-bold rounded-lg whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow-md ring-2 ring-indigo-300'
                          : isPast
                          ? 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                  if (profileTabsRef.current) {
                    profileTabsRef.current.scrollBy({ left: 200, behavior: 'smooth' });
                  }
                }}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center shrink-0 transition-colors text-sm shadow-sm"
                title="Scroll to next weeks"
              >
                ›
              </button>
            </div>

            {/* Shift Rota Table for Active Week */}
            {rotaSchedule.weeks && rotaSchedule.weeks[activeWeekIndex] && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200">
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-bold text-slate-700">Week Commencing Date (Monday):</label>
                    <input
                      type="date"
                      value={rotaSchedule.weeks[activeWeekIndex].weekCommencingDate || ''}
                      onChange={(e) => {
                        const mondayStr = getMondayDate(e.target.value);
                        const newWeeks = [...rotaSchedule.weeks];
                        newWeeks[activeWeekIndex].weekCommencingDate = mondayStr;
                        setRotaSchedule({ weeks: newWeeks });
                      }}
                      className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <span className="text-xs text-indigo-700 font-medium">
                    {formatMondayFull(rotaSchedule.weeks[activeWeekIndex].weekCommencingDate)}
                  </span>
                </div>

                <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl bg-white overflow-hidden">
                  {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const).map((day) => {
                    const daySched = rotaSchedule.weeks[activeWeekIndex][day] || { unavailable: false, am: null, pm: null };
                    return (
                      <div key={day} className="p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                        <div className="w-28 font-bold capitalize text-slate-800 flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!daySched.unavailable}
                            onChange={(e) => {
                              const newWeeks = [...rotaSchedule.weeks];
                              newWeeks[activeWeekIndex][day] = {
                                ...daySched,
                                unavailable: !e.target.checked
                              };
                              setRotaSchedule({ weeks: newWeeks });
                            }}
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
                          <div className="flex flex-wrap items-center gap-4 flex-1">
                            {/* Morning Shift */}
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold text-slate-500">Morning (AM):</span>
                              <input
                                type="time"
                                value={daySched.am?.start || '09:00'}
                                onChange={(e) => {
                                  const newWeeks = [...rotaSchedule.weeks];
                                  newWeeks[activeWeekIndex][day].am = {
                                    start: e.target.value,
                                    end: daySched.am?.end || '13:00'
                                  };
                                  setRotaSchedule({ weeks: newWeeks });
                                }}
                                className="px-2 py-1 bg-slate-50 border border-slate-300 rounded text-xs"
                              />
                              <span className="text-slate-400">-</span>
                              <input
                                type="time"
                                value={daySched.am?.end || '13:00'}
                                onChange={(e) => {
                                  const newWeeks = [...rotaSchedule.weeks];
                                  newWeeks[activeWeekIndex][day].am = {
                                    start: daySched.am?.start || '09:00',
                                    end: e.target.value
                                  };
                                  setRotaSchedule({ weeks: newWeeks });
                                }}
                                className="px-2 py-1 bg-slate-50 border border-slate-300 rounded text-xs"
                              />
                            </div>

                            {/* Afternoon Shift */}
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold text-slate-500">Afternoon (PM):</span>
                              <input
                                type="time"
                                value={daySched.pm?.start || '14:00'}
                                onChange={(e) => {
                                  const newWeeks = [...rotaSchedule.weeks];
                                  newWeeks[activeWeekIndex][day].pm = {
                                    start: e.target.value,
                                    end: daySched.pm?.end || '18:00'
                                  };
                                  setRotaSchedule({ weeks: newWeeks });
                                }}
                                className="px-2 py-1 bg-slate-50 border border-slate-300 rounded text-xs"
                              />
                              <span className="text-slate-400">-</span>
                              <input
                                type="time"
                                value={daySched.pm?.end || '18:00'}
                                onChange={(e) => {
                                  const newWeeks = [...rotaSchedule.weeks];
                                  newWeeks[activeWeekIndex][day].pm = {
                                    start: daySched.pm?.start || '14:00',
                                    end: e.target.value
                                  };
                                  setRotaSchedule({ weeks: newWeeks });
                                }}
                                className="px-2 py-1 bg-slate-50 border border-slate-300 rounded text-xs"
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

          <div className="pt-4 border-t flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
            >
              {saving ? 'Saving Profile & Rota...' : 'Save Profile & Rota Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
