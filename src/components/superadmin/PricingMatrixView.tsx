'use client';

import { formatAllowanceRange } from '@/lib/addon-text';
import React, { useState, useEffect } from 'react';

export type AddonItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  monthly_price_pence: number;
  max_price_pence?: number | null;
  included_voice_minutes: number;
  max_voice_minutes?: number | null;
  included_sms: number;
  max_sms?: number | null;
  included_messages: number;
  included_data_chunks: number;
  is_sliding?: boolean;
  price_step_pence?: number;
  is_active: boolean;
  display_order: number;
};

export type AuditLogEntry = {
  id: string;
  created_at: string;
  performed_by: string;
  summary: string;
  item_type: string;
  item_id: string;
};

export default function PricingMatrixView() {
  const [addons, setAddons] = useState<AddonItem[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form state for each editable add-on
  const [formState, setFormState] = useState<{
    [key: string]: {
      name?: string;
      description?: string;
      lowerCostGBP: string;
      upperCostGBP: string;
      lowerAllowance: string;
      upperAllowance: string;
      voiceMinsBuffer?: string;
      stepPence?: string;
    };
  }>({});

  useEffect(() => {
    fetchCatalog();
  }, []);

  const fetchCatalog = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/superadmin/addon-catalog');
      if (!res.ok) throw new Error('Failed to load addon catalog');
      const json = await res.json();
      const items: AddonItem[] = json.addons || [];
      setAddons(items);
      setAuditLog(json.auditLog || []);

      // Initialize form states
      const stateObj: typeof formState = {};
      items.forEach((item) => {
        const lowerCost = ((item.monthly_price_pence || 0) / 100).toFixed(2);
        const upperCost = item.max_price_pence ? ((item.max_price_pence || 0) / 100).toFixed(2) : lowerCost;

        let lowerAllow = '0';
        let upperAllow = '0';
        let voiceBuffer = '0';

        if (item.category === 'landline') {
          lowerAllow = String(item.included_voice_minutes || 10);
          upperAllow = String(item.max_voice_minutes || 30);
        } else if (item.category === 'mobile') {
          lowerAllow = String(item.included_sms || 50);
          upperAllow = String(item.max_sms || 250);
          voiceBuffer = '0';
        } else if (item.category === 'voice_pack') {
          lowerAllow = String(item.included_voice_minutes || 20);
          upperAllow = String(item.max_voice_minutes || 100);
        } else if (item.category === 'sms_pack') {
          lowerAllow = String(item.included_sms || 100);
          upperAllow = String(item.max_sms || 500);
        } else if (item.category === 'data_pack') {
          lowerAllow = String(item.included_data_chunks || 500);
          upperAllow = String(item.included_data_chunks || 500);
        } else if (item.category === 'whatsapp') {
          lowerAllow = String(item.included_messages || 500);
          upperAllow = String(item.included_messages || 500);
        } else if (item.category === 'google_calendar' || item.category === 'microsoft_calendar') {
          lowerAllow = '1';
          upperAllow = '1';
        }

        stateObj[item.id] = {
          name: item.name || '',
          description: item.description || '',
          lowerCostGBP: lowerCost,
          upperCostGBP: upperCost,
          lowerAllowance: lowerAllow,
          upperAllowance: upperAllow,
          voiceMinsBuffer: voiceBuffer,
          stepPence: String(item.price_step_pence || 100),
        };
      });

      setFormState(stateObj);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Error loading catalog');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFieldChange = (id: string, field: string, value: string) => {
    setFormState((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value,
      },
    }));
  };

  const handleSaveSlidingAddon = async (id: string, category: string, name: string) => {
    const values = formState[id];
    if (!values) return;

    setSavingId(id);
    setErrorMsg(null);
    setSuccessMsg(null);

    const lowerPence = Math.round(parseFloat(values.lowerCostGBP || '0') * 100);
    const upperPence = Math.round(parseFloat(values.upperCostGBP || '0') * 100);
    const lowerAllow = parseInt(values.lowerAllowance || '0', 10);
    const upperAllow = parseInt(values.upperAllowance || '0', 10);
    const stepPence = parseInt(values.stepPence || '100', 10);

    if (upperPence < lowerPence) {
      setErrorMsg(`Upper cost (£${(upperPence / 100).toFixed(2)}) cannot be less than lower cost (£${(lowerPence / 100).toFixed(2)}) for ${name}.`);
      setSavingId(null);
      return;
    }

    if (upperAllow < lowerAllow) {
      setErrorMsg(`Upper allowance (${upperAllow}) cannot be less than lower allowance (${lowerAllow}) for ${name}.`);
      setSavingId(null);
      return;
    }

    const updates: Record<string, any> = {
      monthly_price_pence: lowerPence,
      max_price_pence: upperPence,
      is_sliding: true,
      price_step_pence: stepPence > 0 ? stepPence : 100,
    };
    if (values.name !== undefined) updates.name = values.name.trim();
    if (values.description !== undefined) updates.description = values.description.trim();

    let summary = '';
    if (category === 'landline') {
      updates.included_voice_minutes = lowerAllow;
      updates.max_voice_minutes = upperAllow;
      summary = `Updated Landline bounds: £${values.lowerCostGBP} (${lowerAllow}m) -> £${values.upperCostGBP} (${upperAllow}m)`;
    } else if (category === 'mobile') {
      updates.included_sms = lowerAllow;
      updates.max_sms = upperAllow;
      updates.included_voice_minutes = 0;
      summary = `Updated Mobile bounds: £${values.lowerCostGBP} (${lowerAllow} SMS) -> £${values.upperCostGBP} (${upperAllow} SMS) (WhatsApp & SMS only)`;
    } else if (category === 'voice_pack') {
      updates.included_voice_minutes = lowerAllow;
      updates.max_voice_minutes = upperAllow;
      summary = `Updated Voice Pack bounds: £${values.lowerCostGBP} (${lowerAllow}m) -> £${values.upperCostGBP} (${upperAllow}m)`;
    } else if (category === 'sms_pack') {
      updates.included_sms = lowerAllow;
      updates.max_sms = upperAllow;
      summary = `Updated SMS Pack bounds: £${values.lowerCostGBP} (${lowerAllow} SMS) -> £${values.upperCostGBP} (${upperAllow} SMS)`;
    } else {
      summary = `Updated ${name}: £${values.lowerCostGBP} -> £${values.upperCostGBP}`;
    }

    try {
      const res = await fetch('/api/superadmin/addon-catalog', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'addon',
          id,
          updates,
          summary,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update catalog');

      setSuccessMsg(`Successfully updated ${name}! Changes are live for all tenant modals.`);
      setAddons((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...updates } : a))
      );

      // Append to audit log in local state
      setAuditLog((prev) => [
        {
          id: Math.random().toString(),
          created_at: new Date().toISOString(),
          performed_by: 'Superadmin',
          summary,
          item_type: 'addon',
          item_id: id,
        },
        ...prev,
      ]);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to save changes');
    } finally {
      setSavingId(null);
    }
  };

  const handleSaveFixedAddon = async (id: string, name: string, priceGBP: string, allowance: string, allowKey: string) => {
    setSavingId(id);
    setErrorMsg(null);
    setSuccessMsg(null);

    const pricePence = Math.round(parseFloat(priceGBP || '0') * 100);
    const allowVal = parseInt(allowance || '0', 10);

    const values = formState[id];
    const updates: Record<string, any> = {
      monthly_price_pence: pricePence,
      max_price_pence: pricePence,
      [allowKey]: allowVal,
    };
    if (values?.name !== undefined) updates.name = values.name.trim();
    if (values?.description !== undefined) updates.description = values.description.trim();

    const summary = `Updated fixed ${name}: £${priceGBP} (${allowVal} ${allowKey.replace('included_', '')})`;

    try {
      const res = await fetch('/api/superadmin/addon-catalog', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'addon',
          id,
          updates,
          summary,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update');

      setSuccessMsg(`Successfully updated ${name}!`);
      setAddons((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...updates } : a))
      );
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to save');
    } finally {
      setSavingId(null);
    }
  };

  const handleToggleAddonActive = async (item: AddonItem) => {
    const nextActive = item.is_active === false ? true : false;
    if (nextActive) {
      const ok = window.confirm('This will show the add-on on the public price list and checkout. Are you sure?');
      if (!ok) return;
    }

    setSavingId(item.id);
    setErrorMsg(null);
    setSuccessMsg(null);

    const updates = { is_active: nextActive };
    const summary = nextActive
      ? `Enabled ${item.name} for customers (visible on public catalogue and checkout)`
      : `Disabled ${item.name} from customers (hidden from public catalogue and checkout)`;

    try {
      const res = await fetch('/api/superadmin/addon-catalog', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'addon',
          id: item.id,
          updates,
          summary,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update add-on active status');

      setSuccessMsg(`Successfully ${nextActive ? 'enabled' : 'disabled'} ${item.name}!`);
      setAddons((prev) =>
        prev.map((a) => (a.id === item.id ? { ...a, is_active: nextActive } : a))
      );
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to update add-on active status');
    } finally {
      setSavingId(null);
    }
  };

  const renderActiveToggle = (item: AddonItem) => {
    return (
      <div className="flex items-center justify-between py-1.5 px-3 rounded-xl bg-gray-950 border border-gray-800">
        <span className="text-[11px] text-gray-300 font-medium">Enabled for customers</span>
        <button
          type="button"
          onClick={() => handleToggleAddonActive(item)}
          disabled={savingId === item.id}
          className={`text-[10px] font-bold px-2.5 py-0.5 rounded transition-colors cursor-pointer ${
            item.is_active !== false
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
              : 'bg-amber-600 hover:bg-amber-500 text-white'
          }`}
        >
          {item.is_active !== false ? 'Enabled' : 'Disabled'}
        </button>
      </div>
    );
  };

  // Helper to compute steps preview
  const getStepsSummary = (lowerCost: string, upperCost: string, lowerAllow: string, upperAllow: string, stepPence: string, unit: string) => {
    const minP = Math.round(parseFloat(lowerCost || '0') * 100);
    const maxP = Math.round(parseFloat(upperCost || '0') * 100);
    const minA = parseInt(lowerAllow || '0', 10);
    const maxA = parseInt(upperAllow || '0', 10);
    const stepP = parseInt(stepPence || '100', 10) || 100;

    if (maxP < minP) return 'Invalid range: Upper cost is less than lower cost.';
    const steps = Math.max(1, Math.round((maxP - minP) / stepP));
    const stepCostGBP = (stepP / 100).toFixed(2);
    const allowPerStep = ((maxA - minA) / steps).toFixed(1);

    return `${steps} steps at £${stepCostGBP} increments (~+${allowPerStep} ${unit}/step). Range: £${(minP / 100).toFixed(2)} (${minA} ${unit}) → £${(maxP / 100).toFixed(2)} (${maxA} ${unit})`;
  };

  if (isLoading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center text-gray-400 mt-6 animate-pulse">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        Loading Superadmin Sliding Scale & Add-on Catalog...
      </div>
    );
  }

  // STYL-179: Render every add-on in /superadmin; inactive ones get a "Disabled (hidden from customers)" badge.
  const landlineItem = addons.find((a) => a.id === 'landline_addon') || addons.find((a) => a.category === 'landline');
  const mobileItem = addons.find((a) => a.id === 'mobile_addon') || addons.find((a) => a.category === 'mobile');
  const voicePackItem = addons.find((a) => a.id === 'voice_pack_20') || addons.find((a) => a.category === 'voice_pack');
  const smsPackItem = addons.find((a) => a.id === 'sms_pack_100') || addons.find((a) => a.category === 'sms_pack');
  const whatsappAddon = addons.find((a) => a.id === 'whatsapp_addon');
  const dataPack = addons.find((a) => a.id === 'data_pack_500') || addons.find((a) => a.category === 'data_pack');
  const googleCalendarItem = addons.find((a) => a.id === 'google_calendar_addon') || addons.find((a) => a.category === 'google_calendar');
  const microsoftCalendarItem = addons.find((a) => a.id === 'microsoft_calendar_addon') || addons.find((a) => a.category === 'microsoft_calendar');

  const renderWordingControls = (item: AddonItem) => {
    const currentName = formState[item.id]?.name ?? item.name ?? '';
    const currentDesc = formState[item.id]?.description ?? item.description ?? '';
    const hasDigits = /\d/.test(currentName) || /\d/.test(currentDesc);
    const previewAllowance = formatAllowanceRange(item);

    return (
      <div className="space-y-3 pt-3 border-t border-gray-800">
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[11px] font-semibold text-gray-300">Customer-Facing Name</label>
            <span className="text-[10px] text-gray-500 font-mono">{currentName.length}/60</span>
          </div>
          <input
            type="text"
            maxLength={60}
            value={currentName}
            onChange={(e) => handleFieldChange(item.id, 'name', e.target.value)}
            className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            placeholder="Customer-facing name"
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[11px] font-semibold text-gray-300">Customer-Facing Description</label>
            <span className="text-[10px] text-gray-500 font-mono">{currentDesc.length}/300</span>
          </div>
          <textarea
            rows={2}
            maxLength={300}
            value={currentDesc}
            onChange={(e) => handleFieldChange(item.id, 'description', e.target.value)}
            className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
            placeholder="Customer-facing description"
          />
        </div>

        {hasDigits && (
          <div className="p-2 bg-amber-950/40 border border-amber-600/30 text-amber-300 text-[11px] rounded-lg flex items-center gap-2">
            <span>⚠️</span>
            <span>Allowances are shown automatically from the values above. Avoid typing numbers here.</span>
          </div>
        )}

        <div className="p-3 bg-gray-950/80 rounded-xl border border-dashed border-gray-700 text-[11px] space-y-1">
          <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">Customer Checkout Preview:</span>
          <div className="font-bold text-white text-xs">{currentName || item.name}</div>
          <div className="text-gray-400 leading-relaxed">{currentDesc || item.description}</div>
          {previewAllowance && (
            <div className="text-emerald-400 font-mono text-[10px] pt-0.5">✦ Includes: {previewAllowance}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 mt-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-gray-900 via-indigo-950/40 to-gray-900 border border-indigo-500/30 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🎚️</span>
              <h2 className="text-xl font-bold text-white tracking-tight">Sliding Scale & Modular Add-on Controls</h2>
              <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                God Mode Active
              </span>
            </div>
            <p className="text-gray-400 text-xs mt-1.5 max-w-3xl">
              Configure lower and upper costs, lower and upper allowances, and step multiples for all modular sliding scales.
              Updates persist directly to the database and synchronize immediately with tenant-facing checkout modals.
            </p>
          </div>
          <button
            onClick={fetchCatalog}
            className="px-3.5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold rounded-xl border border-gray-700 transition-colors flex items-center gap-1.5"
          >
            🔄 Refresh Catalog
          </button>
        </div>

        {successMsg && (
          <div className="mt-4 p-3.5 bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs rounded-xl flex items-center justify-between">
            <span>✅ {successMsg}</span>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-white font-bold ml-2">×</button>
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 p-3.5 bg-red-950/60 border border-red-500/40 text-red-300 text-xs rounded-xl flex items-center justify-between">
            <span>⚠️ {errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-white font-bold ml-2">×</button>
          </div>
        )}
      </div>

      {/* Grid of Sliding Scale Config Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ================================================================= */}
        {/* 1. LOCAL LANDLINE NUMBER BOLT-ON                                  */}
        {/* ================================================================= */}
        {landlineItem && formState[landlineItem.id] && (
          <div className="bg-gray-900 border border-gray-800 hover:border-indigo-500/50 rounded-2xl p-6 space-y-4 shadow-lg transition-all">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">📞</span>
                  <h3 className="text-base font-bold text-white">{landlineItem.name}</h3>
                  <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    Sliding Scale
                  </span>
                  {landlineItem.is_active === false && (
                    <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Disabled (hidden from customers)
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1 font-mono">{landlineItem.id}</p>
              </div>
              <div className="text-right">
                <span className="text-xs text-gray-400">Current DB Range:</span>
                <div className="text-sm font-bold text-indigo-400">
                  £{((landlineItem.monthly_price_pence || 899) / 100).toFixed(2)} – £{((landlineItem.max_price_pence || 1999) / 100).toFixed(2)}
                </div>
              </div>
            </div>

            {renderActiveToggle(landlineItem)}

            <div className="grid grid-cols-2 gap-4 pt-2">
              {/* Lower Cost */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Lower Cost (£)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-400 text-sm">£</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formState[landlineItem.id].lowerCostGBP}
                    onChange={(e) => handleFieldChange(landlineItem.id, 'lowerCostGBP', e.target.value)}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl pl-7 pr-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                    placeholder="8.99"
                  />
                </div>
              </div>

              {/* Upper Cost */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Upper Cost (£)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-400 text-sm">£</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formState[landlineItem.id].upperCostGBP}
                    onChange={(e) => handleFieldChange(landlineItem.id, 'upperCostGBP', e.target.value)}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl pl-7 pr-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                    placeholder="19.99"
                  />
                </div>
              </div>

              {/* Lower Allowance */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Lower Voice Allowance (mins)</label>
                <input
                  type="number"
                  value={formState[landlineItem.id].lowerAllowance}
                  onChange={(e) => handleFieldChange(landlineItem.id, 'lowerAllowance', e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                  placeholder="10"
                />
              </div>

              {/* Upper Allowance */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Upper Voice Allowance (mins)</label>
                <input
                  type="number"
                  value={formState[landlineItem.id].upperAllowance}
                  onChange={(e) => handleFieldChange(landlineItem.id, 'upperAllowance', e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                  placeholder="30"
                />
              </div>
            </div>

            {renderWordingControls(landlineItem)}

            {/* Steps calculation preview */}
            <div className="p-3 bg-gray-950 rounded-xl border border-gray-800 text-[11px] text-gray-400">
              <span className="font-semibold text-indigo-300">Live Scale Projection: </span>
              {getStepsSummary(
                formState[landlineItem.id].lowerCostGBP,
                formState[landlineItem.id].upperCostGBP,
                formState[landlineItem.id].lowerAllowance,
                formState[landlineItem.id].upperAllowance,
                formState[landlineItem.id].stepPence || '100',
                'mins'
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => handleSaveSlidingAddon(landlineItem.id, 'landline', landlineItem.name)}
                disabled={savingId === landlineItem.id}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg transition-colors flex items-center gap-2 cursor-pointer"
              >
                {savingId === landlineItem.id ? 'Saving Landline...' : 'Save Landline Scale'}
              </button>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* 2. MOBILE PHONE NUMBER BOLT-ON                                    */}
        {/* ================================================================= */}
        {mobileItem && formState[mobileItem.id] && (
          <div className="bg-gray-900 border border-gray-800 hover:border-indigo-500/50 rounded-2xl p-6 space-y-4 shadow-lg transition-all">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">📱</span>
                  <h3 className="text-base font-bold text-white">{mobileItem.name}</h3>
                  <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    Sliding Scale
                  </span>
                  {mobileItem.is_active === false && (
                    <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Disabled (hidden from customers)
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1 font-mono">{mobileItem.id}</p>
              </div>
              <div className="text-right">
                <span className="text-xs text-gray-400">Current DB Range:</span>
                <div className="text-sm font-bold text-indigo-400">
                  £{((mobileItem.monthly_price_pence || 1099) / 100).toFixed(2)} – £{((mobileItem.max_price_pence || 1499) / 100).toFixed(2)}
                </div>
              </div>
            </div>

            {renderActiveToggle(mobileItem)}

            <div className="grid grid-cols-2 gap-4 pt-2">
              {/* Lower Cost */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Lower Cost (£)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-400 text-sm">£</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formState[mobileItem.id].lowerCostGBP}
                    onChange={(e) => handleFieldChange(mobileItem.id, 'lowerCostGBP', e.target.value)}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl pl-7 pr-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                    placeholder="10.99"
                  />
                </div>
              </div>

              {/* Upper Cost */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Upper Cost (£)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-400 text-sm">£</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formState[mobileItem.id].upperCostGBP}
                    onChange={(e) => handleFieldChange(mobileItem.id, 'upperCostGBP', e.target.value)}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl pl-7 pr-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                    placeholder="14.99"
                  />
                </div>
              </div>

              {/* Lower SMS Allowance */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Lower SMS Allowance</label>
                <input
                  type="number"
                  value={formState[mobileItem.id].lowerAllowance}
                  onChange={(e) => handleFieldChange(mobileItem.id, 'lowerAllowance', e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                  placeholder="50"
                />
              </div>

              {/* Upper SMS Allowance */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Upper SMS Allowance</label>
                <input
                  type="number"
                  value={formState[mobileItem.id].upperAllowance}
                  onChange={(e) => handleFieldChange(mobileItem.id, 'upperAllowance', e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                  placeholder="250"
                />
              </div>

              {/* WhatsApp + SMS note (voice minutes removed) */}
              <div className="col-span-2 p-3 bg-gray-950/60 rounded-xl border border-gray-800 text-[11px] text-gray-400 flex items-center gap-2">
                <span>💬</span>
                <span>Dedicated UK mobile number allocated strictly for WhatsApp and SMS messaging (shared voice minutes disabled).</span>
              </div>
            </div>

            {renderWordingControls(mobileItem)}

            {/* Steps calculation preview */}
            <div className="p-3 bg-gray-950 rounded-xl border border-gray-800 text-[11px] text-gray-400">
              <span className="font-semibold text-indigo-300">Live Scale Projection: </span>
              {getStepsSummary(
                formState[mobileItem.id].lowerCostGBP,
                formState[mobileItem.id].upperCostGBP,
                formState[mobileItem.id].lowerAllowance,
                formState[mobileItem.id].upperAllowance,
                formState[mobileItem.id].stepPence || '100',
                'SMS'
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => handleSaveSlidingAddon(mobileItem.id, 'mobile', mobileItem.name)}
                disabled={savingId === mobileItem.id}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg transition-colors flex items-center gap-2 cursor-pointer"
              >
                {savingId === mobileItem.id ? 'Saving Mobile...' : 'Save Mobile Scale'}
              </button>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* 3. VOICE MINUTES PACK BOLT-ON                                    */}
        {/* ================================================================= */}
        {voicePackItem && formState[voicePackItem.id] && (
          <div className="bg-gray-900 border border-gray-800 hover:border-indigo-500/50 rounded-2xl p-6 space-y-4 shadow-lg transition-all">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">🎙️</span>
                  <h3 className="text-base font-bold text-white">Voice Minutes Pack</h3>
                  <span className="bg-purple-500/10 text-purple-400 border border-purple-500/30 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    3-Mo Expiry (One-off)
                  </span>
                  {voicePackItem.is_active === false && (
                    <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Disabled (hidden from customers)
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1 font-mono">{voicePackItem.id}</p>
              </div>
              <div className="text-right">
                <span className="text-xs text-gray-400">Current DB Range:</span>
                <div className="text-sm font-bold text-indigo-400">
                  £{((voicePackItem.monthly_price_pence || 1500) / 100).toFixed(2)} – £{((voicePackItem.max_price_pence || 5000) / 100).toFixed(2)}
                </div>
              </div>
            </div>

            {renderActiveToggle(voicePackItem)}

            <div className="grid grid-cols-2 gap-4 pt-2">
              {/* Lower Cost */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Lower Cost (£)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-400 text-sm">£</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formState[voicePackItem.id].lowerCostGBP}
                    onChange={(e) => handleFieldChange(voicePackItem.id, 'lowerCostGBP', e.target.value)}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl pl-7 pr-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                    placeholder="15.00"
                  />
                </div>
              </div>

              {/* Upper Cost */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Upper Cost (£)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-400 text-sm">£</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formState[voicePackItem.id].upperCostGBP}
                    onChange={(e) => handleFieldChange(voicePackItem.id, 'upperCostGBP', e.target.value)}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl pl-7 pr-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                    placeholder="50.00"
                  />
                </div>
              </div>

              {/* Lower Voice Minutes */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Lower Voice Allowance (mins)</label>
                <input
                  type="number"
                  value={formState[voicePackItem.id].lowerAllowance}
                  onChange={(e) => handleFieldChange(voicePackItem.id, 'lowerAllowance', e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                  placeholder="20"
                />
              </div>

              {/* Upper Voice Minutes */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Upper Voice Allowance (mins)</label>
                <input
                  type="number"
                  value={formState[voicePackItem.id].upperAllowance}
                  onChange={(e) => handleFieldChange(voicePackItem.id, 'upperAllowance', e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                  placeholder="100"
                />
              </div>
            </div>

            {renderWordingControls(voicePackItem)}

            {/* Steps calculation preview */}
            <div className="p-3 bg-gray-950 rounded-xl border border-gray-800 text-[11px] text-gray-400">
              <span className="font-semibold text-indigo-300">Live Scale Projection: </span>
              {getStepsSummary(
                formState[voicePackItem.id].lowerCostGBP,
                formState[voicePackItem.id].upperCostGBP,
                formState[voicePackItem.id].lowerAllowance,
                formState[voicePackItem.id].upperAllowance,
                formState[voicePackItem.id].stepPence || '100',
                'mins'
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => handleSaveSlidingAddon(voicePackItem.id, 'voice_pack', voicePackItem.name)}
                disabled={savingId === voicePackItem.id}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg transition-colors flex items-center gap-2 cursor-pointer"
              >
                {savingId === voicePackItem.id ? 'Saving Voice Pack...' : 'Save Voice Scale'}
              </button>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* 4. SMS MESSAGES PACK BOLT-ON                                      */}
        {/* ================================================================= */}
        {smsPackItem && formState[smsPackItem.id] && (
          <div className="bg-gray-900 border border-gray-800 hover:border-indigo-500/50 rounded-2xl p-6 space-y-4 shadow-lg transition-all">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">✉️</span>
                  <h3 className="text-base font-bold text-white">SMS Credit Pack</h3>
                  <span className="bg-purple-500/10 text-purple-400 border border-purple-500/30 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    3-Mo Expiry (One-off)
                  </span>
                  {smsPackItem.is_active === false && (
                    <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Disabled (hidden from customers)
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1 font-mono">{smsPackItem.id}</p>
              </div>
              <div className="text-right">
                <span className="text-xs text-gray-400">Current DB Range:</span>
                <div className="text-sm font-bold text-indigo-400">
                  £{((smsPackItem.monthly_price_pence || 599) / 100).toFixed(2)} – £{((smsPackItem.max_price_pence || 1499) / 100).toFixed(2)}
                </div>
              </div>
            </div>

            {renderActiveToggle(smsPackItem)}

            <div className="grid grid-cols-2 gap-4 pt-2">
              {/* Lower Cost */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Lower Cost (£)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-400 text-sm">£</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formState[smsPackItem.id].lowerCostGBP}
                    onChange={(e) => handleFieldChange(smsPackItem.id, 'lowerCostGBP', e.target.value)}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl pl-7 pr-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                    placeholder="5.99"
                  />
                </div>
              </div>

              {/* Upper Cost */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Upper Cost (£)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-400 text-sm">£</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formState[smsPackItem.id].upperCostGBP}
                    onChange={(e) => handleFieldChange(smsPackItem.id, 'upperCostGBP', e.target.value)}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl pl-7 pr-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                    placeholder="14.99"
                  />
                </div>
              </div>

              {/* Lower SMS Allowance */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Lower SMS Allowance</label>
                <input
                  type="number"
                  value={formState[smsPackItem.id].lowerAllowance}
                  onChange={(e) => handleFieldChange(smsPackItem.id, 'lowerAllowance', e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                  placeholder="100"
                />
              </div>

              {/* Upper SMS Allowance */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1">Upper SMS Allowance</label>
                <input
                  type="number"
                  value={formState[smsPackItem.id].upperAllowance}
                  onChange={(e) => handleFieldChange(smsPackItem.id, 'upperAllowance', e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white font-mono font-semibold focus:outline-none focus:border-indigo-500"
                  placeholder="500"
                />
              </div>
            </div>

            {renderWordingControls(smsPackItem)}

            {/* Steps calculation preview */}
            <div className="p-3 bg-gray-950 rounded-xl border border-gray-800 text-[11px] text-gray-400">
              <span className="font-semibold text-indigo-300">Live Scale Projection: </span>
              {getStepsSummary(
                formState[smsPackItem.id].lowerCostGBP,
                formState[smsPackItem.id].upperCostGBP,
                formState[smsPackItem.id].lowerAllowance,
                formState[smsPackItem.id].upperAllowance,
                formState[smsPackItem.id].stepPence || '100',
                'SMS'
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => handleSaveSlidingAddon(smsPackItem.id, 'sms_pack', smsPackItem.name)}
                disabled={savingId === smsPackItem.id}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg transition-colors flex items-center gap-2 cursor-pointer"
              >
                {savingId === smsPackItem.id ? 'Saving SMS Pack...' : 'Save SMS Scale'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Fixed Bolt-ons Section (WhatsApp, Knowledge Base Chunks) */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <span>📦</span> Fixed Channel Bolt-ons & Capacity Packs
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            Modular components with fixed monthly pricing and included capacity allowances.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 pt-2">
          {/* WhatsApp Addon */}
          {whatsappAddon && formState[whatsappAddon.id] && (
            <div className={`bg-gray-950 border ${whatsappAddon.is_active === false ? 'border-amber-500/40' : 'border-gray-800'} p-4 rounded-xl space-y-3`}>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>💬</span> {whatsappAddon.name || 'WhatsApp Add-on'}
                </span>
                <div className="flex items-center gap-1.5">
                  {whatsappAddon.is_active === false ? (
                    <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Disabled (hidden from customers)
                    </span>
                  ) : (
                    <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      Active
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400 font-mono">whatsapp_addon</span>
                </div>
              </div>

              {renderActiveToggle(whatsappAddon)}

              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Monthly Price (£)</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-gray-400 text-xs">£</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formState[whatsappAddon.id].lowerCostGBP}
                    onChange={(e) => handleFieldChange(whatsappAddon.id, 'lowerCostGBP', e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-6 pr-2 py-1 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Included Messages</label>
                <input
                  type="number"
                  value={formState[whatsappAddon.id].lowerAllowance}
                  onChange={(e) => handleFieldChange(whatsappAddon.id, 'lowerAllowance', e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-white font-mono"
                />
              </div>

              {renderWordingControls(whatsappAddon)}

              <button
                onClick={() => handleSaveFixedAddon(whatsappAddon.id, whatsappAddon.name, formState[whatsappAddon.id].lowerCostGBP, formState[whatsappAddon.id].lowerAllowance, 'included_messages')}
                disabled={savingId === whatsappAddon.id}
                className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
              >
                {savingId === whatsappAddon.id ? 'Saving...' : 'Save WhatsApp Add-on'}
              </button>
            </div>
          )}

          {/* Data Pack (500 Chunks) */}
          {dataPack && formState[dataPack.id] && (
            <div className={`bg-gray-950 border ${dataPack.is_active === false ? 'border-amber-500/40' : 'border-gray-800'} p-4 rounded-xl space-y-3`}>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-white">📚 Extra Knowledge (Knowledge Items)</span>
                <div className="flex items-center gap-1.5">
                  {dataPack.is_active === false ? (
                    <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Disabled (hidden from customers)
                    </span>
                  ) : (
                    <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      Active
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400 font-mono">{dataPack.id}</span>
                </div>
              </div>

              {renderActiveToggle(dataPack)}

              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Monthly Price (£)</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-gray-400 text-xs">£</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formState[dataPack.id].lowerCostGBP}
                    onChange={(e) => handleFieldChange(dataPack.id, 'lowerCostGBP', e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-6 pr-2 py-1 text-xs text-white font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Included Knowledge Items</label>
                <input
                  type="number"
                  value={formState[dataPack.id].lowerAllowance}
                  onChange={(e) => handleFieldChange(dataPack.id, 'lowerAllowance', e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-white font-mono"
                />
              </div>

              {renderWordingControls(dataPack)}

              <button
                onClick={() => handleSaveFixedAddon(dataPack.id, dataPack.name, formState[dataPack.id].lowerCostGBP, formState[dataPack.id].lowerAllowance, 'included_data_chunks')}
                disabled={savingId === dataPack.id}
                className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
              >
                {savingId === dataPack.id ? 'Saving...' : 'Save Knowledge Pack'}
              </button>
            </div>
          )}

          {/* Google Calendar Integration */}
          {googleCalendarItem && formState[googleCalendarItem.id] && (
            <div className={`bg-gray-950 border ${googleCalendarItem.is_active === false ? 'border-amber-500/40' : 'border-gray-800'} p-4 rounded-xl space-y-3`}>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>📅</span> Google Calendar
                </span>
                <div className="flex items-center gap-1.5">
                  {googleCalendarItem.is_active === false ? (
                    <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Disabled (hidden from customers)
                    </span>
                  ) : (
                    <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      Active
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400 font-mono">google_calendar_addon</span>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 leading-tight">
                Two-way Google Calendar synchronization for bookings & rotas.
              </p>

              {renderActiveToggle(googleCalendarItem)}

              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Monthly Price (£)</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-gray-400 text-xs">£</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formState[googleCalendarItem.id].lowerCostGBP}
                    onChange={(e) => handleFieldChange(googleCalendarItem.id, 'lowerCostGBP', e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-6 pr-2 py-1 text-xs text-white font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Included Integration</label>
                <input
                  type="text"
                  disabled
                  value="Full 2-Way Sync"
                  className="w-full bg-gray-900/60 border border-gray-800 rounded-lg px-2.5 py-1 text-xs text-gray-400 font-mono cursor-not-allowed"
                />
              </div>

              {renderWordingControls(googleCalendarItem)}

              <button
                onClick={() => handleSaveFixedAddon(googleCalendarItem.id, googleCalendarItem.name, formState[googleCalendarItem.id].lowerCostGBP, '1', 'display_order')}
                disabled={savingId === googleCalendarItem.id}
                className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
              >
                {savingId === googleCalendarItem.id ? 'Saving...' : 'Save Google Calendar'}
              </button>
            </div>
          )}

          {/* Microsoft Outlook Calendar Integration */}
          {microsoftCalendarItem && formState[microsoftCalendarItem.id] && (
            <div className={`bg-gray-950 border ${microsoftCalendarItem.is_active === false ? 'border-amber-500/40' : 'border-gray-800'} p-4 rounded-xl space-y-3`}>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>📅</span> Microsoft Calendar
                </span>
                <div className="flex items-center gap-1.5">
                  {microsoftCalendarItem.is_active === false ? (
                    <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Disabled (hidden from customers)
                    </span>
                  ) : (
                    <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      Active
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400 font-mono">microsoft_calendar_addon</span>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 leading-tight">
                Two-way Microsoft Outlook Calendar synchronization for bookings & rotas.
              </p>

              {renderActiveToggle(microsoftCalendarItem)}

              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Monthly Price (£)</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-gray-400 text-xs">£</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formState[microsoftCalendarItem.id].lowerCostGBP}
                    onChange={(e) => handleFieldChange(microsoftCalendarItem.id, 'lowerCostGBP', e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-6 pr-2 py-1 text-xs text-white font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Included Integration</label>
                <input
                  type="text"
                  disabled
                  value="Full 2-Way Sync"
                  className="w-full bg-gray-900/60 border border-gray-800 rounded-lg px-2.5 py-1 text-xs text-gray-400 font-mono cursor-not-allowed"
                />
              </div>

              {renderWordingControls(microsoftCalendarItem)}

              <button
                onClick={() => handleSaveFixedAddon(microsoftCalendarItem.id, microsoftCalendarItem.name, formState[microsoftCalendarItem.id].lowerCostGBP, '1', 'display_order')}
                disabled={savingId === microsoftCalendarItem.id}
                className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
              >
                {savingId === microsoftCalendarItem.id ? 'Saving...' : 'Save Microsoft Calendar'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Audit Log Section */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>📜</span> Price & Allowance Change Audit Trail
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">Immutable record of modifications made to pricing and allowances.</p>
          </div>
          <span className="text-xs text-gray-500 font-mono">{auditLog.length} events</span>
        </div>

        <div className="overflow-x-auto max-h-60 overflow-y-auto border border-gray-800 rounded-xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-950/80 border-b border-gray-800">
                <th className="py-2.5 px-4 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Date & Time</th>
                <th className="py-2.5 px-4 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Admin / User</th>
                <th className="py-2.5 px-4 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Item</th>
                <th className="py-2.5 px-4 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Changes Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 text-xs">
              {auditLog.map((log) => {
                const d = new Date(log.created_at);
                return (
                  <tr key={log.id} className="hover:bg-gray-800/40 transition-colors">
                    <td className="py-2.5 px-4 text-gray-400 font-mono">
                      {d.toLocaleDateString()} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-2.5 px-4 text-gray-200 font-medium">{log.performed_by}</td>
                    <td className="py-2.5 px-4 text-indigo-400 font-mono text-[11px]">{log.item_id || log.item_type}</td>
                    <td className="py-2.5 px-4 text-gray-300">{log.summary}</td>
                  </tr>
                );
              })}
              {auditLog.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gray-500 italic">
                    No change records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
