'use client';

import React, { useState } from 'react';
import { useDashboardStore } from '../../lib/store';

export default function PlatformSettingsView() {
  const { superadminData } = useDashboardStore();
  const [selectedSlug, setSelectedSlug] = useState('');
  const [manualSlug, setManualSlug] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const tenants = superadminData?.tenants || [];

  const handleSync = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const slugToSync = selectedSlug || manualSlug.trim();
    if (!slugToSync) {
      setNotification({ type: 'error', message: 'Please select a tenant or enter a custom slug.' });
      return;
    }

    setIsSyncing(true);
    setNotification(null);

    try {
      const res = await fetch('/api/tenants/settings/sync-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_slug: slugToSync })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to trigger cache sync.');
      }

      setNotification({
        type: 'success',
        message: `WordPress cache flushed successfully for slug "${slugToSync}"! (Post ID: ${data.wp_data?.post_id || 'N/A'})`
      });
      // Clear manual input on success
      setManualSlug('');
    } catch (err: any) {
      console.error(err);
      setNotification({
        type: 'error',
        message: err.message || 'An unexpected error occurred during sync.'
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Platform Title */}
      <div>
        <h3 className="text-xl font-bold text-[#260475]">Platform Caching & Webhooks</h3>
        <p className="text-xs text-[#434549] mt-0.5">Manage WordPress dynamic page synchronization and invalidation hooks.</p>
      </div>

      {/* Sleek Glassmorphism Action Card */}
      <div className="relative overflow-hidden rounded-2xl border border-white/20 bg-white/70 backdrop-blur-md p-8 shadow-xl shadow-slate-100/80">
        {/* Glow decorative element */}
        <div className="absolute top-0 right-0 -mr-6 -mt-6 w-32 h-32 bg-gradient-to-br from-[#198fd9]/10 to-transparent rounded-full pointer-events-none" />

        <div className="space-y-4">
          <div>
            <h4 className="text-base font-bold text-[#260475]">WordPress Cache Purging Sync</h4>
            <p className="text-xs text-[#434549] mt-1 leading-relaxed">
              Merchant profiles are cached statically on WordPress to maintain sub-second loading speeds and SEO metrics. 
              Triggering a sync dispatches a secure HMAC-signed request to the WordPress clear-cache REST API to clear the static page cache instantly.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSync} className="space-y-5 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Select Tenant Dropdown */}
              <div>
                <label className="block text-xs font-bold text-[#260475] mb-2">Registered Tenant Profiles</label>
                <select
                  value={selectedSlug}
                  onChange={(e) => {
                    setSelectedSlug(e.target.value);
                    if (e.target.value) setManualSlug(''); // Clear manual slug if selected from dropdown
                  }}
                  className="w-full h-[50px] bg-white border border-[#e2e8f0] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#198fd9] font-medium"
                >
                  <option value="">-- Choose Tenant --</option>
                  {tenants.map((t: any) => (
                    <option key={t.id} value={t.slug || ''}>
                      {t.company_name} ({t.slug || 'no slug'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Custom Slug Input */}
              <div>
                <label className="block text-xs font-bold text-[#260475] mb-2">Or enter Custom Slug</label>
                <input
                  type="text"
                  placeholder="e.g. crew-childwall"
                  value={manualSlug}
                  onChange={(e) => {
                    setManualSlug(e.target.value);
                    if (e.target.value) setSelectedSlug(''); // Clear dropdown selection if custom input is used
                  }}
                  className="w-full h-[50px] bg-white border border-[#e2e8f0] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#198fd9] font-medium"
                />
              </div>
            </div>

            {/* Sync button & spinner */}
            <div className="flex items-center gap-4 pt-2">
              <button
                type="submit"
                disabled={isSyncing}
                className="bg-[#198fd9] hover:bg-[#157ab9] text-white font-semibold rounded-[4px] px-[29px] py-[13px] text-sm shadow-md shadow-blue-500/10 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSyncing && (
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                {isSyncing ? 'Synchronizing Caches...' : 'Sync & Clear Cache'}
              </button>
            </div>
          </form>

          {/* Notifications */}
          {notification && (
            <div
              className={`p-4 rounded-xl border flex items-start gap-3 mt-4 text-sm ${
                notification.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950 shadow-sm'
                  : 'bg-rose-50 border-rose-200 text-rose-950 shadow-sm'
              }`}
            >
              {notification.type === 'success' ? (
                <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              ) : (
                <svg className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              )}
              <span className="font-semibold leading-relaxed">{notification.message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}