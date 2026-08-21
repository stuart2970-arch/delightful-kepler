import React, { useState, useEffect, useRef } from 'react';
import { useDashboardStore, BusinessWeeklySchedule, BusinessDailySchedule } from '../../lib/store';
import { getMondayDate, formatMondayTabLabel, formatMondayFull, generateRollingSchedule, addDaysToDate } from '../../lib/dateUtils';

export default function BusinessOperatingHours() {
  const { tenantId, maxAdvanceWeeks, generalOperatingHours, setGeneralOperatingHours, operatingHoursOverrides, setOperatingHoursOverrides, holidaySettings, setHolidaySettings } = useDashboardStore();
  
  const overridesTabsRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'overrides'>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [globalHolidays, setGlobalHolidays] = useState<any[]>([]);

  // Initialize schedules if missing
  const createEmptySchedule = (weekDate?: string): BusinessWeeklySchedule => ({
    weekCommencingDate: weekDate ? getMondayDate(weekDate) : getMondayDate(),
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

  const [localOverrides, setLocalOverrides] = useState<{weeks: BusinessWeeklySchedule[]}>(() => {
    const rolling = generateRollingSchedule(operatingHoursOverrides || [], maxAdvanceWeeks || 4, createEmptySchedule);
    return { weeks: rolling.weeks };
  });

  const [activeWeekIndex, setActiveWeekIndex] = useState(() => {
    const rolling = generateRollingSchedule(operatingHoursOverrides || [], maxAdvanceWeeks || 4, createEmptySchedule);
    return rolling.currentWeekIndex;
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
    if (!dateStr) return;
    
    const selectedDate = new Date(dateStr);
    // If it's a valid date, snap it to the Monday of that week
    if (!isNaN(selectedDate.getTime())) {
      const day = selectedDate.getDay();
      const diff = selectedDate.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
      selectedDate.setDate(diff);
      
      const mondayStr = selectedDate.toISOString().split('T')[0];
      setLocalOverrides(prev => {
        const newWeeks = [...prev.weeks];
        newWeeks[activeWeekIndex] = { ...newWeeks[activeWeekIndex], weekCommencingDate: mondayStr };
        return { weeks: newWeeks };
      });
    } else {
      setLocalOverrides(prev => {
        const newWeeks = [...prev.weeks];
        newWeeks[activeWeekIndex] = { ...newWeeks[activeWeekIndex], weekCommencingDate: dateStr };
        return { weeks: newWeeks };
      });
    }
  };

  const copyToNextWeek = () => {
    if (activeWeekIndex >= localOverrides.weeks.length - 1) {
      alert(`You have reached the end of the ${maxAdvanceWeeks || 4}-week booking window.`);
      return;
    }
    setLocalOverrides(prev => {
      const newWeeks = [...prev.weeks];
      const currentWeek = newWeeks[activeWeekIndex];
      const nextWeekDate = newWeeks[activeWeekIndex + 1].weekCommencingDate;
      newWeeks[activeWeekIndex + 1] = {
        ...JSON.parse(JSON.stringify(currentWeek)),
        weekCommencingDate: nextWeekDate
      };
      return { weeks: newWeeks };
    });
    setActiveWeekIndex(activeWeekIndex + 1);
  };

  const renderScheduleGrid = (schedule: BusinessWeeklySchedule, isGeneral: boolean) => {
    return (
      <div className="bg-[var(--awb-color1)] rounded-xl border border-[var(--awb-color3)] overflow-hidden flex flex-col">
        {!isGeneral && (
          <>
            {/* Scrollable Overrides Tabs with Arrow Navigation */}
            <div className="relative flex items-center gap-1.5 bg-[var(--awb-color2)] border-b border-[var(--awb-color3)] px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  if (overridesTabsRef.current) {
                    overridesTabsRef.current.scrollBy({ left: -200, behavior: 'smooth' });
                  }
                }}
                className="w-7 h-7 rounded-lg bg-[var(--awb-color1)] hover:bg-[var(--awb-color3)] text-[var(--awb-color8)] font-bold flex items-center justify-center shrink-0 transition-colors text-sm shadow-sm border border-[var(--awb-color3)]"
                title="Scroll to previous weeks"
              >
                ‹
              </button>

              <div
                ref={overridesTabsRef}
                className="flex gap-2 overflow-x-auto scroll-smooth py-1 px-1 flex-1 no-scrollbar"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {localOverrides.weeks.map((week, weekIdx) => {
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
                          ? 'bg-[#198fd9] text-white shadow-md'
                          : isPast
                          ? 'bg-[var(--awb-color1)] text-[var(--awb-color6)]/60 hover:text-[var(--awb-color8)] border border-[var(--awb-color3)]'
                          : 'bg-[var(--awb-color1)] text-[var(--awb-color6)] hover:bg-[var(--awb-color3)] hover:text-[var(--awb-color8)] border border-[var(--awb-color3)]'
                      }`}
                    >
                      <span>{formatMondayTabLabel(week.weekCommencingDate)}</span>
                      {isCurrent && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${isSelected ? 'bg-white/20 text-white' : 'bg-blue-500/20 text-blue-300'}`}>
                          Current
                        </span>
                      )}
                      {isPast && (
                        <span className="text-[9px] text-[var(--awb-color6)] font-normal">(Past)</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  if (overridesTabsRef.current) {
                    overridesTabsRef.current.scrollBy({ left: 200, behavior: 'smooth' });
                  }
                }}
                className="w-7 h-7 rounded-lg bg-[var(--awb-color1)] hover:bg-[var(--awb-color3)] text-[var(--awb-color8)] font-bold flex items-center justify-center shrink-0 transition-colors text-sm shadow-sm border border-[var(--awb-color3)]"
                title="Scroll to next weeks"
              >
                ›
              </button>
            </div>
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--awb-color2)] px-4 py-3 border-b border-[var(--awb-color3)]">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-200">Week Commencing (Monday):</span>
                <input 
                  type="date" 
                  value={schedule.weekCommencingDate}
                  onChange={e => handleDateChange(e.target.value)}
                  className="bg-white border border-[#f2f3f5] rounded px-3 py-1 text-xs text-[var(--awb-color8)] focus:border-indigo-500 outline-none"
                />
                <span className="text-xs text-indigo-400 font-medium hidden md:inline">
                  {formatMondayFull(schedule.weekCommencingDate)}
                </span>
              </div>
              {activeWeekIndex < localOverrides.weeks.length - 1 && (
                <button 
                  type="button"
                  onClick={copyToNextWeek}
                  className="text-xs font-bold bg-[#198fd9] text-white rounded px-3 py-1.5 hover:bg-[#1479b8] transition-colors shrink-0"
                >
                  Copy to Next Week →
                </button>
              )}
            </div>
          </>
        )}

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[var(--awb-color1)] text-[10px] text-[var(--awb-color6)] uppercase tracking-wider border-b border-[var(--awb-color3)]">
              <th className="p-3 font-semibold w-32">Day</th>
              <th className="p-3 font-semibold text-center border-l border-[var(--awb-color3)] w-20">Closed</th>
              <th className="p-3 font-semibold border-l border-[var(--awb-color3)] text-center" colSpan={2}>Operating Hours</th>
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
                <tr key={day} className={`transition-colors ${isUnavail || isPast ? 'bg-[var(--awb-color1)]' : 'hover:bg-[var(--awb-color2)]'}`}>
                  <td className="p-3 text-sm font-medium text-[var(--awb-color7)] capitalize">
                    {day.substring(0, 3)}
                    {isPast && <span className="block text-[9px] text-red-400 mt-0.5">Past</span>}
                  </td>
                  
                  <td className="p-3 text-center border-l border-[var(--awb-color3)]">
                    <input 
                      type="checkbox" 
                      disabled={isPast}
                      checked={isUnavail}
                      onChange={e => updateUnavailable(isGeneral, day, e.target.checked)}
                      className="w-4 h-4 rounded bg-[var(--awb-color1)] border-[var(--awb-color3)] text-indigo-600 focus:ring-indigo-600 focus:ring-offset-gray-900 disabled:opacity-30"
                    />
                  </td>
                  
                  <td className="p-2 border-l border-[var(--awb-color3)] text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-xs text-[var(--awb-color6)] font-medium">Open:</span>
                      <input type="time" disabled={isDisabled} value={currentDayData.hours?.start || ''} onChange={e => updateSchedule(isGeneral, day, 'start', e.target.value)} className="bg-[var(--awb-color1)] text-[var(--awb-color8)] border-[var(--awb-color3)] disabled:opacity-30 border border-[var(--awb-color3)] rounded px-2 py-1 text-xs text-[var(--awb-color8)] w-24 focus:border-indigo-500 outline-none" />
                    </div>
                  </td>
                  <td className="p-2 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-xs text-[var(--awb-color6)] font-medium">Close:</span>
                      <input type="time" disabled={isDisabled} value={currentDayData.hours?.end || ''} onChange={e => updateSchedule(isGeneral, day, 'end', e.target.value)} className="bg-[var(--awb-color1)] text-[var(--awb-color8)] border-[var(--awb-color3)] disabled:opacity-30 border border-[var(--awb-color3)] rounded px-2 py-1 text-xs text-[var(--awb-color8)] w-24 focus:border-indigo-500 outline-none" />
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
    <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl space-y-4 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-[var(--awb-color8)]">Business Operating Hours</h3>
          <p className="text-xs text-[var(--awb-color6)] mt-1">Define your general opening times or set specific week overrides (min 4 weeks in advance).</p>
        </div>
        <div className="flex bg-[var(--awb-color1)] text-[var(--awb-color8)] border-[var(--awb-color3)] p-1 rounded-lg border border-[var(--awb-color3)]">
          <button 
            onClick={() => setActiveTab('general')} 
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${activeTab === 'general' ? 'bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px] text-[var(--awb-color8)]' : 'text-[var(--awb-color6)] hover:text-gray-200'}`}
          >
            General Opening Times
          </button>
          <button 
            onClick={() => setActiveTab('overrides')} 
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${activeTab === 'overrides' ? 'bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px] text-[var(--awb-color8)]' : 'text-[var(--awb-color6)] hover:text-gray-200'}`}
          >
            Specific Overrides (Rota)
          </button>
        </div>
      </div>

      <div className="mt-4">
        {activeTab === 'general' ? renderScheduleGrid(localGeneral, true) : renderScheduleGrid(localOverrides.weeks[activeWeekIndex], false)}
      </div>

      <div className="bg-white border border-[#f2f3f5] p-4 rounded-xl mt-4">
        <h4 className="text-sm font-bold text-gray-200 mb-2">Public & Bank Holidays</h4>
        <p className="text-xs text-[var(--awb-color6)] mb-3">
          We have {globalHolidays.length} upcoming public holidays tracked in our system. How would you like your chatbots to handle bookings on these days?
        </p>
        <select 
          value={localHolidaySetting}
          onChange={(e) => setLocalHolidaySetting(e.target.value)}
          className="w-full md:w-1/2 bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-lg px-3 py-2 text-sm text-[var(--awb-color8)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="closed">Automatically Close Business</option>
          <option value="follow_general">Follow General Opening Times</option>
          <option value="prompt">Prompt me beforehand</option>
        </select>
      </div>

      <div className="flex justify-end pt-2">
        <button onClick={handleSave} disabled={isSaving} className="bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px] hover:bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px] text-[var(--awb-color8)] text-sm px-6 py-2 rounded-lg font-bold transition-colors disabled:opacity-50">
          {isSaving ? 'Saving...' : 'Save Operating Hours'}
        </button>
      </div>
    </div>
  );
}
