import React, { useState } from 'react';
import AddOnUpsellModal, { AddOnCategory } from './AddOnUpsellModal';
import { usageAlertLevel, type UsageAlertLevel } from '@/lib/usage-alerts';
import { useDashboardStore } from '@/lib/store';

export interface ThresholdAlert {
  featureId: string;
  featureName: string;
  percentUsed: number;
  currentUsage: number;
  limit: number;
  alertLevel?: UsageAlertLevel;
  upgradeAction?: 'addon' | 'plan';
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

  // Warning from 80%. A separate limit alert from 100%. Nothing below 80%.
  const activeThresholds = thresholds
    .map((threshold) => ({
      ...threshold,
      alertLevel: threshold.alertLevel && threshold.alertLevel !== 'none'
        ? threshold.alertLevel
        : usageAlertLevel(threshold.percentUsed),
    }))
    .filter((threshold) => threshold.alertLevel === 'warning' || threshold.alertLevel === 'limit');

  if (activeThresholds.length === 0) {
    return null;
  }

  const openPlanAndUsage = () => {
    useDashboardStore.getState().setActiveTab('billing');
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'billing');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  };

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
        {activeThresholds.map((threshold) => {
          const atLimit = threshold.alertLevel === 'limit';
          const reviewsPlan = threshold.upgradeAction === 'plan' || threshold.featureId === 'message_allowance';
          return (
          <div 
            key={threshold.featureId} 
            className={`${atLimit ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'} border rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm`}
          >
            <div className="flex items-center gap-3">
              <div className={`${atLimit ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'} p-2 rounded-full shrink-0`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className={`${atLimit ? 'text-red-800' : 'text-amber-800'} font-semibold`}>
                  {atLimit
                    ? `You have used all of your allocated ${threshold.featureName}.`
                    : `You have now used ${threshold.percentUsed}% of your allocated ${threshold.featureName}.`}
                </p>
                <p className={`${atLimit ? 'text-red-700' : 'text-amber-700'} text-sm mt-0.5`}>
                  ({threshold.currentUsage} / {threshold.limit}) — {reviewsPlan
                    ? (atLimit ? 'This allowance is used up. Review your plan to add more.' : 'Review your plan before this allowance runs out.')
                    : (atLimit ? 'This allowance is used up. Upgrade to add more.' : 'Upgrade before this allowance runs out.')}
                </p>
              </div>
            </div>
            
            <button
              onClick={() => (reviewsPlan ? openPlanAndUsage() : handleUpgradeClick(threshold.featureId))}
              className="shrink-0 bg-[#198fd9] hover:bg-[#157ab9] text-white text-xs font-bold py-2 px-4 rounded-[4px] shadow-sm transition-colors w-full sm:w-auto"
            >
              {reviewsPlan ? 'View plan' : 'Upgrade Now'}
            </button>
          </div>
          );
        })}
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
