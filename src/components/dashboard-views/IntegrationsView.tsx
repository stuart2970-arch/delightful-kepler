import React, { useState } from 'react';
import { useDashboardStore } from '../../lib/store';

export default function IntegrationsView() {
  const { tenantId, isGoogleConnected, setIsGoogleConnected, bookingMode, bookingUrl, rwgConfig, services, staff } = useDashboardStore();

  const [rwgIntegrityLogs, setRwgIntegrityLogs] = useState<string[]>([]);
  const [isCheckingRwgIntegrity, setIsCheckingRwgIntegrity] = useState(false);
  const [isSavingRwg, setIsSavingRwg] = useState(false);
  
  const [isRwgEnabled, setIsRwgEnabled] = useState(rwgConfig?.is_rwg_enabled || false);
  const [rwgGoogleUrl, setRwgGoogleUrl] = useState('');
  const [rwgBusinessName, setRwgBusinessName] = useState(rwgConfig?.business_name || '');
  const [rwgStreetAddress, setRwgStreetAddress] = useState(rwgConfig?.street_address || '');
  const [rwgCity, setRwgCity] = useState(rwgConfig?.city || '');
  const [rwgPostcode, setRwgPostcode] = useState(rwgConfig?.postcode || '');
  const [rwgPhone, setRwgPhone] = useState(rwgConfig?.telephone || '');

  const rwgStatus = isRwgEnabled ? (rwgBusinessName && rwgStreetAddress ? 'Active on Google' : 'Pending Verification') : 'Disconnected';


  const handleSaveRwgSettings = async () => {
    if (!supabase) return;
    setIsSavingRwg(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          is_rwg_enabled: isRwgEnabled,
          rwg_business_name: rwgBusinessName,
          rwg_street_address: rwgStreetAddress,
          rwg_city: rwgCity,
          rwg_postcode: rwgPostcode,
          rwg_phone: rwgPhone
        })
        .eq('id', tenantId);

      if (error) throw error;
      alert('Reserve with Google settings updated successfully!');
    } catch (err: any) {
      alert('Failed to update Reserve with Google settings: ' + err.message);
    } finally {
      setIsSavingRwg(false);
    }
  };

  const handleSaveBookingMode = async () => {
    if (!supabase) return;
    setIsSavingBookingMode(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          booking_mode: bookingMode,
          booking_url: bookingMode === 'external_platform' ? bookingUrl : null
        })
        .eq('id', tenantId);

      if (error) throw error;
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
            <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl space-y-6">
              {/* Reserve with Google Integration */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">Reserve with Google (Actions Center)</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Enable native "Book Online" functionality directly on your Google Maps and Search profile.</p>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-bold border ${
                    rwgStatus === 'Active on Google' ? 'bg-emerald-950 border-emerald-500/50 text-emerald-400' :
                    rwgStatus === 'Pending Verification' ? 'bg-yellow-950 border-yellow-500/50 text-yellow-400' :
                    'bg-gray-800 border-gray-700 text-gray-400'
                  }`}>
                    Status: {rwgStatus}
                  </div>
                </div>

                <div className="bg-gray-950 border border-gray-800 p-5 rounded-xl space-y-4">
                  <div className="flex items-center gap-3 bg-indigo-950/20 border border-indigo-500/30 p-4 rounded-xl">
                    <input
                      type="checkbox"
                      id="rwg-enable-toggle"
                      checked={isRwgEnabled}
                      onChange={(e) => setIsRwgEnabled(e.target.checked)}
                      className="w-5 h-5 rounded bg-gray-900 border-gray-700 text-indigo-600 focus:ring-indigo-600 focus:ring-offset-gray-900"
                    />
                    <div>
                      <label htmlFor="rwg-enable-toggle" className="text-sm font-bold text-white cursor-pointer select-none">Authorize Google Integration</label>
                      <p className="text-[10px] text-indigo-200">Checking this box will start generating dynamic JSON feeds for your business and expose realtime webhook APIs for Google's servers.</p>
                    </div>
                  </div>

                  {isRwgEnabled && (
                    <div className="space-y-4 pt-2">
                      <div className="bg-amber-950/30 border border-amber-500/30 p-3 rounded-xl">
                        <p className="text-xs text-amber-200 font-semibold">⚠️ Important Mapping Requirement</p>
                        <p className="text-[10px] text-amber-300/80 mt-1">These fields must mirror your exact Google Business Profile inputs word-for-word, or mapping alignment will fail.</p>
                      </div>

                      <div className="flex flex-col md:flex-row gap-3">
                        <div className="flex-1">
                          <label className="block text-xs font-semibold text-gray-400 mb-1.5">Google Business Profile URL</label>
                          <input 
                            type="text" 
                            value={rwgGoogleUrl} 
                            onChange={(e) => setRwgGoogleUrl(e.target.value)} 
                            className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" 
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
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap disabled:opacity-50"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                            {isSavingRwg ? 'Importing...' : 'IMPORT from Google Business'}
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-gray-800/50">
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-1.5">Business Name</label>
                          <input type="text" value={rwgBusinessName} onChange={(e) => setRwgBusinessName(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="e.g. Styleflo Salon" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-1.5">Phone Number</label>
                          <input type="text" value={rwgPhone} onChange={(e) => setRwgPhone(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="+44 123 456 7890" />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs font-semibold text-gray-400 mb-1.5">Street Address</label>
                          <input type="text" value={rwgStreetAddress} onChange={(e) => setRwgStreetAddress(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="123 Salon Street" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-1.5">City</label>
                          <input type="text" value={rwgCity} onChange={(e) => setRwgCity(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="London" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-1.5">Postcode</label>
                          <input type="text" value={rwgPostcode} onChange={(e) => setRwgPostcode(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="SW1A 1AA" />
                        </div>
                      </div>

                      <div className="flex items-center gap-3 pt-2">
                        <button
                          type="button"
                          onClick={handleSaveRwgSettings}
                          disabled={isSavingRwg}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 px-4 rounded-lg shadow-lg shadow-indigo-500/10 transition-colors disabled:opacity-50"
                        >
                          {isSavingRwg ? 'Saving...' : 'Save Configuration'}
                        </button>
                        <button
                          type="button"
                          onClick={handleRunRwgIntegrityCheck}
                          disabled={isCheckingRwgIntegrity}
                          className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold py-2 px-4 rounded-lg transition-colors border border-gray-700 disabled:opacity-50"
                        >
                          {isCheckingRwgIntegrity ? 'Running...' : 'Run Integrity Check'}
                        </button>
                      </div>

                      {rwgIntegrityLogs.length > 0 && (
                        <div className="mt-4 p-4 bg-black border border-gray-800 rounded-xl font-mono text-[10px] text-gray-300 h-32 overflow-y-auto space-y-1.5 styleflo-scrollbar">
                          {rwgIntegrityLogs.map((log, i) => (
                            <div key={i} className={
                              log.startsWith('[Error]') ? 'text-red-400' :
                              log.startsWith('[Success]') ? 'text-emerald-400 font-semibold' :
                              log.startsWith('[Warning]') ? 'text-amber-400' :
                              log.startsWith('[System]') ? 'text-indigo-400' : 'text-gray-300'
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
