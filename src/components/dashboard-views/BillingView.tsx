'use client';

import { useState, useEffect } from 'react';
import { useDashboardStore } from '@/lib/store';

export default function BillingView() {
  const { tenantId, isSuperAdmin, billingData } = useDashboardStore();

  const planTier = billingData?.planTier || 'free';
  
  // Usage metrics (safe defaults)
  const messagesUsed = billingData?.usage?.messages || 0;
  const chunksUsed = billingData?.usage?.chunks || 0;

  const [showImpersonateModal, setShowImpersonateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/superadmin/impersonate/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        if (data.results) {
          setSearchResults(data.results);
        }
      } catch (err) {
        console.error('Failed to search tenants:', err);
      } finally {
        setIsSearching(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery]);
  
  const handleUpgrade = () => {
    // Redirect to WordPress pricing page, passing the tenant_id 
    // so WPMUDEV webhook can map the payment to this Supabase tenant.
    window.location.href = `https://styleflo.ai/pricing?tenant_id=${tenantId}`;
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        {/* Background Accent */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h2 className="text-xl font-bold text-white">Current Plan: <span className="capitalize text-indigo-400">{planTier}</span></h2>
            <p className="text-sm text-gray-400 mt-1">
              Your subscription and api quotas are managed via your main account.
            </p>
          </div>
          
          <button 
            onClick={handleUpgrade}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-6 rounded-xl shadow-lg transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            Upgrade Plan
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-950 border border-gray-900 rounded-2xl p-6">
          <h3 className="text-sm font-bold text-gray-300 mb-4">API Usage (This Month)</h3>
          
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400 font-semibold">LLM Tokens Generated</span>
                <span className="text-white font-mono">{messagesUsed.toLocaleString()}</span>
              </div>
              <div className="w-full bg-gray-900 rounded-full h-1.5 overflow-hidden">
                <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${Math.min((messagesUsed / 100000) * 100, 100)}%` }}></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400 font-semibold">Knowledge Base Chunks</span>
                <span className="text-white font-mono">{chunksUsed.toLocaleString()}</span>
              </div>
              <div className="w-full bg-gray-900 rounded-full h-1.5 overflow-hidden">
                <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${Math.min((chunksUsed / 500) * 100, 100)}%` }}></div>
              </div>
            </div>
          </div>
        </div>
        
        {isSuperAdmin && (
          <div className="bg-indigo-950/20 border border-indigo-900/30 rounded-2xl p-6">
            <h3 className="text-sm font-bold text-indigo-300 mb-2">Superadmin Overrides</h3>
            <p className="text-xs text-indigo-400/80 mb-4">
              You are viewing this as a superadmin. Normally, billing modifications are disabled here.
            </p>
            <div className="flex gap-2">
              <button className="bg-indigo-900 hover:bg-indigo-800 text-indigo-100 text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
                Force Sync Entitlements
              </button>
              <button 
                onClick={() => setShowImpersonateModal(true)}
                className="bg-amber-600/20 hover:bg-amber-600/40 border border-amber-600/50 text-amber-300 text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                Impersonate User
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Impersonate Modal */}
      {showImpersonateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-2xl w-full shadow-2xl relative overflow-hidden flex flex-col h-[80vh]">
            <div className="absolute top-0 left-0 w-full h-1 bg-amber-500"></div>
            
            <div className="flex justify-between items-center mb-6 shrink-0">
              <h3 className="text-xl font-bold text-white">Impersonate Tenant</h3>
              <button onClick={() => setShowImpersonateModal(false)} className="text-gray-400 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>

            <div className="shrink-0 mb-4">
              <input 
                type="text" 
                placeholder="Search by Business Name or Chatbot Name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors"
                autoFocus
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {isSearching ? (
                <div className="text-center py-8 text-gray-500 text-sm">Searching...</div>
              ) : searchResults.length > 0 ? (
                searchResults.map(res => (
                  <div key={res.tenant_id} className="bg-gray-950 border border-gray-800 rounded-xl p-4 flex items-center justify-between hover:border-gray-700 transition-colors group">
                    <div>
                      <div className="text-white font-bold">{res.company_name || 'Unnamed Business'}</div>
                      <div className="text-xs text-gray-400 mt-1">ID: <span className="font-mono text-gray-500">{res.tenant_id}</span></div>
                      {res.matched_chatbots && res.matched_chatbots.length > 0 && (
                        <div className="text-xs text-amber-500/80 mt-1">
                          Chatbots: {res.matched_chatbots.join(', ')}
                        </div>
                      )}
                    </div>
                    <button 
                      onClick={() => {
                        window.location.href = `/dashboard?tenant_id=${res.tenant_id}`;
                      }}
                      className="opacity-0 group-hover:opacity-100 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-all"
                    >
                      Impersonate
                    </button>
                  </div>
                ))
              ) : searchQuery.length >= 2 ? (
                <div className="text-center py-8 text-gray-500 text-sm">No tenants or chatbots found matching "{searchQuery}"</div>
              ) : (
                <div className="text-center py-8 text-gray-600 text-sm">Type at least 2 characters to search...</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}