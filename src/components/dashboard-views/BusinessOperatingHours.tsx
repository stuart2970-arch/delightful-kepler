import React, { useState, useEffect } from 'react';
import { useDashboardStore, BusinessWeeklySchedule, BusinessDailySchedule } from '../../lib/store';

export default function BusinessOperatingHours() {
  const { tenantId, generalOperatingHours, setGeneralOperatingHours, operatingHoursOverrides, setOperatingHoursOverrides, holidaySettings, setHolidaySettings } = useDashboardStore();
  
  const [activeTab, setActiveTab] = useState<'general' | 'overrides'>('general');
  const [activeWeekIndex, setActiveWeekIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [globalHolidays, setGlobalHolidays] = useState<any[]>([]);

  // Initialize schedules if missing
  const createEmptySchedule = (weekDate?: string): BusinessWeeklySchedule => ({
    weekCommencingDate: weekDate || new Date().toISOString().split('T')[0],
    monday: { unavailable: false, hours: null },
    tuesday: { unavailable: false, hours: null },
    wednesday: { unavailable: false, hours: null },
    thursday: { unavailable: false, hours: null },
    friday: { unavailable: false, hours: null },
    saturday: { unavailable: false, hours: null },
    sunday: { unavailable: false, hours: null },
  });

  const [localGeneral, setLocalGeneral] = useState<BusinessWeeklySchedule>(() => {
    return Object.keys(generalOperatingHours || {}).length > 0 
      ? (generalOperatingHours as BusinessWeeklySchedule) 
      : createEmptySchedule();
  });

  const [localOverrides, setLocalOverrides] = useState<{weeks: BusinessWeeklySchedule[]}>({
    weeks: operatingHoursOverrides && operatingHoursOverrides.length > 0
      ? operatingHoursOverrides
      : [createEmptySchedule(), createEmptySchedule(), createEmptySchedule(), createEmptySchedule()]
  });

  const [localHolidaySetting, setLocalHolidaySetting] = useState(holidaySettings?.behavior || 'follow_general');

  useEffect(() => {
    const fetchHolidays = async () => {
      try {
        const res = await fetch('/api/global-holidays');
        if (res.ok) {
          const data = await res.json();
          setGlobalHolidays(data.holidays || []);
        }
      } catch (err) {
        console.error('Failed to fetch holidays', err);
      }
    };
    fetchHolidays();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/tenants/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tenantId, 
          general_operating_hours: localGeneral,
          operating_hours_overrides: localOverrides.weeks,
          holiday_settings: { behavior: localHolidaySetting }
        })
      });
      if (res.ok) {
        setGeneralOperatingHours(localGeneral);
        setOperatingHoursOverrides(localOverrides.weeks);
        setHolidaySettings({ behavior: localHolidaySetting });
        alert('Business hours saved successfully!');
      } else {
        alert('Failed to save business hours.');
      }
    } catch (err) {
      console.error(err);
      alert('Error saving business hours.');
    } finally {
      setIsSaving(false);
    }
  };

  const updateSchedule = (
    isGeneral: boolean,
    day: keyof Omit<BusinessWeeklySchedule, 'weekCommencingDate'>, 
    field: 'start' | 'end', 
    value: string
  ) => {
    if (isGeneral) {
      setLocalGeneral(prev => {
        const newSched = { ...prev };
        if (!newSched[day].hours) {
          if (!value) return prev;
          newSched[day].hours = { start: '', end: '' };
        }
        if (value) {
          newSched[day].hours![field] = value;
        } else {
          newSched[day].hours![field] = '';
          if (!newSched[day].hours!.start && !newSched[day].hours!.end) {
            newSched[day].hours = null;
          }
        }
        return newSched;
      });
    } else {
      setLocalOverrides(prev => {
        const newWeeks = [...prev.weeks];
        const newSched = { ...newWeeks[activeWeekIndex] };
        if (!newSched[day].hours) {
          if (!value) return prev;
          newSched[day].hours = { start: '', end: '' };
        }
        if (value) {
          newSched[day].hours![field] = value;
        } else {
          newSched[day].hours![field] = '';
          if (!newSched[day].hours!.start && !newSched[day].hours!.end) {
            newSched[day].hours = null;
          }
        }
        newWeeks[activeWeekIndex] = newSched;
        return { weeks: newWeeks };
      });
    }
  };

  const updateUnavailable = (isGeneral: boolean, day: keyof Omit<BusinessWeeklySchedule, 'weekCommencingDate'>, checked: boolean) => {
    if (isGeneral) {
      setLocalGeneral(prev => {
        const newSched = { ...prev };
        newSched[day] = { ...newSched[day], unavailable: checked };
        if (checked) {
          newSched[day].hours = null;
        }
        return newSched;
      });
    } else {
      setLocalOverrides(prev => {
        const newWeeks = [...prev.weeks];
        const newSched = { ...newWeeks[activeWeekIndex] };
        newSched[day] = { ...newSched[day], unavailable: checked };
        if (checked) {
          newSched[day].hours = null;
        }
        newWeeks[activeWeekIndex] = newSched;
        return { weeks: newWeeks };
      });
    }
  };

  const handleDateChange = (dateStr: string) => {
    const selectedDate = new Date(dateStr);
    if (selectedDate.getDay() !== 1) {
      alert('Please select a Monday for the week commencing date.');
      return;
    }
    setLocalOverrides(prev => {
      const newWeeks = [...prev.weeks];
      newWeeks[activeWeekIndex] = { ...newWeeks[activeWeekIndex], weekCommencingDate: dateStr };
      return { weeks: newWeeks };
    });
  };

  const renderScheduleGrid = (schedule: BusinessWeeklySchedule, isGeneral: boolean) => {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden flex flex-col">
        {!isGeneral && (
          <>
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
                  value={schedule.weekCommencingDate}
                  onChange={e => handleDateChange(e.target.value)}
                  className="bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-xs text-white focus:border-indigo-500 outline-none"
                />
              </div>
            </div>
          </>
        )}

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-900 text-[10px] text-gray-400 uppercase tracking-wider border-b border-gray-800">
              <th className="p-3 font-semibold w-32">Day</th>
              <th className="p-3 font-semibold text-center border-l border-gray-800 w-20">Closed</th>
              <th className="p-3 font-semibold border-l border-gray-800 text-center" colSpan={2}>Operating Hours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as Array<keyof Omit<BusinessWeeklySchedule, 'weekCommencingDate'>>).map(day => {
              const currentDayData = schedule[day];
              const isUnavail = currentDayData.unavailable;
              
              let isPast = false;
              if (!isGeneral) {
                const dayOffsets: Record<string, number> = { 'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3, 'friday': 4, 'saturday': 5, 'sunday': 6 };
                const currentDayDate = new Date(schedule.weekCommencingDate);
                currentDayDate.setDate(currentDayDate.getDate() + dayOffsets[day]);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                isPast = currentDayDate < today;
              }
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
                      onChange={e => updateUnavailable(isGeneral, day, e.target.checked)}
                      className="w-4 h-4 rounded bg-gray-900 border-gray-700 text-indigo-600 focus:ring-indigo-600 focus:ring-offset-gray-900 disabled:opacity-30"
                    />
                  </td>
                  
                  <td className="p-2 border-l border-gray-800 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-xs text-gray-500 font-medium">Open:</span>
                      <input type="time" disabled={isDisabled} value={currentDayData.hours?.start || ''} onChange={e => updateSchedule(isGeneral, day, 'start', e.target.value)} className="bg-gray-950 disabled:opacity-30 border border-gray-700 rounded px-2 py-1 text-xs text-white w-24 focus:border-indigo-500 outline-none" />
                    </div>
                  </td>
                  <td className="p-2 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-xs text-gray-500 font-medium">Close:</span>
                      <input type="time" disabled={isDisabled} value={currentDayData.hours?.end || ''} onChange={e => updateSchedule(isGeneral, day, 'end', e.target.value)} className="bg-gray-950 disabled:opacity-30 border border-gray-700 rounded px-2 py-1 text-xs text-white w-24 focus:border-indigo-500 outline-none" />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl space-y-4 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-white">Business Operating Hours</h3>
          <p className="text-xs text-gray-400 mt-1">Define your general opening times or set specific week overrides (min 4 weeks in advance).</p>
        </div>
        <div className="flex bg-gray-950 p-1 rounded-lg border border-gray-800">
          <button 
            onClick={() => setActiveTab('general')} 
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${activeTab === 'general' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            General Opening Times
          </button>
          <button 
            onClick={() => setActiveTab('overrides')} 
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${activeTab === 'overrides' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Specific Overrides (Rota)
          </button>
        </div>
      </div>

      <div className="mt-4">
        {activeTab === 'general' ? renderScheduleGrid(localGeneral, true) : renderScheduleGrid(localOverrides.weeks[activeWeekIndex], false)}
      </div>

      <div className="bg-gray-950 border border-gray-800 p-4 rounded-xl mt-4">
        <h4 className="text-sm font-bold text-gray-200 mb-2">Public & Bank Holidays</h4>
        <p className="text-xs text-gray-400 mb-3">
          We have {globalHolidays.length} upcoming public holidays tracked in our system. How would you like your chatbots to handle bookings on these days?
        </p>
        <select 
          value={localHolidaySetting}
          onChange={(e) => setLocalHolidaySetting(e.target.value)}
          className="w-full md:w-1/2 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="closed">Automatically Close Business</option>
          <option value="follow_general">Follow General Opening Times</option>
          <option value="prompt">Prompt me beforehand</option>
        </select>
      </div>

      <div className="flex justify-end pt-2">
        <button onClick={handleSave} disabled={isSaving} className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-6 py-2 rounded-lg font-bold transition-colors disabled:opacity-50">
          {isSaving ? 'Saving...' : 'Save Operating Hours'}
        </button>
      </div>
    </div>
  );
}
