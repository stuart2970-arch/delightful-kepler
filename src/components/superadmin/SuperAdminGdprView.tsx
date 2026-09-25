'use client';

import React, { useState } from 'react';

interface TenantItem {
  id: string;
  company_name: string;
  slug?: string;
  plan_tier?: string;
}

interface SuperAdminGdprViewProps {
  tenants: TenantItem[];
}

export default function SuperAdminGdprView({ tenants }: SuperAdminGdprViewProps) {
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Deletion Modal State
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [confirmInput, setConfirmInput] = useState<string>('');
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deletionType, setDeletionType] = useState<'hard_delete' | 'anonymize'>('hard_delete');

  const selectedTenant = tenants.find(
    t => t.id === selectedTenantId || t.slug === selectedTenantId
  );

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedTenantId) {
      setErrorMsg('Please select a B2B business account (business name or slug).');
      return;
    }
    if (!searchQuery.trim()) {
      setErrorMsg('Please enter a customer Name, Email address, or Mobile telephone number.');
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSearching(true);
    setSearchResults(null);

    try {
      const res = await fetch('/api/superadmin/gdpr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'search',
          tenantId: selectedTenantId,
          searchQuery: searchQuery.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to search customer data');
      }

      setSearchResults(data);
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during GDPR search.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleExportJSON = () => {
    if (!searchResults || !searchResults.data) return;
    const blob = new Blob([JSON.stringify(searchResults, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slugName = searchResults.tenant?.slug || 'business';
    const querySanitized = searchQuery.trim().replace(/[^a-zA-Z0-9]/g, '_');
    a.download = `gdpr-export-${slugName}-${querySanitized}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    if (!searchResults || !searchResults.data) return;
    const appts = searchResults.data.appointments || [];
    const convs = searchResults.data.conversations || [];

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'RECORD_TYPE,ID,CUSTOMER_NAME,CUSTOMER_EMAIL,CUSTOMER_PHONE,DETAILS,CREATED_AT\n';

    appts.forEach((a: any) => {
      const line = [
        'APPOINTMENT',
        `"${a.id || ''}"`,
        `"${(a.customer_name || '').replace(/"/g, '""')}"`,
        `"${(a.customer_email || '').replace(/"/g, '""')}"`,
        `"${(a.customer_phone || '').replace(/"/g, '""')}"`,
        `"Start: ${a.start_time || ''}"`,
        `"${a.created_at || ''}"`
      ].join(',');
      csvContent += line + '\n';
    });

    convs.forEach((c: any) => {
      const line = [
        'CONVERSATION',
        `"${c.id || ''}"`,
        `"Session: ${c.user_session_id || ''}"`,
        '""',
        '""',
        `"${(c.transcript || '').replace(/"/g, '""').substring(0, 100)}"`,
        `"${c.created_at || ''}"`
      ].join(',');
      csvContent += line + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const slugName = searchResults.tenant?.slug || 'business';
    link.setAttribute('download', `gdpr-export-${slugName}-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExecuteDelete = async () => {
    if (confirmInput.trim() !== 'DELETE GDPR DATA') {
      alert('Confirmation string mismatch. Please type exactly "DELETE GDPR DATA" to proceed.');
      return;
    }

    setIsDeleting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/superadmin/gdpr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          tenantId: selectedTenantId,
          searchQuery: searchQuery.trim(),
          deletionType,
          confirmDelete: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to execute GDPR deletion');
      }

      setSuccessMsg(data.message || 'GDPR data deletion completed successfully.');
      setShowDeleteModal(false);
      setConfirmInput('');
      setSearchResults(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error executing deletion.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-red-950/60 via-slate-900 to-indigo-950/50 border border-red-800/40 rounded-2xl p-6 text-gray-100 shadow-xl">
        <div className="flex items-start justify-between">
          <div className="space-y-2 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-red-900/40 border border-red-500/40 rounded-full text-xs font-bold text-red-300">
              <span>🛡️</span> GDPR Compliance & Right to be Forgotten
            </div>
            <h2 className="text-2xl font-black text-white tracking-tight">
              End-User Data Erasure & Privacy Portal
            </h2>
            <p className="text-sm text-gray-300 leading-relaxed">
              Fulfill GDPR Right to Erasure requests instigated via FloBot or B2B Admin requests. Search for a customer by Name, Email address, or Mobile telephone number scoped strictly to any registered B2B business account.
            </p>
          </div>
        </div>
      </div>

      {/* Alert Messages */}
      {errorMsg && (
        <div className="p-4 bg-red-950/50 border border-red-600/60 rounded-xl text-red-200 text-sm font-medium flex items-center justify-between">
          <span>⚠️ {errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-xs text-red-400 hover:underline">Dismiss</button>
        </div>
      )}
      {successMsg && (
        <div className="p-4 bg-emerald-950/50 border border-emerald-600/60 rounded-xl text-emerald-200 text-sm font-medium flex items-center justify-between">
          <span>✅ {successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-xs text-emerald-400 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Search & Filter Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-5">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <span>🔍</span> 1. Select B2B Business & Target User Identifiers
        </h3>

        <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          {/* Business Select */}
          <div className="md:col-span-6 space-y-1.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">
              B2B Business Account (Name or Webpage Slug) *
            </label>
            <select
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 font-medium"
            >
              <option value="">-- Select B2B Account --</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.company_name} {t.slug ? `(${t.slug})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* User Identifier Search Input */}
          <div className="md:col-span-6 space-y-1.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">
              Customer Name, Email Address, or Mobile Phone *
            </label>
            <input
              type="text"
              placeholder="e.g. John Smith, john@example.com, or +447123456789"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 font-medium placeholder-gray-500"
            />
          </div>

          {/* Action Submit */}
          <div className="md:col-span-12 flex justify-end">
            <button
              type="submit"
              disabled={isSearching}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition shadow-md flex items-center gap-2"
            >
              {isSearching ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Searching Database...
                </>
              ) : (
                <>Instigate GDPR Search 🚀</>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Results Section */}
      {searchResults && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-6">
          {/* Header Summary */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Search Scope Confirmed</span>
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <span>🏢</span> {searchResults.tenant?.company_name} {searchResults.tenant?.slug && <span className="text-xs text-gray-400 font-mono">({searchResults.tenant.slug})</span>}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Target User Query: <span className="text-amber-300 font-mono font-semibold">{searchResults.searchQuery}</span>
              </p>
            </div>

            {/* Quick Export & Delete Action Buttons */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleExportJSON}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-gray-200 text-xs font-bold rounded-xl transition flex items-center gap-1.5"
              >
                <span>📥</span> Export JSON
              </button>
              <button
                onClick={handleExportCSV}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-gray-200 text-xs font-bold rounded-xl transition flex items-center gap-1.5"
              >
                <span>📊</span> Export CSV
              </button>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl transition shadow-lg flex items-center gap-1.5"
              >
                <span>🗑️</span> Safely Delete / Forget User Data
              </button>
            </div>
          </div>

          {/* Metrics Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl text-center">
              <div className="text-2xl font-black text-indigo-400">{searchResults.summary?.totalRecords || 0}</div>
              <div className="text-xs font-medium text-gray-400">Total Matched Records</div>
            </div>
            <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl text-center">
              <div className="text-2xl font-black text-teal-400">{searchResults.summary?.totalAppointments || 0}</div>
              <div className="text-xs font-medium text-gray-400">Appointments</div>
            </div>
            <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl text-center">
              <div className="text-2xl font-black text-purple-400">{searchResults.summary?.totalConversations || 0}</div>
              <div className="text-xs font-medium text-gray-400">Conversations</div>
            </div>
            <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl text-center">
              <div className="text-2xl font-black text-amber-400">{searchResults.summary?.totalMessages || 0}</div>
              <div className="text-xs font-medium text-gray-400">Messages & Transcripts</div>
            </div>
          </div>

          {/* Appointments Table */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <span>📅</span> Matched Appointments ({searchResults.data?.appointments?.length || 0})
            </h4>
            {searchResults.data?.appointments?.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs text-gray-300">
                  <thead className="bg-slate-950 text-gray-400 font-bold uppercase tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3">Customer Name</th>
                      <th className="px-4 py-3">Email Address</th>
                      <th className="px-4 py-3">Mobile Phone</th>
                      <th className="px-4 py-3">Start Time</th>
                      <th className="px-4 py-3">End Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {searchResults.data.appointments.map((appt: any) => (
                      <tr key={appt.id} className="hover:bg-slate-800/40">
                        <td className="px-4 py-3 font-semibold text-white">{appt.customer_name}</td>
                        <td className="px-4 py-3 text-indigo-300">{appt.customer_email}</td>
                        <td className="px-4 py-3 text-emerald-300">{appt.customer_phone || 'N/A'}</td>
                        <td className="px-4 py-3">{new Date(appt.start_time).toLocaleString()}</td>
                        <td className="px-4 py-3">{new Date(appt.end_time).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 bg-slate-950/40 border border-slate-800/60 rounded-xl text-xs text-gray-500 italic">
                No matching appointment records found for this user.
              </div>
            )}
          </div>

          {/* Conversations Table */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <span>💬</span> Matched Chat Sessions & Transcripts ({searchResults.data?.conversations?.length || 0})
            </h4>
            {searchResults.data?.conversations?.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs text-gray-300">
                  <thead className="bg-slate-950 text-gray-400 font-bold uppercase tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3">Session ID</th>
                      <th className="px-4 py-3">Created At</th>
                      <th className="px-4 py-3">Transcript Fragment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {searchResults.data.conversations.map((conv: any) => (
                      <tr key={conv.id} className="hover:bg-slate-800/40">
                        <td className="px-4 py-3 font-mono text-purple-300">{conv.user_session_id || conv.id}</td>
                        <td className="px-4 py-3">{new Date(conv.created_at).toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-300 max-w-md truncate">
                          {conv.transcript || 'No direct transcript text'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 bg-slate-950/40 border border-slate-800/60 rounded-xl text-xs text-gray-500 italic">
                No matching conversation sessions found for this user.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Safe Deletion Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-800/60 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-red-400 flex items-center gap-2">
                <span>⚠️</span> Confirm GDPR Data Erasure
              </h3>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="text-gray-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-gray-300">
              <p className="bg-red-950/40 border border-red-600/30 p-3 rounded-xl text-red-200">
                You are about to execute a permanent <strong>Right to be Forgotten (GDPR Erasure)</strong> operation. Data will be safely removed for the selected business account.
              </p>

              <div className="space-y-1 bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-[11px]">
                <div><span className="text-gray-500">Business:</span> <span className="text-white font-bold">{selectedTenant?.company_name}</span></div>
                <div><span className="text-gray-500">Target Query:</span> <span className="text-amber-300 font-bold">{searchQuery}</span></div>
                <div><span className="text-gray-500">Appointments to erase:</span> {searchResults?.summary?.totalAppointments || 0}</div>
                <div><span className="text-gray-500">Conversations to erase:</span> {searchResults?.summary?.totalConversations || 0}</div>
              </div>

              {/* Deletion Mode Selector */}
              <div className="space-y-1.5">
                <label className="block font-bold text-gray-300">Deletion Mode</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDeletionType('hard_delete')}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold transition ${
                      deletionType === 'hard_delete'
                        ? 'bg-red-600 border-red-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-gray-400 hover:text-white'
                    }`}
                  >
                    Hard Delete (Permanent Removal)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletionType('anonymize')}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold transition ${
                      deletionType === 'anonymize'
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-gray-400 hover:text-white'
                    }`}
                  >
                    Anonymize (PII Scrubbing)
                  </button>
                </div>
              </div>

              {/* Confirmation Input */}
              <div className="space-y-1.5 pt-2">
                <label className="block font-bold text-gray-200">
                  Type <span className="text-red-400 font-mono">DELETE GDPR DATA</span> to confirm:
                </label>
                <input
                  type="text"
                  placeholder="DELETE GDPR DATA"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  className="w-full bg-slate-950 border border-red-700/60 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-red-500 font-mono"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-gray-300 text-xs font-semibold rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmInput.trim() !== 'DELETE GDPR DATA' || isDeleting}
                onClick={handleExecuteDelete}
                className="px-5 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition shadow-lg flex items-center gap-1.5"
              >
                {isDeleting ? 'Erasing User Data...' : 'Confirm & Execute Deletion 🚨'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
