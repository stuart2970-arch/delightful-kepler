'use client';

import React, { useEffect, useMemo, useState } from 'react';

type TenantOption = {
  id: string;
  company_name: string;
};

type CatalogAddon = {
  id: string;
  name: string;
  category: string;
  monthly_price_pence: number;
  is_active?: boolean | null;
};

type Inclusion = {
  addon_catalog_id: string;
  included: boolean;
  price_paid_pence: number;
};

const ONE_OFF = new Set(['voice_pack', 'sms_pack']);

/**
 * Per-tenant include switch. A connected calendar does not mark a bolt-on as included.
 */
export default function IncludeOnAccountView({ tenants }: { tenants: TenantOption[] }) {
  const [tenantId, setTenantId] = useState(tenants[0]?.id || '');
  const [addons, setAddons] = useState<CatalogAddon[]>([]);
  const [inclusions, setInclusions] = useState<Record<string, Inclusion>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const monthlyAddons = useMemo(
    () => addons.filter((addon) => addon.is_active !== false && !ONE_OFF.has(addon.category) && addon.id !== 'whatsapp_primary'),
    [addons]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/superadmin/addon-catalog');
      const data = await res.json().catch(() => ({}));
      if (!cancelled && res.ok) setAddons(data.addons || []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      setError(null);
      const res = await fetch(`/api/superadmin/tenant-addon-inclusions?tenant_id=${encodeURIComponent(tenantId)}`);
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setError(data.error || 'Could not load include switches for this account.');
        setInclusions({});
        return;
      }
      const next: Record<string, Inclusion> = {};
      const nextPrices: Record<string, string> = {};
      for (const row of data.inclusions || []) {
        next[row.addon_catalog_id] = row;
        nextPrices[row.addon_catalog_id] = (Number(row.price_paid_pence || 0) / 100).toFixed(2);
      }
      setInclusions(next);
      setPrices(nextPrices);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const save = async (addon: CatalogAddon, included: boolean) => {
    setSavingId(addon.id);
    setError(null);
    setMessage(null);
    const pounds = Number(prices[addon.id] ?? ((addon.monthly_price_pence || 0) / 100).toFixed(2));
    if (!Number.isFinite(pounds) || pounds < 0) {
      setError('Enter a price of zero or more.');
      setSavingId(null);
      return;
    }
    const pricePaidPence = Math.round(pounds * 100);
    try {
      const res = await fetch('/api/superadmin/tenant-addon-inclusions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          addon_catalog_id: addon.id,
          included,
          price_paid_pence: pricePaidPence,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the include switch.');
      setInclusions((current) => ({
        ...current,
        [addon.id]: data.inclusion,
      }));
      setPrices((current) => ({ ...current, [addon.id]: (pricePaidPence / 100).toFixed(2) }));
      setMessage(included
        ? `${addon.name} is included on this account at £${(pricePaidPence / 100).toFixed(2)} per month.`
        : `The include switch for ${addon.name} is off.`);
    } catch (err: any) {
      setError(err.message || 'Could not save the include switch.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="text-lg font-bold text-white">Include on an account</h2>
        <p className="text-sm text-gray-400 mt-1">
          Turn a bolt-on on for one salon without a purchase. The price is what that salon pays each month, including a grandfathered price of zero. A connected calendar does not count on its own.
        </p>
      </div>

      <label className="block text-xs font-semibold text-gray-400">
        Account
        <select
          value={tenantId}
          onChange={(event) => setTenantId(event.target.value)}
          className="mt-1 block w-full max-w-md bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
        >
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.company_name || tenant.id}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="text-sm text-red-300">{error}</p>}
      {message && <p className="text-sm text-emerald-300">{message}</p>}

      <div className="space-y-3">
        {monthlyAddons.map((addon) => {
          const current = inclusions[addon.id];
          const included = current?.included === true;
          return (
            <div key={addon.id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-gray-950 border border-gray-800 rounded-xl p-4">
              <div>
                <p className="text-sm font-bold text-white">{addon.name}</p>
                <p className="text-xs text-gray-500">Catalogue £{((addon.monthly_price_pence || 0) / 100).toFixed(2)} per month</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs text-gray-400">
                  Price paid each month (£)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={prices[addon.id] ?? ((addon.monthly_price_pence || 0) / 100).toFixed(2)}
                    onChange={(event) => setPrices((currentPrices) => ({ ...currentPrices, [addon.id]: event.target.value }))}
                    className="mt-1 block w-28 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white"
                  />
                </label>
                <button
                  type="button"
                  disabled={savingId === addon.id}
                  onClick={() => save(addon, !included)}
                  className={`px-3 py-2 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50 ${
                    included
                      ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-gray-800 text-gray-200 border border-gray-700'
                  }`}
                >
                  {savingId === addon.id ? 'Saving...' : included ? 'Included — turn off' : 'Include on this account'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
