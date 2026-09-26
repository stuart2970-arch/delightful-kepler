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
    const isLocal = typeof window !== 'undefined' && (window.location.hostname.includes('localhost') || window.location.hostname.includes('.test'));
    const targetUrl = `${isLocal ? 'https://styleflo.test' : 'https://styleflo.ai'}/pricing?tenant_id=${tenantId}`;
    if (typeof window !== 'undefined' && window.top && window.top !== window) {
      window.top.location.href = targetUrl;
    } else {
      window.location.href = targetUrl;
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-2xl p-6 shadow-xl relative overflow-hidden">
        {/* Background Accent */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-[var(--awb-color5)]/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h2 className="text-xl font-bold text-[var(--awb-color8)]">Current Plan: <span className="capitalize text-[var(--awb-color5)] font-bold">{planTier}</span></h2>
            <p className="text-sm text-[var(--awb-color6)] mt-1">
              Your subscription and api quotas are managed via your main account.
            </p>
          </div>
          
          <button 
            onClick={handleUpgrade}
            className="bg-[#198fd9] hover:bg-[#157ab9] text-white text-xs font-bold py-2.5 px-5 rounded-[4px] shadow-sm transition-colors whitespace-nowrap flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            Upgrade Plan
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-2xl p-6">
          <h3 className="text-sm font-bold text-[var(--awb-color7)] mb-4">API Usage (This Month)</h3>
          
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[var(--awb-color6)] font-semibold">LLM Tokens Generated</span>
                <span className="text-[var(--awb-color8)] font-mono">{messagesUsed.toLocaleString()}</span>
              </div>
              <div className="w-full bg-[var(--awb-color3)] rounded-full h-2.5 overflow-hidden">
                <div className="bg-[var(--awb-color5)] h-2.5 rounded-full" style={{ width: `${Math.min((messagesUsed / 100000) * 100, 100)}%` }}></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[var(--awb-color6)] font-semibold">Knowledge Base Chunks</span>
                <span className="text-[var(--awb-color8)] font-mono">{chunksUsed.toLocaleString()}</span>
              </div>
              <div className="w-full bg-[var(--awb-color3)] rounded-full h-2.5 overflow-hidden">
                <div className="bg-[var(--awb-color4)] h-2.5 rounded-full" style={{ width: `${Math.min((chunksUsed / 500) * 100, 100)}%` }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
