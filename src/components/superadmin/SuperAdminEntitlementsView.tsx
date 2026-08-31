'use client';
import { useState, useEffect } from 'react';

type Feature = {
  id: string;
  name: string;
  is_metered: boolean;
  category_id: string;
  display_order?: number;
  value_type?: 'numeric' | 'boolean';
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
  const [newFeature, setNewFeature] = useState({ 
    id: '', 
    name: '', 
    category_id: 'c1000000-0000-0000-0000-000000000001', 
    is_metered: false,
    value_type: 'numeric' as 'numeric' | 'boolean'
  });
  const [isCreating, setIsCreating] = useState(false);

  // Feature Editing state
  const [editingFeatureId, setEditingFeatureId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; value_type: 'numeric' | 'boolean' }>({ name: '', value_type: 'numeric' });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/superadmin/entitlements').then(res => res.json()),
      fetch('/api/superadmin/tiers').then(res => res.json())
    ]).then(([entRes, tiersRes]) => {
      const data = entRes.data || [];
      setEntitlements(data);
      setTiers(tiersRes.data || []);
      
      const uniqueMap = new Map<string, Feature>();
      data.forEach((e: Entitlement) => {
        if (e.features && !uniqueMap.has(e.feature_id)) {
          uniqueMap.set(e.feature_id, e.features);
        }
      });

      const unique = Array.from(uniqueMap.values()) as Feature[];
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

  const handleStartEdit = (feature: Feature) => {
    setEditingFeatureId(feature.id);
    setEditForm({
      name: feature.name,
      value_type: feature.value_type || 'numeric'
    });
  };

  const handleSaveFeatureEdit = async (featureId: string) => {
    setIsSavingEdit(true);
    try {
      const res = await fetch('/api/superadmin/features', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: featureId,
          name: editForm.name,
          value_type: editForm.value_type
        })
      });
      const data = await res.json();
      if (data.success) {
        setOrderedFeatures(prev => prev.map(f => f.id === featureId ? {
          ...f,
          name: editForm.name,
          value_type: editForm.value_type
        } : f));
        setEntitlements(prev => prev.map(e => e.feature_id === featureId ? {
          ...e,
          features: {
            ...e.features,
            name: editForm.name,
            value_type: editForm.value_type
          }
        } : e));
        setEditingFeatureId(null);
      } else {
        alert('Error updating feature: ' + (data.error || 'Unknown error'));
      }
    } catch (err: any) {
      alert('Error updating feature: ' + err.message);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteFeature = async (featureId: string, featureName: string) => {
    if (!confirm(`Are you sure you want to delete the feature "${featureName}" (${featureId})?\n\nThis will remove it from all pricing tiers and is irreversible.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/superadmin/features?id=${encodeURIComponent(featureId)}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        setOrderedFeatures(prev => prev.filter(f => f.id !== featureId));
        setEntitlements(prev => prev.filter(e => e.feature_id !== featureId));
      } else {
        alert('Error deleting feature: ' + (data.error || 'Failed to delete'));
      }
    } catch (err: any) {
      alert('Error deleting feature: ' + err.message);
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
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
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

    const [movedItem] = newOrder.splice(sourceIndex, 1);
    newOrder.splice(targetIndex, 0, movedItem);

    const updatedFeatures = newOrder.map((f, index) => ({
      ...f,
      display_order: index
    }));

    setOrderedFeatures(updatedFeatures);

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

  if (loading) return <div className="p-8 text-center text-gray-400 animate-pulse">Loading dynamic feature matrix...</div>;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden mt-8">
      <div className="p-4 border-b border-gray-800 flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold text-white">Dynamic Tier Entitlements</h2>
          <p className="text-sm text-gray-400 mt-1">Modify feature limits per tier in real-time. Features can be edited, deleted, or assigned Numeric vs Boolean (1=Yes / 0=No) types.</p>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-950/50">
              <th className="px-6 py-4 text-sm font-semibold text-gray-300 w-1/3">Feature</th>
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
              const isEditing = editingFeatureId === feature.id;
              const isBoolean = (feature.value_type || 'numeric') === 'boolean';

              return (
                <tr 
                  key={feature.id} 
                  className={`hover:bg-gray-800/30 transition-colors ${draggedFeatureId === feature.id ? 'opacity-50 bg-gray-800' : ''}`}
                  draggable={!isEditing}
                  onDragStart={(e) => handleDragStart(e, feature.id)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, feature.id)}
                  onDragEnd={() => setDraggedFeatureId(null)}
                >
                  <td className="px-6 py-4 cursor-grab active:cursor-grabbing">
                    {isEditing ? (
                      <div className="space-y-2 p-2 bg-gray-950/80 rounded-xl border border-indigo-500/50">
                        <div>
                          <label className="text-[10px] uppercase font-bold text-gray-400">Display Name</label>
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                            className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1 text-xs text-white outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-gray-400">Feature Type</label>
                          <select
                            value={editForm.value_type}
                            onChange={e => setEditForm({ ...editForm, value_type: e.target.value as 'numeric' | 'boolean' })}
                            className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1 text-xs text-white outline-none focus:border-indigo-500"
                          >
                            <option value="numeric">Numeric (e.g. 500 chunks, 1000 msgs, UNLIMITED)</option>
                            <option value="boolean">Boolean (1 = Yes / 0 = No)</option>
                          </select>
                        </div>
                        <div className="flex gap-2 justify-end pt-1">
                          <button
                            onClick={() => setEditingFeatureId(null)}
                            className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSaveFeatureEdit(feature.id)}
                            disabled={isSavingEdit}
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded transition-colors disabled:opacity-50"
                          >
                            {isSavingEdit ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="group flex items-start justify-between">
                        <div className="flex items-start gap-2.5">
                          <span className="text-gray-500 hover:text-gray-300 mt-0.5">⋮⋮</span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-200">{feature.name}</span>
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                isBoolean 
                                  ? 'bg-purple-500/10 text-purple-300 border-purple-500/30' 
                                  : 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                              }`}>
                                {isBoolean ? '1 = Yes / 0 = No' : 'Numeric'}
                              </span>
                            </div>
                            <div className="text-xs text-gray-500 mt-1 text-[10px] font-mono">{feature.id}</div>
                          </div>
                        </div>

                        {/* Edit & Delete Action Buttons */}
                        <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity ml-2">
                          <button
                            onClick={() => handleStartEdit(feature)}
                            title="Edit feature settings"
                            className="p-1 hover:bg-gray-800 text-gray-400 hover:text-indigo-300 rounded transition-colors"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => handleDeleteFeature(feature.id, feature.name)}
                            title="Delete feature permanently"
                            className="p-1 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded transition-colors"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                  
                  {tiers.map(tier => {
                    const ent = entitlements.find(e => e.tier_id === tier.id && e.feature_id === feature.id);
                    const rawVal = ent ? ent.limit_value : 0;
                    const val = ent ? (ent.limit_value === null ? 'UNLIMITED' : String(ent.limit_value)) : '0';
                    
                    return (
                      <td key={tier.id} className="px-6 py-4 text-center border-l border-gray-800/50">
                        {isBoolean ? (
                          <select
                            value={rawVal === null || rawVal > 0 ? '1' : '0'}
                            onChange={(e) => handleLimitChange(tier.id, feature.id, e.target.value)}
                            className={`w-full max-w-[120px] mx-auto border rounded px-2.5 py-1 text-center text-xs font-semibold outline-none transition-all cursor-pointer ${
                              rawVal === null || rawVal > 0
                                ? 'bg-emerald-950/60 text-emerald-400 border-emerald-500/40 focus:border-emerald-400'
                                : 'bg-gray-950 text-gray-400 border-gray-700 focus:border-gray-500'
                            }`}
                          >
                            <option value="1">1 (Yes / Enabled)</option>
                            <option value="0">0 (No / Disabled)</option>
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={val}
                            onChange={(e) => {
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
                            placeholder="UNLIMITED or number"
                          />
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

      <div className="p-4 border-t border-gray-800 bg-gray-900">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2.5">+ Add New Feature</h3>
        <form onSubmit={handleCreateFeature} className="flex flex-wrap gap-3 items-center">
          <input 
            type="text" 
            placeholder="Feature ID (e.g. custom_branding)" 
            value={newFeature.id}
            onChange={(e) => setNewFeature({...newFeature, id: e.target.value.toLowerCase().replace(/\s+/g, '_')})}
            className="bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm text-white w-60 outline-none focus:border-indigo-500 font-mono text-xs"
            required
          />
          <input 
            type="text" 
            placeholder="Display Name (e.g. Custom Branding)" 
            value={newFeature.name}
            onChange={(e) => setNewFeature({...newFeature, name: e.target.value})}
            className="bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm text-white w-64 outline-none focus:border-indigo-500"
            required
          />
          <select
            value={newFeature.value_type}
            onChange={(e) => setNewFeature({...newFeature, value_type: e.target.value as 'numeric' | 'boolean'})}
            className="bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm text-white w-56 outline-none focus:border-indigo-500"
          >
            <option value="numeric">Numeric (e.g. 500 chunks)</option>
            <option value="boolean">Boolean (1 = Yes / 0 = No)</option>
          </select>

          <button type="submit" disabled={isCreating} className="px-5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
            {isCreating ? 'Adding...' : '+ Add Feature'}
          </button>
        </form>
      </div>
    </div>
  );
}

