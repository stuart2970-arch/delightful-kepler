import React, { useState } from 'react';
import AddOnUpsellModal, { AddOnCategory } from './AddOnUpsellModal';

export interface ThresholdAlert {
  featureId: string;
  featureName: string;
  percentUsed: number;
  currentUsage: number;
  limit: number;
  upgradeAddonId: string;
  upgradeAddonName: string;
  upgradePrice: number;
}

interface CapacityThresholdBannerProps {
  thresholds: ThresholdAlert[];
  tenantId: string;
}

export default function CapacityThresholdBanner({ thresholds, tenantId }: CapacityThresholdBannerProps) {
  const [activeUpsellCategory, setActiveUpsellCategory] = useState<AddOnCategory | null>(null);

  // Filter for thresholds that are at least 85% used
  const activeThresholds = thresholds.filter(t => t.percentUsed >= 85);

  if (activeThresholds.length === 0) {
    return null;
  }

  const handleUpgradeClick = (featureId: string) => {
    let category: AddOnCategory = 'voice_pack'; // Default fallback
    
    if (featureId.includes('voice')) {
      category = 'voice_pack';
    } else if (featureId.includes('sms')) {
      category = 'sms_pack';
    } else if (featureId.includes('knowledge') || featureId.includes('data')) {
      category = 'data_pack';
    }

    setActiveUpsellCategory(category);
  };

  return (
    <>
      <div className="space-y-3 mb-6 w-full">
        {activeThresholds.map((threshold) => (
          <div 
            key={threshold.featureId} 
            className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="bg-amber-100 p-2 rounded-full text-amber-600 shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="text-amber-800 font-semibold">
                  You have now used {threshold.percentUsed}% of your allocated {threshold.featureName}.
                </p>
                <p className="text-amber-700 text-sm mt-0.5">
                  ({threshold.currentUsage} / {threshold.limit}) - Upgrade to prevent service disruption.
                </p>
              </div>
            </div>
            
            <button
              onClick={() => handleUpgradeClick(threshold.featureId)}
              className="shrink-0 bg-[#198fd9] hover:bg-[#157ab9] text-white text-xs font-bold py-2 px-4 rounded-[4px] shadow-sm transition-colors w-full sm:w-auto"
            >
              Upgrade Now
            </button>
          </div>
        ))}
      </div>

      <AddOnUpsellModal 
        isOpen={activeUpsellCategory !== null}
        onClose={() => setActiveUpsellCategory(null)}
        category={activeUpsellCategory || 'voice_pack'}
        tenantId={tenantId}
      />
    </>
  );
}
