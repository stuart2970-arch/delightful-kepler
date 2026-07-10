'use client';

import { useState } from 'react';
import Link from 'next/link';

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
    </div>
  );
}
