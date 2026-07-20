'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

type GlobalHoliday = {
  id: string;
  countries: string[];
  date: string;
  name: string;
};

type TenantStat = {
  id: string;
  company_name: string;
  plan_tier: string;
  created_at: string;
  messagesCount: number;
  crawlsCount: number;
};

export default function SuperadminClient({ tenants }: { tenants: TenantStat[] }) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredTenants = tenants.filter(t => 
    t.company_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.id.includes(searchTerm)
  );

  const totalMessages = tenants.reduce((acc, t) => acc + t.messagesCount, 0);
  const totalCrawls = tenants.reduce((acc, t) => acc + t.crawlsCount, 0);

  const [holidays, setHolidays] = useState<GlobalHoliday[]>([]);
  const [newHoliday, setNewHoliday] = useState({ countries: ['UK'], date: new Date().toISOString().split('T')[0], name: '' });
  const [isSavingHoliday, setIsSavingHoliday] = useState(false);

  const fetchHolidays = async () => {
    try {
      const res = await fetch('/api/global-holidays');
      if (res.ok) {
        const data = await res.json();
        setHolidays(data.holidays || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchHolidays();
  }, []);

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHoliday.name) return;
    setIsSavingHoliday(true);
    try {
      const res = await fetch('/api/global-holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHoliday)
      });
      if (res.ok) {
        setNewHoliday({ countries: ['UK'], date: new Date().toISOString().split('T')[0], name: '' });
        fetchHolidays();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingHoliday(false);
    }
  };

  const handleDeleteHoliday = async (id: string) => {
    if (!confirm('Delete this holiday?')) return;
    try {
      const res = await fetch(`/api/global-holidays?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setHolidays(holidays.filter(h => h.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Platform God Mode</h1>
          <p className="text-gray-400 mt-1">Global view of all tenants and API usage</p>
        </div>
        <Link href="/dashboard" className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-semibold rounded-lg transition-colors">
          Return to Dashboard
        </Link>
      </div>

      {/* Aggregate Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <p className="text-sm font-medium text-gray-400">Total Tenants</p>
          <p className="text-3xl font-bold text-white mt-2">{tenants.length}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <p className="text-sm font-medium text-gray-400">Total LLM Tokens (This Month)</p>
          <p className="text-3xl font-bold text-white mt-2">{totalMessages.toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <p className="text-sm font-medium text-gray-400">Total Website Crawls (This Month)</p>
          <p className="text-3xl font-bold text-white mt-2">{totalCrawls.toLocaleString()}</p>
        </div>
      </div>

      {/* Tenants Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Active Tenants</h2>
          <input 
            type="text" 
            placeholder="Search company or ID..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="bg-gray-950 border border-gray-800 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 w-64"
          />
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-950/50">
                <th className="px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Company</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Plan Tier</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Created</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Tokens Used</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Crawls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    No tenants found matching "{searchTerm}"
                  </td>
                </tr>
              ) : (
                filteredTenants.map(tenant => (
                  <tr key={tenant.id} className="hover:bg-gray-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-white">{tenant.company_name || 'Unnamed Tenant'}</div>
                      <div className="text-xs text-gray-500 mt-0.5 font-mono">{tenant.id}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
                        ${tenant.plan_tier === 'enterprise' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 
                          tenant.plan_tier === 'pro' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 
                          'bg-gray-800 text-gray-300 border border-gray-700'}`}>
                        {tenant.plan_tier || 'Free'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-400">
                      {new Date(tenant.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-right text-white">
                      {tenant.messagesCount.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-right text-white">
                      {tenant.crawlsCount.toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Global Holidays Manager */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden mt-8">
        <div className="p-4 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white">Global Public Holidays</h2>
          <p className="text-sm text-gray-400 mt-1">Managed across all tenants. Chatbots will prompt businesses to decide how to handle these dates.</p>
        </div>
        <div className="p-6">
          <form onSubmit={handleAddHoliday} className="flex flex-col md:flex-row gap-4 items-end mb-6 bg-gray-950 p-4 rounded-xl border border-gray-800">
            <div className="w-full md:w-auto">
              <label className="block text-xs font-semibold text-gray-400 mb-1">Countries (Ctrl/Cmd+Click to multi-select)</label>
              <select 
                multiple
                value={newHoliday.countries} 
                onChange={e => {
                  const options = Array.from(e.target.selectedOptions, option => option.value);
                  setNewHoliday({...newHoliday, countries: options});
                }} 
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white h-24"
              >
                <option value="UK">United Kingdom</option>
                <option value="ENG">England</option>
                <option value="SCT">Scotland</option>
                <option value="WAL">Wales</option>
                <option value="NIR">Northern Ireland</option>
                <option value="US">United States</option>
                <option value="CA">Canada</option>
                <option value="AU">Australia</option>
              </select>
            </div>
            <div className="w-full md:w-auto">
              <label className="block text-xs font-semibold text-gray-400 mb-1">Date</label>
              <input 
                type="date" 
                required 
                value={newHoliday.date} 
                onChange={e => setNewHoliday({...newHoliday, date: e.target.value})} 
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" 
              />
            </div>
            <div className="flex-1 w-full md:w-auto">
              <label className="block text-xs font-semibold text-gray-400 mb-1">Holiday Name</label>
              <input required type="text" placeholder="e.g. Christmas Day" value={newHoliday.name} onChange={e => setNewHoliday({...newHoliday, name: e.target.value})} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <button type="submit" disabled={isSavingHoliday} className="w-full md:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-lg h-[38px]">
              {isSavingHoliday ? 'Adding...' : 'Add Holiday'}
            </button>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {holidays.map(holiday => (
              <div key={holiday.id} className="bg-gray-950 border border-gray-800 p-4 rounded-xl flex items-center justify-between group">
                <div>
                  <div className="flex flex-wrap gap-1 mb-1">
                    {holiday.countries?.map(c => (
                      <span key={c} className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider bg-indigo-900/30 px-1.5 py-0.5 rounded border border-indigo-500/20">{c}</span>
                    ))}
                  </div>
                  <div className="font-bold text-white">{holiday.name}</div>
                  <div className="text-sm text-gray-400">{new Date(holiday.date).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' })}</div>
                </div>
                <button onClick={() => handleDeleteHoliday(holiday.id)} className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
              </div>
            ))}
            {holidays.length === 0 && (
              <div className="col-span-full text-center text-gray-500 py-8 text-sm italic">
                No holidays configured yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
