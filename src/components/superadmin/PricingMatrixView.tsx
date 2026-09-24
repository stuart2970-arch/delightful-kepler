'use client';

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
        } else if (item.category === 'google_calendar') {
          lowerAllow = '1';
          upperAllow = '1';
        }

        stateObj[item.id] = {
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

    const updates: Record<string, any> = {
      monthly_price_pence: pricePence,
      max_price_pence: pricePence,
      [allowKey]: allowVal,
    };

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

  const landlineItem = addons.find((a) => a.id === 'landline_addon' || a.category === 'landline');
  const mobileItem = addons.find((a) => a.id === 'mobile_addon' || a.category === 'mobile');
  const voicePackItem = addons.find((a) => a.id === 'voice_pack_20' || a.category === 'voice_pack');
  const smsPackItem = addons.find((a) => a.id === 'sms_pack_100' || a.category === 'sms_pack');
  const whatsappAddon = addons.find((a) => a.id === 'whatsapp_addon');
  const dataPack = addons.find((a) => a.id === 'data_pack_500' || a.category === 'data_pack');
  const googleCalendarItem = addons.find((a) => a.id === 'google_calendar_addon' || a.category === 'google_calendar');

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
                    3-Mo Rollover
                  </span>
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
                onClick={() => handleSaveSlidingAddon(voicePackItem.id, 'voice_pack', 'Voice Minutes Pack')}
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
                onClick={() => handleSaveSlidingAddon(smsPackItem.id, 'sms_pack', 'SMS Messages Pack')}
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
          {/* WhatsApp Addon (Disabled / Foreseeable) */}
          {whatsappAddon && formState[whatsappAddon.id] && (
            <div className="bg-gray-950 border border-gray-800 p-4 rounded-xl space-y-3 opacity-40 filter grayscale pointer-events-none cursor-not-allowed select-none">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-white">💬 WhatsApp Add-on</span>
                <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">Disabled</span>
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Monthly Price (£)</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-gray-400 text-xs">£</span>
                  <input
                    disabled
                    type="number"
                    step="0.01"
                    value={formState[whatsappAddon.id].lowerCostGBP}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-6 pr-2 py-1 text-xs text-white font-mono cursor-not-allowed"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Included Messages</label>
                <input
                  disabled
                  type="number"
                  value={formState[whatsappAddon.id].lowerAllowance}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-white font-mono cursor-not-allowed"
                />
              </div>
              <button
                disabled
                className="w-full py-1.5 bg-gray-800 text-gray-500 text-[11px] font-bold rounded-lg cursor-not-allowed"
              >
                Channel Unavailable
              </button>
            </div>
          )}

          {/* Data Pack (500 Chunks) */}
          {dataPack && formState[dataPack.id] && (
            <div className="bg-gray-950 border border-gray-800 p-4 rounded-xl space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-white">📚 Knowledge Base Chunks</span>
                <span className="text-[10px] text-gray-400 font-mono">{dataPack.id}</span>
              </div>
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
                <label className="block text-[10px] text-gray-400 mb-1">Included Chunks</label>
                <input
                  type="number"
                  value={formState[dataPack.id].lowerAllowance}
                  onChange={(e) => handleFieldChange(dataPack.id, 'lowerAllowance', e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-white font-mono"
                />
              </div>
              <button
                onClick={() => handleSaveFixedAddon(dataPack.id, 'Knowledge Base Chunks', formState[dataPack.id].lowerCostGBP, formState[dataPack.id].lowerAllowance, 'included_data_chunks')}
                disabled={savingId === dataPack.id}
                className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
              >
                {savingId === dataPack.id ? 'Saving...' : 'Save Knowledge Pack'}
              </button>
            </div>
          )}

          {/* Google Calendar Integration */}
          {googleCalendarItem && formState[googleCalendarItem.id] && (
            <div className="bg-gray-950 border border-gray-800 p-4 rounded-xl space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>📅</span> Google Calendar
                </span>
                <span className="text-[10px] text-gray-400 font-mono">google_calendar_addon</span>
              </div>
              <p className="text-[10px] text-gray-400 leading-tight">
                Two-way Google Calendar synchronization for bookings & rotas.
              </p>
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
              <button
                onClick={() => handleSaveFixedAddon(googleCalendarItem.id, 'Google Calendar Integration', formState[googleCalendarItem.id].lowerCostGBP, '1', 'display_order')}
                disabled={savingId === googleCalendarItem.id}
                className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
              >
                {savingId === googleCalendarItem.id ? 'Saving...' : 'Save Google Calendar'}
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
