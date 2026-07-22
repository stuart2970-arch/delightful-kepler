'use client';
import { useState, useEffect } from 'react';

type Feature = {
  id: string;
  name: string;
  is_metered: boolean;
  category_id: string;
  display_order?: number;
};

type Tier = {
  id: string;
  name: string;
  monthly_price: number | null;
  yearly_price: number | null;
};

type Entitlement = {
  tier_id: string;
  feature_id: string;
  limit_value: number | null;
  features: Feature;
};

export default function SuperAdminEntitlementsView() {
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderedFeatures, setOrderedFeatures] = useState<Feature[]>([]);
  const [draggedFeatureId, setDraggedFeatureId] = useState<string | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [newFeature, setNewFeature] = useState({ id: '', name: '', category_id: 'c1000000-0000-0000-0000-000000000001', is_metered: false });
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/superadmin/entitlements').then(res => res.json()),
      fetch('/api/superadmin/tiers').then(res => res.json())
    ]).then(([entRes, tiersRes]) => {
      const data = entRes.data || [];
      setEntitlements(data);
      setTiers(tiersRes.data || []);
      
      const unique = Array.from(new Map(data.map((e: Entitlement) => [e.feature_id, e.features])).values()) as Feature[];
      unique.sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
      setOrderedFeatures(unique);
      
      setLoading(false);
    });
  }, []);

  const handleLimitChange = async (tier_id: string, feature_id: string, newLimit: string) => {
    const limit_value = newLimit === 'UNLIMITED' || newLimit === '' ? null : parseInt(newLimit, 10);
    
    // Optimistic UI update
    setEntitlements((prev) =>
      prev.map((item) =>
        item.tier_id === tier_id && item.feature_id === feature_id
          ? { ...item, limit_value }
          : item
      )
    );

    const res = await fetch('/api/superadmin/entitlements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier_id, feature_id, limit_value }),
    });
    
    if (!res.ok) {
      alert("Failed to update limit");
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-400 animate-pulse">Loading dynamic feature matrix...</div>;

  const handleTierPriceChange = async (tierId: string, field: 'monthly_price' | 'yearly_price', value: string) => {
    const numValue = value === '' ? 0 : parseFloat(value);
    setTiers(prev => prev.map(t => t.id === tierId ? { ...t, [field]: numValue } : t));
    
    try {
      await fetch('/api/superadmin/tiers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tierId, [field]: numValue })
      });
    } catch (err) {
      console.error("Failed to update tier pricing", err);
    }
  };

  const handleCreateFeature = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const res = await fetch('/api/superadmin/features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFeature)
      });
      const result = await res.json();
      if (result.success) {
        // Refresh page to load new feature and seeded entitlements
        window.location.reload();
      } else {
        alert("Error creating feature: " + result.error);
      }
    } catch (err) {
      console.error(err);
    }
    setIsCreating(false);
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    setDraggedFeatureId(id);
    // Needed for Firefox
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // allow drop
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain');
    setDraggedFeatureId(null);
    if (sourceId === targetId || !sourceId) return;

    const newOrder = [...orderedFeatures];
    const sourceIndex = newOrder.findIndex(f => f.id === sourceId);
    const targetIndex = newOrder.findIndex(f => f.id === targetId);

    if (sourceIndex < 0 || targetIndex < 0) return;

    // Reorder array
    const [movedItem] = newOrder.splice(sourceIndex, 1);
    newOrder.splice(targetIndex, 0, movedItem);

    // Update display_order property
    const updatedFeatures = newOrder.map((f, index) => ({
      ...f,
      display_order: index
    }));

    setOrderedFeatures(updatedFeatures);

    // Persist to backend
    const payload = updatedFeatures.map(f => ({ id: f.id, display_order: f.display_order }));
    try {
      await fetch('/api/superadmin/features/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: payload })
      });
    } catch (err) {
      console.error("Failed to reorder features", err);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden mt-8">
      <div className="p-4 border-b border-gray-800 flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold text-white">Dynamic Tier Entitlements</h2>
          <p className="text-sm text-gray-400 mt-1">Modify feature limits per tier in real-time. (Reductions automatically grandfather existing users).</p>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-950/50">
              <th className="px-6 py-4 text-sm font-semibold text-gray-300 w-1/4">Feature</th>
              {tiers.map(tier => (
                <th key={tier.id} className="px-6 py-2 text-sm font-semibold text-white capitalize text-center border-l border-gray-800">
                  <div className="mb-2">{tier.name}</div>
                  <div className="flex gap-2 justify-center font-normal">
                    <div className="flex flex-col items-center">
                      <span className="text-[9px] text-gray-500 uppercase">Monthly</span>
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400 text-xs">$</span>
                        <input 
                          type="number" 
                          className="w-16 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-xs text-center outline-none focus:border-indigo-500"
                          value={tier.monthly_price || 0}
                          onChange={(e) => handleTierPriceChange(tier.id, 'monthly_price', e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-[9px] text-gray-500 uppercase">Yearly</span>
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400 text-xs">$</span>
                        <input 
                          type="number" 
                          className="w-16 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-xs text-center outline-none focus:border-indigo-500"
                          value={tier.yearly_price || 0}
                          onChange={(e) => handleTierPriceChange(tier.id, 'yearly_price', e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {orderedFeatures.map(feature => {
              return (
                <tr 
                  key={feature.id} 
                  className={`hover:bg-gray-800/30 transition-colors ${draggedFeatureId === feature.id ? 'opacity-50 bg-gray-800' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, feature.id)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, feature.id)}
                  onDragEnd={() => setDraggedFeatureId(null)}
                >
                  <td className="px-6 py-4 cursor-grab active:cursor-grabbing">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 hover:text-gray-300">⋮⋮</span>
                      <div className="font-medium text-gray-200">{feature.name}</div>
                    </div>
                    <div className="text-xs text-gray-500 mt-1 text-[10px] font-mono">{feature.id}</div>
                  </td>
                  
                  {tiers.map(tier => {
                    const ent = entitlements.find(e => e.tier_id === tier.id && e.feature_id === feature.id);
                    const val = ent ? (ent.limit_value === null ? 'UNLIMITED' : String(ent.limit_value)) : '0';
                    
                    return (
                      <td key={tier.id} className="px-6 py-4 text-center border-l border-gray-800/50">
                        <input
                          type="text"
                          value={val}
                          onChange={(e) => {
                             // Temporary UI update, real change happens on blur/enter
                             setEntitlements(prev => prev.map(item => 
                               item.tier_id === tier.id && item.feature_id === feature.id
                                 ? { ...item, limit_value: e.target.value === 'UNLIMITED' || e.target.value === '' ? null : parseInt(e.target.value) || 0 }
                                 : item
                             ));
                          }}
                          onBlur={(e) => handleLimitChange(tier.id, feature.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleLimitChange(tier.id, feature.id, e.currentTarget.value);
                          }}
                          className="w-full max-w-[120px] mx-auto bg-gray-950 border border-gray-700 rounded px-2 py-1 text-center text-sm text-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="p-4 border-t border-gray-800 bg-gray-900">
        <form onSubmit={handleCreateFeature} className="flex gap-4 items-center">
          <input 
            type="text" 
            placeholder="Feature ID (e.g. custom_branding)" 
            value={newFeature.id}
            onChange={(e) => setNewFeature({...newFeature, id: e.target.value})}
            className="bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm text-white w-64 outline-none focus:border-indigo-500"
            required
          />
          <input 
            type="text" 
            placeholder="Display Name" 
            value={newFeature.name}
            onChange={(e) => setNewFeature({...newFeature, name: e.target.value})}
            className="bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm text-white w-64 outline-none focus:border-indigo-500"
            required
          />
          <button type="submit" disabled={isCreating} className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
            {isCreating ? 'Adding...' : '+ Add Feature'}
          </button>
        </form>
      </div>
    </div>
  );
}
