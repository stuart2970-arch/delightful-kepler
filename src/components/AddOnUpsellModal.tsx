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
  max_price_pence?: number | null;
  included_voice_minutes: number;
  max_voice_minutes?: number | null;
  included_sms: number;
  max_sms?: number | null;
  included_messages: number;
  included_data_chunks: number;
  category: string;
  is_sliding?: boolean;
  price_step_pence?: number | null;
}

export default function AddOnUpsellModal({ isOpen, onClose, category, tenantId }: AddOnUpsellModalProps) {
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubscribing, setIsSubscribing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Slider States:
  // 1. Landline: 0 to 11 steps (£8.99 to £19.99 in £1 multiples, 10 to 30 mins)
  const [landlineStep, setLandlineStep] = useState<number>(0);

  // 2. Mobile: 0 to 4 steps (£10.99 to £14.99 in £1 multiples, 50 to 250 SMS)
  const [mobileStep, setMobileStep] = useState<number>(0);

  // 3. Voice Pack: 0 to 35 steps (£15.00 to £50.00 in £1 multiples, 20 to 100 mins)
  const [voiceStep, setVoiceStep] = useState<number>(0);

  // 4. SMS Pack: 0 to 9 steps (£5.99 to £14.99 in £1 multiples, 100 to 500 SMS)
  const [smsStep, setSmsStep] = useState<number>(0);

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
      } catch (err: any) {
        console.error('Error fetching add-ons:', err);
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

  const handleSubscribe = async (
    addonCatalogId: string,
    customPricePence?: number,
    customVoiceMinutes?: number,
    customSms?: number
  ) => {
    setIsSubscribing(addonCatalogId);
    setError(null);
    try {
      const isLocal = typeof window !== 'undefined' && (window.location.hostname.includes('localhost') || window.location.hostname.includes('.test'));
      const wpAppUrl = isLocal ? 'https://styleflo.test/app' : 'https://styleflo.ai/app';

      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addonCatalogId,
          tenantId,
          customPricePence,
          customVoiceMinutes,
          customSms,
          returnUrl: wpAppUrl,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to initiate checkout');
      }

      if (data.url) {
        if (typeof window !== 'undefined' && window.top && window.top !== window) {
          window.top.location.href = data.url;
        } else {
          window.location.href = data.url;
        }
      } else {
        throw new Error('No checkout URL received from payment provider');
      }
    } catch (err: any) {
      console.error('Error initiating checkout:', err);
      setError(err.message || 'Checkout failed. Please try again.');
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

  // Extract catalog items
  const landlineItem = addOns.find((a) => a.id === 'landline_addon' || a.category === 'landline');
  const mobileItem = addOns.find((a) => a.id === 'mobile_addon' || a.category === 'mobile');
  const voiceItem = addOns.find((a) => a.id === 'voice_pack_20' || a.category === 'voice_pack');
  const smsItem = addOns.find((a) => a.id === 'sms_pack_100' || a.category === 'sms_pack');

  // Dynamic Landline Computations:
  const landlineMinPrice = landlineItem?.monthly_price_pence ?? 899;
  const landlineMaxPrice = landlineItem?.max_price_pence ?? 1999;
  const landlineMinMins = landlineItem?.included_voice_minutes ?? 10;
  const landlineMaxMins = landlineItem?.max_voice_minutes ?? 30;
  const landlineStepPence = landlineItem?.price_step_pence || 100;
  const landlineMaxSteps = Math.max(1, Math.round((landlineMaxPrice - landlineMinPrice) / landlineStepPence));
  const safeLandlineStep = Math.min(landlineStep, landlineMaxSteps);
  const landlinePricePence = landlineMinPrice + safeLandlineStep * landlineStepPence;
  const landlinePriceGBP = (landlinePricePence / 100).toFixed(2);
  const landlineVoiceMinutes = Math.round(landlineMinMins + safeLandlineStep * ((landlineMaxMins - landlineMinMins) / landlineMaxSteps));

  // Dynamic Mobile Computations:
  const mobileMinPrice = mobileItem?.monthly_price_pence ?? 1099;
  const mobileMaxPrice = mobileItem?.max_price_pence ?? 1499;
  const mobileMinSms = mobileItem?.included_sms ?? 50;
  const mobileMaxSms = mobileItem?.max_sms ?? 250;
  const mobileVoiceMins = mobileItem?.included_voice_minutes ?? 10;
  const mobileStepPence = mobileItem?.price_step_pence || 100;
  const mobileMaxSteps = Math.max(1, Math.round((mobileMaxPrice - mobileMinPrice) / mobileStepPence));
  const safeMobileStep = Math.min(mobileStep, mobileMaxSteps);
  const mobilePricePence = mobileMinPrice + safeMobileStep * mobileStepPence;
  const mobilePriceGBP = (mobilePricePence / 100).toFixed(2);
  const mobileSmsCount = Math.round(mobileMinSms + safeMobileStep * ((mobileMaxSms - mobileMinSms) / mobileMaxSteps));

  // Dynamic Voice Pack Computations:
  const voiceMinPrice = voiceItem?.monthly_price_pence ?? 1500;
  const voiceMaxPrice = voiceItem?.max_price_pence ?? 5000;
  const voiceMinMins = voiceItem?.included_voice_minutes ?? 20;
  const voiceMaxMins = voiceItem?.max_voice_minutes ?? 100;
  const voiceStepPence = voiceItem?.price_step_pence || 100;
  const voiceMaxSteps = Math.max(1, Math.round((voiceMaxPrice - voiceMinPrice) / voiceStepPence));
  const safeVoiceStep = Math.min(voiceStep, voiceMaxSteps);
  const voicePricePence = voiceMinPrice + safeVoiceStep * voiceStepPence;
  const voicePriceGBP = (voicePricePence / 100).toFixed(2);
  const voiceMinutesCount = Math.round(voiceMinMins + safeVoiceStep * ((voiceMaxMins - voiceMinMins) / voiceMaxSteps));

  // Dynamic SMS Pack Computations:
  const smsMinPrice = smsItem?.monthly_price_pence ?? 599;
  const smsMaxPrice = smsItem?.max_price_pence ?? 1499;
  const smsMinSms = smsItem?.included_sms ?? 100;
  const smsMaxSms = smsItem?.max_sms ?? 500;
  const smsStepPence = smsItem?.price_step_pence || 100;
  const smsMaxSteps = Math.max(1, Math.round((smsMaxPrice - smsMinPrice) / smsStepPence));
  const safeSmsStep = Math.min(smsStep, smsMaxSteps);
  const smsPricePence = smsMinPrice + safeSmsStep * smsStepPence;
  const smsPriceGBP = (smsPricePence / 100).toFixed(2);
  const smsMessagesCount = Math.round(smsMinSms + safeSmsStep * ((smsMaxSms - smsMinSms) / smsMaxSteps));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-2xl p-6 max-w-2xl w-full shadow-2xl relative flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-5 shrink-0 border-b border-[var(--awb-color3)] pb-4">
          <div>
            <h3 className="text-xl font-extrabold text-[#260475]">{getCategoryTitle()}</h3>
            <p className="text-xs text-[#434549] mt-0.5">Customise your plan with flexible modular bolt-ons.</p>
          </div>
          <button 
            onClick={onClose} 
            className="text-[#434549] hover:text-[#212326] p-1.5 rounded-lg hover:bg-[var(--awb-color3)] transition-colors"
            disabled={isSubscribing !== null}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-[#198fd9] border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-[#434549] text-sm font-medium">Loading available options...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-8 text-center bg-rose-50 border border-rose-200 rounded-xl p-4 my-2">
              <p className="text-rose-700 text-sm font-semibold mb-1">⚠️ {error}</p>
              <p className="text-rose-600 text-xs mb-3">Please try again or contact support if the issue persists.</p>
              <button onClick={() => setError(null)} className="text-xs text-[#198fd9] hover:underline font-semibold">Dismiss</button>
            </div>
          ) : null}

          {!isLoading && (
            <div className="space-y-4">

              {/* ========================================================= */}
              {/* 1. LANDLINE SLIDING SCALE                                */}
              {/* ========================================================= */}
              {category === 'landline' && (
                <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-xl p-5 hover:border-[#198fd9] transition-all shadow-sm">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-[#260475] font-extrabold text-lg">Local Landline Number</h4>
                        <span className="bg-indigo-50 text-[#260475] border border-indigo-200 text-[11px] font-bold px-2 py-0.5 rounded-full">
                          Modular Bolt-on
                        </span>
                      </div>
                      <p className="text-[#434549] text-xs mt-1">
                        Includes dedicated local UK phone number + shared voice minute pool.
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-2xl font-black text-[#212326]">
                        £{landlinePriceGBP}
                        <span className="text-sm font-normal text-[#434549]"> /m</span>
                      </div>
                      <span className="text-[11px] text-emerald-600 font-semibold block mt-0.5">
                        £1 increments
                      </span>
                    </div>
                  </div>

                  {/* Slider Control */}
                  <div className="bg-[var(--awb-color2)]/50 border border-[var(--awb-color3)] rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-[#260475]">Choose Shared Minutes Allowance:</span>
                      <span className="font-extrabold text-[#198fd9] text-sm bg-white px-2.5 py-0.5 rounded border border-[#198fd9]/30 shadow-xs">
                        🎙️ {landlineVoiceMinutes} voice mins/mo
                      </span>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max={landlineMaxSteps}
                      step="1"
                      value={safeLandlineStep}
                      onChange={(e) => setLandlineStep(Number(e.target.value))}
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#198fd9]"
                    />

                    <div className="flex justify-between text-[11px] text-[#434549] font-medium pt-1">
                      <span>£{(landlineMinPrice / 100).toFixed(2)} ({landlineMinMins} mins)</span>
                      <span className="text-slate-400">|</span>
                      <span>£{(landlineMaxPrice / 100).toFixed(2)} ({landlineMaxMins} mins)</span>
                    </div>
                  </div>

                  {/* Feature Badges & Subscribe */}
                  <div className="mt-4 pt-3 border-t border-[var(--awb-color3)] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold px-2 py-1 rounded">
                        ✓ Dedicated UK Area Code
                      </span>
                      <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-semibold px-2 py-1 rounded">
                        🎙️ {landlineVoiceMinutes} shared mins
                      </span>
                    </div>

                    <button
                      onClick={() => handleSubscribe(landlineItem?.id || 'landline_addon', landlinePricePence, landlineVoiceMinutes)}
                      disabled={isSubscribing !== null}
                      className="w-full sm:w-auto bg-[#198fd9] hover:bg-[#157ab9] disabled:bg-gray-400 text-white text-xs font-bold py-2.5 px-6 rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isSubscribing === (landlineItem?.id || 'landline_addon') ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Connecting to Stripe...
                        </>
                      ) : (
                        `Subscribe at £${landlinePriceGBP}/mo`
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* ========================================================= */}
              {/* 2. MOBILE SLIDING SCALE                                  */}
              {/* ========================================================= */}
              {category === 'mobile' && (
                <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-xl p-5 hover:border-[#198fd9] transition-all shadow-sm">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-[#260475] font-extrabold text-lg">Mobile Phone Number</h4>
                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold px-2 py-0.5 rounded-full">
                          SMS + Voice
                        </span>
                      </div>
                      <p className="text-[#434549] text-xs mt-1">
                        Includes dedicated UK mobile number (07) + SMS messages + shared voice minutes.
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-2xl font-black text-[#212326]">
                        £{mobilePriceGBP}
                        <span className="text-sm font-normal text-[#434549]"> /m</span>
                      </div>
                      <span className="text-[11px] text-emerald-600 font-semibold block mt-0.5">
                        £1 increments
                      </span>
                    </div>
                  </div>

                  {/* Slider Control */}
                  <div className="bg-[var(--awb-color2)]/50 border border-[var(--awb-color3)] rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-[#260475]">Choose Monthly SMS Allowance:</span>
                      <span className="font-extrabold text-[#198fd9] text-sm bg-white px-2.5 py-0.5 rounded border border-[#198fd9]/30 shadow-xs">
                        ✉️ {mobileSmsCount} SMS /mo
                      </span>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max={mobileMaxSteps}
                      step="1"
                      value={safeMobileStep}
                      onChange={(e) => setMobileStep(Number(e.target.value))}
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#198fd9]"
                    />

                    <div className="flex justify-between text-[11px] text-[#434549] font-medium pt-1">
                      <span>£{(mobileMinPrice / 100).toFixed(2)} ({mobileMinSms} SMS)</span>
                      <span className="text-slate-400">|</span>
                      <span>£{(mobileMaxPrice / 100).toFixed(2)} ({mobileMaxSms} SMS)</span>
                    </div>
                  </div>

                  {/* Feature Badges & Subscribe */}
                  <div className="mt-4 pt-3 border-t border-[var(--awb-color3)] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold px-2 py-1 rounded">
                        📱 Dedicated 07 Mobile Number
                      </span>
                      <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-semibold px-2 py-1 rounded">
                        ✉️ {mobileSmsCount} SMS
                      </span>
                      <span className="bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold px-2 py-1 rounded">
                        🎙️ {mobileVoiceMins} voice mins
                      </span>
                    </div>

                    <button
                      onClick={() => handleSubscribe(mobileItem?.id || 'mobile_addon', mobilePricePence, mobileVoiceMins, mobileSmsCount)}
                      disabled={isSubscribing !== null}
                      className="w-full sm:w-auto bg-[#198fd9] hover:bg-[#157ab9] disabled:bg-gray-400 text-white text-xs font-bold py-2.5 px-6 rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isSubscribing === (mobileItem?.id || 'mobile_addon') ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Connecting to Stripe...
                        </>
                      ) : (
                        `Subscribe at £${mobilePriceGBP}/mo`
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* ========================================================= */}
              {/* 3. VOICE PACKS SLIDING SCALE                             */}
              {/* ========================================================= */}
              {category === 'voice_pack' && (
                <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-xl p-5 hover:border-[#198fd9] transition-all shadow-sm">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-[#260475] font-extrabold text-lg">Sliding Voice Minutes Pack</h4>
                        <span className="bg-purple-50 text-purple-700 border border-purple-200 text-[11px] font-bold px-2 py-0.5 rounded-full">
                          🔄 3-Month Roll-over
                        </span>
                      </div>
                      <p className="text-[#434549] text-xs mt-1">
                        Unused voice minutes roll over for up to 3 months as long as subscription remains active.
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-2xl font-black text-[#212326]">
                        £{voicePriceGBP}
                        <span className="text-sm font-normal text-[#434549]"> /m</span>
                      </div>
                      <span className="text-[11px] text-emerald-600 font-semibold block mt-0.5">
                        Sliding Scale (£1 steps)
                      </span>
                    </div>
                  </div>

                  {/* Slider Control */}
                  <div className="bg-[var(--awb-color2)]/50 border border-[var(--awb-color3)] rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-[#260475]">Select Voice Minutes Pool:</span>
                      <span className="font-extrabold text-[#198fd9] text-sm bg-white px-2.5 py-0.5 rounded border border-[#198fd9]/30 shadow-xs">
                        🎙️ {voiceMinutesCount} voice mins/mo
                      </span>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max={voiceMaxSteps}
                      step="1"
                      value={safeVoiceStep}
                      onChange={(e) => setVoiceStep(Number(e.target.value))}
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#198fd9]"
                    />

                    {/* Quick Preset Buttons */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setVoiceStep(0)}
                        className={`text-[11px] font-semibold px-2 py-1 rounded transition-colors cursor-pointer ${safeVoiceStep === 0 ? 'bg-[#198fd9] text-white' : 'bg-slate-100 hover:bg-slate-200 text-[#434549]'}`}
                      >
                        {voiceMinMins} mins (£{(voiceMinPrice / 100).toFixed(2)})
                      </button>
                      <button
                        type="button"
                        onClick={() => setVoiceStep(Math.round(voiceMaxSteps / 2))}
                        className={`text-[11px] font-semibold px-2 py-1 rounded transition-colors cursor-pointer ${safeVoiceStep === Math.round(voiceMaxSteps / 2) ? 'bg-[#198fd9] text-white' : 'bg-slate-100 hover:bg-slate-200 text-[#434549]'}`}
                      >
                        {Math.round(voiceMinMins + Math.round(voiceMaxSteps / 2) * ((voiceMaxMins - voiceMinMins) / voiceMaxSteps))} mins (£{((voiceMinPrice + Math.round(voiceMaxSteps / 2) * voiceStepPence) / 100).toFixed(2)})
                      </button>
                      <button
                        type="button"
                        onClick={() => setVoiceStep(voiceMaxSteps)}
                        className={`text-[11px] font-semibold px-2 py-1 rounded transition-colors cursor-pointer ${safeVoiceStep === voiceMaxSteps ? 'bg-[#198fd9] text-white' : 'bg-slate-100 hover:bg-slate-200 text-[#434549]'}`}
                      >
                        {voiceMaxMins} mins (£{(voiceMaxPrice / 100).toFixed(2)})
                      </button>
                    </div>
                  </div>

                  {/* Feature Badges & Subscribe */}
                  <div className="mt-4 pt-3 border-t border-[var(--awb-color3)] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-semibold px-2 py-1 rounded">
                        🎙️ {voiceMinutesCount} voice mins
                      </span>
                      <span className="bg-purple-50 text-purple-700 border border-purple-200 text-xs font-semibold px-2 py-1 rounded">
                        🔄 3-Month Rollover Protection
                      </span>
                    </div>

                    <button
                      onClick={() => handleSubscribe(voiceItem?.id || 'voice_pack_20', voicePricePence, voiceMinutesCount)}
                      disabled={isSubscribing !== null}
                      className="w-full sm:w-auto bg-[#198fd9] hover:bg-[#157ab9] disabled:bg-gray-400 text-white text-xs font-bold py-2.5 px-6 rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isSubscribing === (voiceItem?.id || 'voice_pack_20') ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Connecting to Stripe...
                        </>
                      ) : (
                        `Subscribe at £${voicePriceGBP}/mo`
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* ========================================================= */}
              {/* 4. SMS PACKS SLIDING SCALE                               */}
              {/* ========================================================= */}
              {category === 'sms_pack' && (
                <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-xl p-5 hover:border-[#198fd9] transition-all shadow-sm">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-[#260475] font-extrabold text-lg">Sliding SMS Pack</h4>
                        <span className="bg-purple-50 text-purple-700 border border-purple-200 text-[11px] font-bold px-2 py-0.5 rounded-full">
                          🔄 3-Month Roll-over
                        </span>
                      </div>
                      <p className="text-[#434549] text-xs mt-1">
                        Unused SMS credits roll over for up to 3 months as long as subscription remains active.
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-2xl font-black text-[#212326]">
                        £{smsPriceGBP}
                        <span className="text-sm font-normal text-[#434549]"> /m</span>
                      </div>
                      <span className="text-[11px] text-emerald-600 font-semibold block mt-0.5">
                        Sliding Scale (£1 steps)
                      </span>
                    </div>
                  </div>

                  {/* Slider Control */}
                  <div className="bg-[var(--awb-color2)]/50 border border-[var(--awb-color3)] rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-[#260475]">Select Monthly SMS Capacity:</span>
                      <span className="font-extrabold text-[#198fd9] text-sm bg-white px-2.5 py-0.5 rounded border border-[#198fd9]/30 shadow-xs">
                        ✉️ {smsMessagesCount} SMS /mo
                      </span>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max={smsMaxSteps}
                      step="1"
                      value={safeSmsStep}
                      onChange={(e) => setSmsStep(Number(e.target.value))}
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#198fd9]"
                    />

                    {/* Quick Preset Buttons */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setSmsStep(0)}
                        className={`text-[11px] font-semibold px-2 py-1 rounded transition-colors cursor-pointer ${safeSmsStep === 0 ? 'bg-[#198fd9] text-white' : 'bg-slate-100 hover:bg-slate-200 text-[#434549]'}`}
                      >
                        {smsMinSms} SMS (£{(smsMinPrice / 100).toFixed(2)})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSmsStep(Math.round(smsMaxSteps / 2))}
                        className={`text-[11px] font-semibold px-2 py-1 rounded transition-colors cursor-pointer ${safeSmsStep === Math.round(smsMaxSteps / 2) ? 'bg-[#198fd9] text-white' : 'bg-slate-100 hover:bg-slate-200 text-[#434549]'}`}
                      >
                        {Math.round(smsMinSms + Math.round(smsMaxSteps / 2) * ((smsMaxSms - smsMinSms) / smsMaxSteps))} SMS (£{((smsMinPrice + Math.round(smsMaxSteps / 2) * smsStepPence) / 100).toFixed(2)})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSmsStep(smsMaxSteps)}
                        className={`text-[11px] font-semibold px-2 py-1 rounded transition-colors cursor-pointer ${safeSmsStep === smsMaxSteps ? 'bg-[#198fd9] text-white' : 'bg-slate-100 hover:bg-slate-200 text-[#434549]'}`}
                      >
                        {smsMaxSms} SMS (£{(smsMaxPrice / 100).toFixed(2)})
                      </button>
                    </div>
                  </div>

                  {/* Feature Badges & Subscribe */}
                  <div className="mt-4 pt-3 border-t border-[var(--awb-color3)] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-semibold px-2 py-1 rounded">
                        ✉️ {smsMessagesCount} SMS
                      </span>
                      <span className="bg-purple-50 text-purple-700 border border-purple-200 text-xs font-semibold px-2 py-1 rounded">
                        🔄 3-Month Rollover Protection
                      </span>
                    </div>

                    <button
                      onClick={() => handleSubscribe(smsItem?.id || 'sms_pack_100', smsPricePence, 0, smsMessagesCount)}
                      disabled={isSubscribing !== null}
                      className="w-full sm:w-auto bg-[#198fd9] hover:bg-[#157ab9] disabled:bg-gray-400 text-white text-xs font-bold py-2.5 px-6 rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isSubscribing === (smsItem?.id || 'sms_pack_100') ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Connecting to Stripe...
                        </>
                      ) : (
                        `Subscribe at £${smsPriceGBP}/mo`
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* ========================================================= */}
              {/* 5. OTHER CATEGORIES (WHATSAPP, DATA PACK, ETC.)           */}
              {/* ========================================================= */}
              {category !== 'landline' && category !== 'mobile' && category !== 'voice_pack' && category !== 'sms_pack' && (
                <div className="grid grid-cols-1 gap-4">
                  {addOns.map((addon) => (
                    <div key={addon.id} className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] rounded-xl p-5 hover:border-[#198fd9] transition-colors flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-sm">
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
                          onClick={() => handleSubscribe(addon.id, addon.monthly_price_pence, addon.included_voice_minutes, addon.included_sms)}
                          disabled={isSubscribing !== null}
                          className="w-full sm:w-auto bg-[#198fd9] hover:bg-[#157ab9] disabled:bg-gray-400 text-white text-xs font-bold py-2.5 px-6 rounded-[4px] shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
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
          )}
        </div>
      </div>
    </div>
  );
}
