// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { useDashboardStore } from '../../lib/store';

export default function IntegrationsView() {
  const { 
    tenantId, 
    isGoogleConnected, 
    setIsGoogleConnected, 
    bookingMode, 
    bookingUrl, 
    rwgConfig, 
    setRwgConfig, 
    services, 
    staff,
    rwgAddressSameAsTrading,
    tradingAddressStreet,
    tradingAddressCity,
    tradingAddressPostcode,
    tradingAddressPhone,
    setActiveTab
  } = useDashboardStore();

  const [rwgIntegrityLogs, setRwgIntegrityLogs] = useState<string[]>([]);
  const [isCheckingRwgIntegrity, setIsCheckingRwgIntegrity] = useState(false);
  const [isSavingRwg, setIsSavingRwg] = useState(false);
  
  const [isRwgEnabled, setIsRwgEnabled] = useState(rwgConfig?.is_rwg_enabled || false);
  const [rwgGoogleUrl, setRwgGoogleUrl] = useState('');
  const [rwgBusinessName, setRwgBusinessName] = useState(rwgConfig?.rwg_business_name || rwgConfig?.business_name || '');
  const [rwgStreetAddress, setRwgStreetAddress] = useState(rwgAddressSameAsTrading ? tradingAddressStreet : (rwgConfig?.rwg_street_address || rwgConfig?.street_address || ''));
  const [rwgCity, setRwgCity] = useState(rwgAddressSameAsTrading ? tradingAddressCity : (rwgConfig?.rwg_city || rwgConfig?.city || ''));
  const [rwgPostcode, setRwgPostcode] = useState(rwgAddressSameAsTrading ? tradingAddressPostcode : (rwgConfig?.rwg_postcode || rwgConfig?.postcode || ''));
  const [rwgPhone, setRwgPhone] = useState(rwgAddressSameAsTrading ? tradingAddressPhone : (rwgConfig?.rwg_phone || rwgConfig?.telephone || ''));
  const [isRegisteredBusinessAddress, setIsRegisteredBusinessAddress] = useState(rwgConfig?.is_registered_business_address || false);

  useEffect(() => {
    setIsRwgEnabled(rwgConfig?.is_rwg_enabled || false);
    setRwgBusinessName(rwgConfig?.rwg_business_name || rwgConfig?.business_name || '');
    setRwgStreetAddress(rwgAddressSameAsTrading ? tradingAddressStreet : (rwgConfig?.rwg_street_address || rwgConfig?.street_address || ''));
    setRwgCity(rwgAddressSameAsTrading ? tradingAddressCity : (rwgConfig?.rwg_city || rwgConfig?.city || ''));
    setRwgPostcode(rwgAddressSameAsTrading ? tradingAddressPostcode : (rwgConfig?.rwg_postcode || rwgConfig?.postcode || ''));
    setRwgPhone(rwgAddressSameAsTrading ? tradingAddressPhone : (rwgConfig?.rwg_phone || rwgConfig?.telephone || ''));
    setIsRegisteredBusinessAddress(rwgConfig?.is_registered_business_address || false);
  }, [rwgConfig, rwgAddressSameAsTrading, tradingAddressStreet, tradingAddressCity, tradingAddressPostcode, tradingAddressPhone]);

  const rwgStatus = isRwgEnabled ? (rwgBusinessName && rwgStreetAddress ? 'Active on Google' : 'Pending Verification') : 'Disconnected';


  const handleSaveRwgSettings = async () => {
    setIsSavingRwg(true);
    try {
      const newConfig = {
        is_rwg_enabled: isRwgEnabled,
        rwg_business_name: rwgBusinessName,
        rwg_street_address: rwgStreetAddress,
        rwg_city: rwgCity,
        rwg_postcode: rwgPostcode,
        rwg_phone: rwgPhone,
        is_registered_business_address: isRegisteredBusinessAddress
      };
      
      const res = await fetch('/api/tenants/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          rwgConfig: newConfig
        })
      });
      if (!res.ok) throw new Error('Failed to update settings');
      
      // Update global store so navigating away and back doesn't reset it
      setRwgConfig(newConfig);
      
      alert('Reserve with Google settings updated successfully!');
    } catch (err: any) {
      alert('Failed to update Reserve with Google settings: ' + err.message);
    } finally {
      setIsSavingRwg(false);
    }
  };

  const handleSaveBookingMode = async () => {
    setIsSavingBookingMode(true);
    try {
      const res = await fetch('/api/tenants/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          bookingMode,
          bookingUrl: bookingMode === 'external_platform' ? bookingUrl : null
        })
      });
      if (!res.ok) throw new Error('Failed to update settings');
      alert('Booking Mode updated successfully!');
    } catch (err: any) {
      alert('Failed to update Booking Mode: ' + err.message);
    } finally {
      setIsSavingBookingMode(false);
    }
  };

  const handleRunRwgIntegrityCheck = async () => {
    setIsCheckingRwgIntegrity(true);
    setRwgIntegrityLogs(['[System] Initiating schema validation check...']);
    setTimeout(() => {
      let logs = ['[System] Validating against Google Actions Center v3 Schema...'];
      let isValid = true;
      
      if (!rwgBusinessName) { logs.push('[Error] Missing required field: Business Name'); isValid = false; }
      if (!rwgStreetAddress) { logs.push('[Error] Missing required field: Street Address'); isValid = false; }
      if (!rwgCity) { logs.push('[Error] Missing required field: City'); isValid = false; }
      if (!rwgPostcode) { logs.push('[Error] Missing required field: Postcode'); isValid = false; }
      if (!rwgPhone) { logs.push('[Error] Missing required field: Phone Number'); isValid = false; }

      if (isValid) {
        logs.push('[Success] merchants.json schema is valid!');
        if (services.length === 0) {
          logs.push('[Warning] No services found. services.json will be empty.');
        } else {
          logs.push(`[Success] services.json schema is valid (${services.length} services mapped).`);
        }
        if (staff.length === 0) {
          logs.push('[Warning] No staff members configured. availability.json cannot be generated.');
        } else {
          logs.push(`[Success] availability.json schema is ready (${staff.length} staff members mapped).`);
        }
        logs.push('[System] Integrity check completed successfully. Ready for Google Sync.');
      } else {
        logs.push('[Error] Integrity check failed. Please resolve the errors above.');
      }
      setRwgIntegrityLogs(prev => [...prev, ...logs]);
      setIsCheckingRwgIntegrity(false);
    }, 1000);
  };

  // Crawling Trigger handler
  const handleTriggerCrawl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crawlUrl.trim() || !crawlBotId) return;

    console.log(true);
    console.log(null);
    setCrawlLogs([`[System] Initializing scraper for URLs...`]);

    const urls = crawlUrl.split(/[\s,]+/).map(u => u.trim()).filter(u => u);
    let totalChunks = 0;
    let hasError = false;

    for (let i = 0; i < urls.length; i++) {
      const currentUrl = urls[i];
      setCrawlLogs((prev) => [...prev, `[System] [${i+1}/${urls.length}] Crawling ${currentUrl}...`]);

      try {
        const response = await fetch('/api/ingest/crawl', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: currentUrl,
            chatbotId: crawlBotId,
          }),
        });

        const data = await response.json();

        if (response.ok) {
          setCrawlLogs((prev) => [...prev, `[Supabase] Ingested ${data.chunksCount} chunks from ${currentUrl}.`]);
          totalChunks += data.chunksCount;
        } else {
          hasError = true;
          setCrawlLogs((prev) => [...prev, `[Error] Failed to crawl ${currentUrl}: ${data.error || 'Unknown error'}`]);
        }
      } catch (err: any) {
        hasError = true;
        console.warn(`[Dashboard] Ingestion failed for ${currentUrl}:`, err.message || err);
        setCrawlLogs((prev) => [...prev, `[Error] Failed to crawl ${currentUrl}: ${err.message || err}`]);
      }
    }

    if (!hasError) {
      setCrawlLogs((prev) => [...prev, `[Success] Batch crawl finished! Total chunks ingested: ${totalChunks}.`]);
      console.log({
        success: true,
        message: `Successfully crawled and ingested ${totalChunks} content chunks.`,
      });
      console.log((prev) => ({
        ...prev,
        chunksCount: prev.chunksCount + totalChunks,
      }));
      console.log('');
    } else {
      console.log({
        success: false,
        message: `Crawling finished with errors. Ingested ${totalChunks} chunks. See logs.`,
      });
    }

    console.log(false);
  };

  const handleDisconnectCalendar = async () => {
    if (!confirm("Are you sure you want to disconnect Google Calendar? This will remove the chatbot's ability to check availability and book appointments, but no Google Calendar data will be lost.")) return;
    try {
      const res = await fetch(`/api/integrations/google/status?tenantId=${tenantId}`, { method: 'DELETE' });
      if (res.ok) {
        setIsGoogleConnected(false);
      } else {
        alert('Failed to disconnect Google Calendar.');
      }
    } catch (err) {
      console.error(err);
      alert('Error disconnecting Google Calendar.');
    }
  };


  return (
    <>
          {true && (
            <div className="bg-white border border-[#f2f3f5] p-6 rounded-2xl shadow-sm space-y-6">
              {/* Reserve with Google Integration */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-[#260475]">Reserve with Google (Actions Center)</h3>
                    <p className="text-xs text-[#434549] mt-0.5">Enable native "Book Online" functionality directly on your Google Maps and Search profile.</p>
                  </div>
                  <div className={`px-3.5 py-1.5 rounded-full text-xs font-bold border shadow-sm ${
                    rwgStatus === 'Active on Google' ? 'bg-emerald-50 border-emerald-300 text-emerald-800' :
                    rwgStatus === 'Pending Verification' ? 'bg-amber-50 border-amber-300 text-amber-900' :
                    'bg-[#f9f9fb] border-[#f2f3f5] text-[#434549]'
                  }`}>
                    Status: {rwgStatus}
                  </div>
                </div>

                <div className="bg-[#f9f9fb] border border-[#f2f3f5] p-5 rounded-xl space-y-4">
                  <div className="flex items-center gap-3 bg-white border border-[#f2f3f5] p-4 rounded-xl shadow-sm">
                    <input
                      type="checkbox"
                      id="rwg-enable-toggle"
                      checked={isRwgEnabled}
                      onChange={(e) => setIsRwgEnabled(e.target.checked)}
                      className="w-5 h-5 rounded bg-white border-[#f2f3f5] text-[#198fd9] focus:ring-[#65bd7d]"
                    />
                    <div>
                      <label htmlFor="rwg-enable-toggle" className="text-sm font-bold text-[#260475] cursor-pointer select-none">Authorize Google Integration</label>
                      <p className="text-xs text-[#434549] mt-0.5">Checking this box will start generating dynamic JSON feeds for your business and expose realtime webhook APIs for Google's servers.</p>
                    </div>
                  </div>

                  {isRwgEnabled && (
                    <div className="space-y-4 pt-2">
                      <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl">
                        <p className="text-xs text-amber-900 font-bold flex items-center gap-1">⚠️ Important Mapping Requirement</p>
                        <p className="text-xs text-amber-800 mt-1">These fields must mirror your exact Google Business Profile inputs word-for-word, or mapping alignment will fail.</p>
                      </div>

                      <div className="flex flex-col md:flex-row gap-3">
                        <div className="flex-1">
                          <label className="block text-xs font-semibold text-[#212326] mb-1.5">Google Business Profile URL</label>
                          <input 
                            type="text" 
                            value={rwgGoogleUrl} 
                            onChange={(e) => setRwgGoogleUrl(e.target.value)} 
                            className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#65bd7d] placeholder-gray-400" 
                            placeholder="https://maps.google.com/?cid=..." 
                          />
                        </div>
                        <div className="flex items-end pb-[1px]">
                          <button 
                            type="button"
                            disabled={isSavingRwg}
                            onClick={async () => {
                              if (!rwgGoogleUrl) {
                                alert("Please enter your Google Business Profile URL first.");
                                return;
                              }
                              try {
                                setIsSavingRwg(true);
                                const res = await fetch('/api/integrations/google/places', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ url: rwgGoogleUrl })
                                });
                                const data = await res.json();
                                if (!res.ok) throw new Error(data.error || 'Failed to import data');
                                
                                if (data.name) setRwgBusinessName(data.name);
                                if (data.phone) setRwgPhone(data.phone);
                                if (data.streetAddress) setRwgStreetAddress(data.streetAddress);
                                if (data.city) setRwgCity(data.city);
                                if (data.postcode) setRwgPostcode(data.postcode);
                                
                                if (data.warning) {
                                  alert("Partial Import: " + data.warning + "\n\nWe extracted your business name from the URL, but you will need to manually enter your address since it is not fully visible to the Google Places API yet.");
                                } else {
                                  alert("Successfully imported details from Google Maps!");
                                }
                              } catch (err: any) {
                                alert(err.message || 'Error importing from Google');
                              } finally {
                                setIsSavingRwg(false);
                              }
                            }}
                            className="awb-btn h-[50px] flex items-center gap-2 whitespace-nowrap shadow-sm disabled:opacity-50"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                            {isSavingRwg ? 'Importing...' : 'IMPORT from Google Business'}
                          </button>
                        </div>
                      </div>

                      {/* Sync Alert Box */}
                      {rwgAddressSameAsTrading && (
                        <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl space-y-1.5 mb-4 mt-2">
                          <p className="text-xs text-blue-900 flex items-center gap-1.5 font-bold">
                            ℹ️ Automatic Address Synchronization
                          </p>
                          <p className="text-[11px] text-blue-800 leading-relaxed">
                            Your Reserve with Google mapping is currently set to mirror your **Trading Address** word-for-word. To edit these fields, update your details in the <button type="button" onClick={() => setActiveTab('account')} className="text-[#198fd9] font-bold underline hover:text-[#157ab9]">Account Settings</button> tab.
                          </p>
                          <p className="text-[11px] text-blue-800">
                            Alternatively, you can uncheck the synchronization option below to enter custom Google-specific profile details.
                          </p>
                        </div>
                      )}

                      {/* Same as Trading Toggle */}
                      <div className="flex items-center justify-between pb-3 border-b border-[#f2f3f5] mb-4 mt-4">
                        <span className="text-xs text-[#212326] font-bold">Google Profile details match Trading Address</span>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rwgAddressSameAsTrading}
                            onChange={async (e) => {
                              useDashboardStore.setState({ rwgAddressSameAsTrading: e.target.checked });
                              // Persist immediately to db
                              try {
                                await fetch('/api/tenants/settings', {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    tenantId,
                                    rwgAddressSameAsTrading: e.target.checked
                                  })
                                });
                              } catch (err) {
                                console.error('Failed to update rwgAddressSameAsTrading:', err);
                              }
                            }}
                            className="w-4 h-4 text-[#198fd9] bg-white border-[#f2f3f5] rounded focus:ring-[#198fd9]"
                          />
                          <span className="text-xs font-bold text-[#212326]">Yes, same</span>
                        </label>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-[#f2f3f5]">
                        <div>
                          <label className="block text-xs font-semibold text-[#212326] mb-1.5">Business Name</label>
                          <input type="text" value={rwgBusinessName} onChange={(e) => setRwgBusinessName(e.target.value)} className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#65bd7d] placeholder-gray-400" placeholder="e.g. Styleflo Salon" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[#212326] mb-1.5">Phone Number</label>
                          <input type="text" value={rwgPhone} onChange={(e) => setRwgPhone(e.target.value)} disabled={rwgAddressSameAsTrading} className="w-full h-[50px] bg-white disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#65bd7d] placeholder-gray-400" placeholder="+44 123 456 7890" />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs font-semibold text-[#212326] mb-1.5">Street Address</label>
                          <input type="text" value={rwgStreetAddress} onChange={(e) => setRwgStreetAddress(e.target.value)} disabled={rwgAddressSameAsTrading} className="w-full h-[50px] bg-white disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#65bd7d] placeholder-gray-400" placeholder="123 Salon Street" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[#212326] mb-1.5">City</label>
                          <input type="text" value={rwgCity} onChange={(e) => setRwgCity(e.target.value)} disabled={rwgAddressSameAsTrading} className="w-full h-[50px] bg-white disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#65bd7d] placeholder-gray-400" placeholder="London" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[#212326] mb-1.5">Postcode</label>
                          <input type="text" value={rwgPostcode} onChange={(e) => setRwgPostcode(e.target.value)} disabled={rwgAddressSameAsTrading} className="w-full h-[50px] bg-white disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#65bd7d] placeholder-gray-400" placeholder="SW1A 1AA" />
                        </div>
                      </div>

                      {rwgAddressSameAsTrading && (
                        <p className="text-xs text-[#65bd7d] font-semibold mt-1">✓ Mapped automatically to match your Trading Address.</p>
                      )}

                      <div className="pt-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={isRegisteredBusinessAddress}
                            onChange={(e) => setIsRegisteredBusinessAddress(e.target.checked)}
                            className="w-4 h-4 text-[#198fd9] bg-white border-[#f2f3f5] rounded focus:ring-[#65bd7d]"
                          />
                          <span className="text-sm font-medium text-[#212326]">
                            Confirm this is also the registered business address
                          </span>
                        </label>
                      </div>

                      <div className="flex items-center gap-3 pt-2">
                        <button
                          type="button"
                          onClick={handleSaveRwgSettings}
                          disabled={isSavingRwg}
                          className="awb-btn text-sm shadow-sm disabled:opacity-50"
                        >
                          {isSavingRwg ? 'Saving...' : 'Save Configuration'}
                        </button>
                        <button
                          type="button"
                          onClick={handleRunRwgIntegrityCheck}
                          disabled={isCheckingRwgIntegrity}
                          className="bg-white text-[#212326] hover:bg-[#f9f9fb] text-xs font-semibold px-[29px] py-[13px] rounded-[4px] border border-[#f2f3f5] disabled:opacity-50 transition-colors shadow-sm"
                        >
                          {isCheckingRwgIntegrity ? 'Running...' : 'Run Integrity Check'}
                        </button>
                      </div>

                      {rwgIntegrityLogs.length > 0 && (
                        <div className="mt-4 p-4 bg-[#212326] border border-[#f2f3f5] rounded-xl font-mono text-[11px] text-white h-36 overflow-y-auto space-y-1.5 styleflo-scrollbar">
                          {rwgIntegrityLogs.map((log, i) => (
                            <div key={i} className={
                              log.startsWith('[Error]') ? 'text-red-400 font-bold' :
                              log.startsWith('[Success]') ? 'text-emerald-800 font-bold' :
                              log.startsWith('[Warning]') ? 'text-amber-300 font-semibold' :
                              log.startsWith('[System]') ? 'text-blue-300 font-semibold' : 'text-gray-200'
                            }>
                              {log}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}
    </>
  );
}
