'use client';

import React, { useState, useEffect } from 'react';

type WhatsAppAccountItem = {
  id: string;
  tenant_id: string;
  company_name: string;
  domain: string | null;
  waba_id: string;
  phone_number_id: string;
  display_phone: string;
  display_name: string;
  mode: string;
  status: string;
  quality_rating: string;
  messaging_limit: string;
  card_missing: boolean;
  payment_status: string;
  created_at: string;
  updated_at: string;
};

type DailyUsageItem = {
  id: string;
  tenant_id: string;
  company_name: string;
  date: string;
  inbound: number;
  outbound: number;
  outbound_template: number;
  service: number;
  utility: number;
  marketing: number;
  authentication: number;
  total_messages: number;
  created_at: string;
};

type UsageKpis = {
  totalAccounts: number;
  connectedAccounts: number;
  cardMissingAccounts: number;
  totalInbound: number;
  totalOutbound: number;
  totalOutboundTemplate: number;
  totalMessages: number;
  byCategory: {
    service: number;
    utility: number;
    marketing: number;
    authentication: number;
  };
};

export default function SuperAdminWhatsAppView() {
  const [kpis, setKpis] = useState<UsageKpis | null>(null);
  const [accounts, setAccounts] = useState<WhatsAppAccountItem[]>([]);
  const [dailyUsage, setDailyUsage] = useState<DailyUsageItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/superadmin/whatsapp-usage', { cache: 'no-store' });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setKpis(data.kpis);
      setAccounts(data.accounts || []);
      setDailyUsage(data.dailyUsage || []);
    } catch (err: any) {
      console.error('Failed to load WhatsApp usage:', err);
      setError(err.message || 'Error fetching data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleExportCsv = () => {
    setIsExporting(true);
    try {
      window.location.href = '/api/superadmin/whatsapp-usage?export=csv';
    } finally {
      setTimeout(() => setIsExporting(false), 2000);
    }
  };

  const filteredAccounts = accounts.filter(
    (acc) =>
      acc.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (acc.display_phone && acc.display_phone.includes(searchTerm)) ||
      (acc.display_name && acc.display_name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const filteredUsage = dailyUsage.filter((u) =>
    u.company_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* HEADER & ACTION BAR */}
      <div className="bg-gray-900 border border-gray-800 p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">💬</span>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              WhatsApp Business Platform Intelligence
            </h2>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
              Live Cloud API v21.0
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1 max-w-2xl">
            Multi-tenant WhatsApp usage telemetry, delivery rates, salon payment method health, and automated 90-day retention audit log.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold rounded-xl transition border border-gray-700"
          >
            {isLoading ? 'Refreshing...' : '↻ Refresh Data'}
          </button>
          <button
            onClick={handleExportCsv}
            disabled={isExporting}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition shadow flex items-center gap-2"
          >
            <span>📥</span>
            <span>{isExporting ? 'Generating CSV...' : 'Export to CSV'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/60 border border-rose-800 text-rose-300 rounded-xl text-xs font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
          <button onClick={fetchData} className="underline hover:text-white">
            Retry
          </button>
        </div>
      )}

      {/* TOP KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Active Accounts */}
        <div className="bg-gray-900 border border-gray-800 p-5 rounded-2xl space-y-1">
          <div className="flex justify-between items-center text-xs font-medium text-gray-400">
            <span>Connected Salons</span>
            <span className="text-emerald-400 font-bold">● Active</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white">
              {kpis ? kpis.connectedAccounts : '—'}
            </span>
            <span className="text-xs text-gray-400">
              / {kpis ? kpis.totalAccounts : '—'} total
            </span>
          </div>
          <p className="text-[11px] text-gray-500">Live multi-tenant WABAs</p>
        </div>

        {/* Card 2: Salons Missing Payment Card */}
        <div className={`p-5 rounded-2xl border space-y-1 ${
          kpis && kpis.cardMissingAccounts > 0
            ? 'bg-amber-950/30 border-amber-600/40 text-amber-200'
            : 'bg-gray-900 border-gray-800 text-gray-300'
        }`}>
          <div className="flex justify-between items-center text-xs font-medium">
            <span className="text-gray-400">Card Missing (Meta)</span>
            <span className="text-amber-400 text-sm">💳</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl font-extrabold ${kpis && kpis.cardMissingAccounts > 0 ? 'text-amber-400' : 'text-white'}`}>
              {kpis ? kpis.cardMissingAccounts : '—'}
            </span>
            <span className="text-xs text-gray-400">salons affected</span>
          </div>
          <p className="text-[11px] text-gray-400">
            {kpis && kpis.cardMissingAccounts > 0 ? '⚠️ Outbound messages blocked' : '✓ All cards active'}
          </p>
        </div>

        {/* Card 3: Total Inbound & Outbound */}
        <div className="bg-gray-900 border border-gray-800 p-5 rounded-2xl space-y-1">
          <div className="flex justify-between items-center text-xs font-medium text-gray-400">
            <span>Total Messages (30d)</span>
            <span className="text-indigo-400 font-bold">In / Out</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white">
              {kpis ? kpis.totalMessages.toLocaleString() : '—'}
            </span>
            <span className="text-xs text-gray-400">
              ({kpis ? kpis.totalInbound.toLocaleString() : 0} in, {kpis ? kpis.totalOutbound.toLocaleString() : 0} out)
            </span>
          </div>
          <p className="text-[11px] text-gray-500">Across all salon channels</p>
        </div>

        {/* Card 4: Utility & Template Breakdown */}
        <div className="bg-gray-900 border border-gray-800 p-5 rounded-2xl space-y-1">
          <div className="flex justify-between items-center text-xs font-medium text-gray-400">
            <span>Template Breakdown</span>
            <span className="text-blue-400 font-bold">en_GB</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white">
              {kpis ? kpis.totalOutboundTemplate.toLocaleString() : '—'}
            </span>
            <span className="text-xs text-gray-400">templates sent</span>
          </div>
          <p className="text-[11px] text-gray-500">
            Utility: {kpis ? kpis.byCategory.utility : 0} • Marketing: {kpis ? kpis.byCategory.marketing : 0}
          </p>
        </div>
      </div>

      {/* SEARCH FILTER */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by salon name, phone number, or verified display name..."
            className="w-full h-11 bg-gray-900 border border-gray-800 rounded-xl px-4 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-3 text-xs text-gray-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* SECTION 1: CONNECTED WHATSAPP ACCOUNTS */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow">
        <div className="p-5 border-b border-gray-800 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>📱 Active WhatsApp Salon Accounts</span>
              <span className="text-xs font-mono font-normal text-gray-400">
                ({filteredAccounts.length})
              </span>
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Live status, Meta Quality Ratings, daily messaging tiers, and payment card validation.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-gray-300">
            <thead className="bg-gray-950/70 text-gray-400 font-semibold border-b border-gray-800 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="px-5 py-3.5">Salon Name</th>
                <th className="px-5 py-3.5">WhatsApp Phone</th>
                <th className="px-5 py-3.5">Display Name</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5">Quality</th>
                <th className="px-5 py-3.5">Tier</th>
                <th className="px-5 py-3.5">Meta Card</th>
                <th className="px-5 py-3.5 text-right">Last Sync</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60 font-medium">
              {filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-gray-500 text-xs">
                    {searchTerm ? 'No WhatsApp accounts match your search.' : 'No WhatsApp accounts registered yet.'}
                  </td>
                </tr>
              ) : (
                filteredAccounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-gray-800/40 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-bold text-white">{acc.company_name}</div>
                      <div className="text-[10px] text-gray-500 font-mono">{acc.tenant_id}</div>
                    </td>
                    <td className="px-5 py-4 font-mono text-emerald-400 font-semibold">
                      {acc.display_phone || 'Pending'}
                    </td>
                    <td className="px-5 py-4 text-gray-300">
                      {acc.display_name || '—'}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        acc.status === 'connected'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : acc.status === 'verifying'
                          ? 'bg-blue-950 text-blue-300 border border-blue-800'
                          : 'bg-gray-800 text-gray-400'
                      }`}>
                        {acc.status}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="flex items-center gap-1.5 text-xs">
                        <span>{acc.quality_rating === 'GREEN' || acc.quality_rating === 'HIGH' ? '🟢' : acc.quality_rating === 'YELLOW' ? '🟡' : '⚪'}</span>
                        <span className="font-semibold">{acc.quality_rating}</span>
                      </span>
                    </td>
                    <td className="px-5 py-4 font-mono text-gray-300">
                      {acc.messaging_limit}
                    </td>
                    <td className="px-5 py-4">
                      {acc.card_missing ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-700 flex items-center gap-1 w-max">
                          <span>⚠️</span> Missing Card
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1 w-max">
                          <span>✓</span> Active
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right text-gray-500 font-mono text-[11px]">
                      {acc.updated_at ? new Date(acc.updated_at).toLocaleDateString() : 'N/A'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 2: DAILY USAGE & CATEGORY BREAKDOWN TABLE */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow">
        <div className="p-5 border-b border-gray-800 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>📊 Daily Usage &amp; Category Breakdown</span>
              <span className="text-xs font-mono font-normal text-gray-400">
                ({filteredUsage.length} records)
              </span>
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Breakdown by Meta conversation pricing model: Service (24h customer window), Utility, Marketing, and Authentication.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-gray-300">
            <thead className="bg-gray-950/70 text-gray-400 font-semibold border-b border-gray-800 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="px-5 py-3.5">Date</th>
                <th className="px-5 py-3.5">Salon Name</th>
                <th className="px-5 py-3.5 text-right">Inbound</th>
                <th className="px-5 py-3.5 text-right">Outbound Freeform</th>
                <th className="px-5 py-3.5 text-right">Templates</th>
                <th className="px-5 py-3.5 text-right">Service (24h)</th>
                <th className="px-5 py-3.5 text-right">Utility</th>
                <th className="px-5 py-3.5 text-right">Marketing</th>
                <th className="px-5 py-3.5 text-right">Total Messages</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60 font-mono">
              {filteredUsage.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-gray-500 text-xs font-sans">
                    No daily usage recorded yet. Usage increments automatically as webhooks process incoming and outbound messages.
                  </td>
                </tr>
              ) : (
                filteredUsage.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-800/40 transition-colors">
                    <td className="px-5 py-3.5 text-gray-400 font-semibold">{u.date}</td>
                    <td className="px-5 py-3.5 font-sans font-bold text-white">{u.company_name}</td>
                    <td className="px-5 py-3.5 text-right text-emerald-400">{u.inbound}</td>
                    <td className="px-5 py-3.5 text-right text-indigo-400">{u.outbound}</td>
                    <td className="px-5 py-3.5 text-right text-blue-400">{u.outbound_template}</td>
                    <td className="px-5 py-3.5 text-right text-gray-300">{u.service}</td>
                    <td className="px-5 py-3.5 text-right text-blue-300">{u.utility}</td>
                    <td className="px-5 py-3.5 text-right text-purple-300">{u.marketing}</td>
                    <td className="px-5 py-3.5 text-right font-bold text-white">{u.total_messages}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
