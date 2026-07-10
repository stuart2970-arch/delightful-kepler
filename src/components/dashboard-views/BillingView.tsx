'use client';

import { useDashboardStore } from '@/lib/store';

export default function BillingView() {
  const { tenantId, isSuperAdmin, billingData } = useDashboardStore();

  const planTier = billingData?.planTier || 'free';
  
  // Usage metrics (safe defaults)
  const messagesUsed = billingData?.usage?.messages || 0;
  const chunksUsed = billingData?.usage?.chunks || 0;
  
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}