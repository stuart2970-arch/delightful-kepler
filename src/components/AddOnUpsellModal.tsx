import React, { useState, useEffect } from 'react';

export type AddOnCategory = 'landline' | 'mobile' | 'whatsapp' | 'voice_pack' | 'sms_pack' | 'data_pack';

interface AddOnUpsellModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: AddOnCategory;
  tenantId: string;
}

interface AddOn {
  id: string;
  name: string;
  description: string;
  monthly_price_pence: number;
  included_voice_minutes: number;
  included_sms: number;
  included_messages: number;
  included_data_chunks: number;
  category: string;
}

export default function AddOnUpsellModal({ isOpen, onClose, category, tenantId }: AddOnUpsellModalProps) {
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubscribing, setIsSubscribing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const fetchAddOns = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/billing/addons?category=${category}`);
        if (!response.ok) throw new Error('Failed to fetch add-ons');
        const data = await response.json();
        if (isMounted) {
          setAddOns(Array.isArray(data) ? data : data.addons || []);
        }
      } catch (error) {
        console.error('Error fetching add-ons:', error);
        if (isMounted) setError('Unable to load add-ons. Please try again later.');
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchAddOns();

    return () => {
      isMounted = false;
    };
  }, [isOpen, category]);

  if (!isOpen) return null;

  const handleSubscribe = async (addonCatalogId: string) => {
    setIsSubscribing(addonCatalogId);
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addonCatalogId, tenantId }),
      });
      
      if (!response.ok) throw new Error('Checkout failed');
      const data = await response.json();
      
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Error initiating checkout:', error);
      setIsSubscribing(null);
    }
  };

  const getCategoryTitle = () => {
    switch (category) {
      case 'landline': return 'Add a Landline Number';
      case 'mobile': return 'Add a Mobile Number';
      case 'whatsapp': return 'Enable WhatsApp Business';
      case 'voice_pack': return 'Voice Minutes Bolt-on';
      case 'sms_pack': return 'SMS Messages Bolt-on';
      case 'data_pack': return 'Knowledge Base Capacity';
      default: return 'Upgrade Feature';
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-2xl p-6 max-w-2xl w-full shadow-2xl relative flex flex-col max-h-[90vh]">
        
        <div className="flex justify-between items-center mb-6 shrink-0">
          <h3 className="text-xl font-bold text-[#260475]">{getCategoryTitle()}</h3>
          <button 
            onClick={onClose} 
            className="text-[#434549] hover:text-[#212326] transition-colors"
            disabled={isSubscribing !== null}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-[#198fd9] border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-[#434549] text-sm">Loading available options...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-red-600 text-sm font-semibold mb-2">⚠️ {error}</p>
              <p className="text-[#434549] text-xs mb-4">This feature may not be available on your current plan yet.</p>
              <button onClick={onClose} className="text-xs text-[#198fd9] hover:underline font-semibold">Close</button>
            </div>
          ) : addOns.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[#434549]">No add-ons available for this category right now.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {addOns.map((addon) => (
                <div key={addon.id} className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-xl p-5 hover:border-[#198fd9] transition-colors flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="flex-1">
                    <h4 className="text-[#260475] font-bold text-lg">{addon.name}</h4>
                    <p className="text-[#434549] text-sm mt-1">{addon.description}</p>
                    {(addon.included_voice_minutes > 0 || addon.included_sms > 0 || addon.included_messages > 0 || addon.included_data_chunks > 0) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {addon.included_voice_minutes > 0 && (
                          <span className="inline-block bg-[var(--awb-color3)] text-[#212326] text-xs font-semibold px-2 py-1 rounded">🎙️ {addon.included_voice_minutes} voice mins</span>
                        )}
                        {addon.included_sms > 0 && (
                          <span className="inline-block bg-[var(--awb-color3)] text-[#212326] text-xs font-semibold px-2 py-1 rounded">✉️ {addon.included_sms} SMS</span>
                        )}
                        {addon.included_messages > 0 && (
                          <span className="inline-block bg-[var(--awb-color3)] text-[#212326] text-xs font-semibold px-2 py-1 rounded">💬 {addon.included_messages} messages</span>
                        )}
                        {addon.included_data_chunks > 0 && (
                          <span className="inline-block bg-[var(--awb-color3)] text-[#212326] text-xs font-semibold px-2 py-1 rounded">📦 {addon.included_data_chunks} data chunks</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-3 w-full sm:w-auto">
                    <div className="text-xl font-extrabold text-[#212326]">
                      £{(addon.monthly_price_pence / 100).toFixed(2)}
                      <span className="text-sm font-normal text-[#434549]"> /m</span>
                    </div>
                    <button
                      onClick={() => handleSubscribe(addon.id)}
                      disabled={isSubscribing !== null}
                      className="w-full sm:w-auto bg-[#198fd9] hover:bg-[#157ab9] disabled:bg-gray-400 text-white text-xs font-bold py-2.5 px-6 rounded-[4px] shadow-sm transition-colors flex items-center justify-center gap-2"
                    >
                      {isSubscribing === addon.id ? (
                        <>
                          <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Processing...
                        </>
                      ) : (
                        'Subscribe'
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
