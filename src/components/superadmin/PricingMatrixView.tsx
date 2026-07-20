'use client';

import React, { useState, useEffect } from 'react';

type Tier = {
  id: string;
  name: string;
  is_active: boolean;
};

type Feature = {
  id: string;
  category_id: string;
  name: string;
  is_metered: boolean;
  is_available: boolean;
  feature_categories: { name: string };
};

type Entitlement = {
  tier_id: string;
  feature_id: string;
  included_volume: number | null;
  string_value: string | null;
};

export default function PricingMatrixView() {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  
  const [isLoading, setIsLoading] = useState(true);

  const fetchMatrix = async () => {
    try {
      const res = await fetch('/api/superadmin/pricing-matrix');
      if (res.ok) {
        const data = await res.json();
        setTiers(data.tiers || []);
        setFeatures(data.features || []);
        setEntitlements(data.entitlements || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMatrix();
  }, []);

  const activeTiers = tiers.filter(t => t.is_active);

  if (isLoading) {
    return <div className="text-gray-400 p-8 text-center animate-pulse">Loading Matrix...</div>;
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden mt-8">
      <div className="p-4 border-b border-gray-800 flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold text-white">Pricing & Packaging Matrix</h2>
          <p className="text-sm text-gray-400 mt-1">Control features and limits for all active plans.</p>
        </div>
        <button className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-lg transition-colors">
          Create New Tier Version
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-950/50">
              <th className="px-6 py-4 text-sm font-semibold text-gray-300 w-1/4">Feature</th>
              {activeTiers.map(tier => (
                <th key={tier.id} className="px-6 py-4 text-sm font-semibold text-white capitalize text-center border-l border-gray-800">
                  {tier.name}
                  <div className="text-[10px] text-gray-500 font-normal uppercase tracking-wider">{tier.id}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {features.map(feature => {
              const isAvailable = feature.is_available;
              return (
                <tr key={feature.id} className={`hover:bg-gray-800/30 transition-colors ${!isAvailable ? 'opacity-40' : ''}`}>
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-200 flex items-center gap-2">
                      {feature.name}
                      {!isAvailable && <span className="text-[9px] uppercase tracking-wider bg-gray-800 px-1.5 py-0.5 rounded text-gray-400 font-semibold">Coming Soon</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{feature.feature_categories?.name}</div>
                  </td>
                  
                  {activeTiers.map(tier => {
                    const ent = entitlements.find(e => e.tier_id === tier.id && e.feature_id === feature.id);
                    
                    return (
                      <td key={`${tier.id}-${feature.id}`} className="px-6 py-4 text-center border-l border-gray-800">
                        {ent ? (
                          <div className="text-sm font-medium text-white">
                            {ent.string_value !== null ? ent.string_value : 
                              (ent.included_volume === null ? 'Unlimited' : 
                                (ent.included_volume === 1 && !feature.is_metered ? '✔' : ent.included_volume.toLocaleString()))}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-600 font-bold">X</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
