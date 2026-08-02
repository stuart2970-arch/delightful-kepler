// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { useDashboardStore } from '../../lib/store';

export default function KnowledgeBaseView() {
  const { chatbots, setMetrics, billingData } = useDashboardStore();
  const planTier = billingData?.planTier || 'basic';
  const [crawlBotId, setCrawlBotId] = useState(chatbots.filter(b => b.id !== '00000000-0000-0000-0000-000000000000')[0]?.id || '');
  const [crawlUrl, setCrawlUrl] = useState('');
  const [ingestMode, setIngestMode] = useState<'url' | 'text' | 'file'>('url');
  
  // Text state
  const [rawTextSource, setRawTextSource] = useState('');
  const [rawTextContent, setRawTextContent] = useState('');
  
  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlLogs, setCrawlLogs] = useState<string[]>([]);
  const [crawlResult, setCrawlResult] = useState<{ success: boolean; message: string } | null>(null);
  
  const [ingestedUrls, setIngestedUrls] = useState<any[]>([]);
  const [isLoadingUrls, setIsLoadingUrls] = useState(false);

  // Sitemap Discovery State
  const [discoveredSitemapUrls, setDiscoveredSitemapUrls] = useState<string[]>([]);
  const [selectedSitemapUrls, setSelectedSitemapUrls] = useState<Set<string>>(new Set());
  const [isDiscoveringSitemap, setIsDiscoveringSitemap] = useState(false);
  const [sitemapMessage, setSitemapMessage] = useState<{type: 'success'|'error'|'info', text: string} | null>(null);

  // Shopify Preflight State
  const [shopifyAnalysis, setShopifyAnalysis] = useState<any>(null);
  const [isShopifyPreflight, setIsShopifyPreflight] = useState(false);
  const [isShopifyExecuting, setIsShopifyExecuting] = useState(false);

  // Scheduled Crawling State
  const [crawlSchedule, setCrawlSchedule] = useState('none');
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  const loadIngestedUrls = async (botId: string) => {
    setIsLoadingUrls(true);
    try {
      const res = await fetch(`/api/ingest/urls?chatbotId=${encodeURIComponent(botId)}`);
      if (res.ok) {
        const data = await res.json();
        setIngestedUrls(data.urls || []);
      }
    } catch (err) {
      console.error('Failed to load ingested urls:', err);
    }
    setIsLoadingUrls(false);
  };

  useEffect(() => {
    const realBots = chatbots.filter(b => b.id !== '00000000-0000-0000-0000-000000000000');
    if (!crawlBotId && realBots.length > 0) {
      setCrawlBotId(realBots[0].id);
    }
  }, [chatbots, crawlBotId]);

  useEffect(() => {
    if (crawlBotId) {
      loadIngestedUrls(crawlBotId);
      const bot = chatbots.find(b => b.id === crawlBotId);
      if (bot) {
        const config = bot.configuration_json as any || {};
        setCrawlSchedule(config.crawl_schedule || 'none');
      }
    } else {
      setIngestedUrls([]);
    }
  }, [crawlBotId, chatbots]);

  const handleSaveSchedule = async (schedule: string) => {
    setCrawlSchedule(schedule);
    
    // Limits
    const limit = planTier === 'basic' ? 5 : planTier === 'starter' ? 20 : planTier === 'pro' ? 100 : 500;
    if (schedule === 'daily' && ingestedUrls.length > limit) {
      alert(`Your active plan (${planTier}) limits daily rescanning to ${limit} URLs. Please remove some URLs, select a different frequency, or upgrade your plan.`);
      // We still update the UI, but we won't save it to the DB if it fails validation, so revert:
      const bot = chatbots.find(b => b.id === crawlBotId);
      setCrawlSchedule((bot?.configuration_json as any)?.crawl_schedule || 'none');
      return;
    }

    setIsSavingSchedule(true);
    try {
      const bot = chatbots.find(b => b.id === crawlBotId);
      const newConfig = { ...(bot?.configuration_json as any || {}), crawl_schedule: schedule };
      
      const res = await fetch(`/api/chatbots/${crawlBotId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configuration_json: newConfig })
      });
      
      if (!res.ok) {
        throw new Error('Failed to save schedule');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to save schedule settings.');
    }
    setIsSavingSchedule(false);
  };

  const handleDeleteUrl = async (url: string) => {
    if (!crawlBotId || !confirm(`Are you sure you want to delete all chunks for ${url}?`)) return;
    
    try {
      const res = await fetch(`/api/ingest/urls?chatbotId=${encodeURIComponent(crawlBotId)}&sourceUrl=${encodeURIComponent(url)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        const deletedItem = ingestedUrls.find(item => item.url === url);
        if (deletedItem) {
          setMetrics(prev => ({
            ...prev,
            chunksCount: Math.max(0, prev.chunksCount - deletedItem.chunkCount)
          }));
        }
        setIngestedUrls(prev => prev.filter(item => item.url !== url));
      } else {
        alert('Failed to delete URL from knowledge base.');
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred during deletion.');
    }
  };

  const handleDiscoverSitemap = async () => {
    if (!crawlUrl.trim()) {
      setSitemapMessage({ type: 'error', text: 'Please enter a website URL first to discover its sitemap.' });
      return;
    }

    setIsDiscoveringSitemap(true);
    setSitemapMessage({ type: 'info', text: 'Searching for sitemap...' });
    setDiscoveredSitemapUrls([]);
    setSelectedSitemapUrls(new Set());

    try {
      const response = await fetch('/api/sitemap/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl: crawlUrl.trim() }),
      });

      const data = await response.json();

      if (response.ok && data.urls && data.urls.length > 0) {
        setDiscoveredSitemapUrls(data.urls);
        setSitemapMessage({ type: 'success', text: data.message || `Found ${data.urls.length} pages in sitemap!` });
        // Auto-select up to 5 URLs to help the user get started
        setSelectedSitemapUrls(new Set(data.urls.slice(0, 5)));
      } else {
        setSitemapMessage({ type: 'error', text: data.message || data.error || 'No sitemap found or no valid URLs extracted.' });
      }
    } catch (err: any) {
      console.error(err);
      setSitemapMessage({ type: 'error', text: 'An error occurred while discovering the sitemap.' });
    } finally {
      setIsDiscoveringSitemap(false);
    }
  };

  const handleToggleSitemapUrl = (url: string) => {
    const nextSet = new Set(selectedSitemapUrls);
    if (nextSet.has(url)) {
      nextSet.delete(url);
    } else {
      nextSet.add(url);
    }
    setSelectedSitemapUrls(nextSet);
  };

  const handleSelectAllSitemap = () => {
    // Arbitrary reasonable limit (e.g., 20) to prevent abuse if they just click "select all" on a huge site
    const limit = 20;
    setSelectedSitemapUrls(new Set(discoveredSitemapUrls.slice(0, limit)));
    setSitemapMessage({ type: 'info', text: `Selected the first ${Math.min(limit, discoveredSitemapUrls.length)} pages to respect reasonable ingestion limits.` });
  };

  const handleIngestSelectedSitemap = async () => {
    if (selectedSitemapUrls.size === 0) return;
    
    // Convert Set back to string for the existing crawlUrl state, then trigger crawl
    setCrawlUrl(Array.from(selectedSitemapUrls).join(', '));
    setDiscoveredSitemapUrls([]); // Hide the UI
    setSitemapMessage(null);
    
    // We defer the actual crawling to the user clicking the main button, or we can just trigger it directly:
    // It's safer to just populate the text area and let them click the main button.
  };


  const handleTriggerCrawl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crawlUrl.trim() || !crawlBotId) return;

    setIsCrawling(true);
    setCrawlResult(null);
    setCrawlLogs([`[System] Initializing scraper for URLs...`]);

    const urls = crawlUrl.split(/[\s,]+/).map(u => u.trim()).filter(u => u);
    let totalChunks = 0;
    let hasError = false;

    // Shopify Preflight Check
    if (urls.length === 1 && !urls[0].includes('.html') && !urls[0].includes('.xml')) {
      try {
        const analyzeRes = await fetch('/api/ingest/shopify/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storeUrl: urls[0], chatbotId: crawlBotId })
        });
        
        if (analyzeRes.ok) {
          const analysis = await analyzeRes.json();
          setShopifyAnalysis({ ...analysis, storeUrl: urls[0] });
          setIsShopifyPreflight(true);
          setIsCrawling(false);
          return;
        }
      } catch (e) {
        // Not a Shopify store or failed analysis, continue to normal scraping
      }
    }

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
      setCrawlResult({
        success: true,
        message: `Successfully crawled and ingested ${totalChunks} content chunks.`,
      });
      setMetrics(prev => ({
        ...prev,
        chunksCount: prev.chunksCount + totalChunks,
      }));
      setCrawlUrl('');
      // Reload the URLs list to reflect new data
      loadIngestedUrls(crawlBotId);
    } else {
      setCrawlResult({
        success: false,
        message: `Crawling finished with errors. Ingested ${totalChunks} chunks. See logs.`,
      });
    }

    setIsCrawling(false);
  };


  const handleTriggerText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawTextContent.trim() || !rawTextSource.trim() || !crawlBotId) return;

    setIsCrawling(true);
    setCrawlResult(null);
    setCrawlLogs([`[System] Initializing text ingestion...`]);

    try {
      const response = await fetch('/api/ingest/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: rawTextContent,
          sourceName: rawTextSource,
          chatbotId: crawlBotId,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setCrawlLogs((prev) => [...prev, `[Success] Ingested ${data.chunksCount} chunks from text.`]);
        setCrawlResult({ success: true, message: data.message });
        setMetrics(prev => ({ ...prev, chunksCount: prev.chunksCount + data.chunksCount }));
        setRawTextContent('');
        setRawTextSource('');
        loadIngestedUrls(crawlBotId);
      } else {
        setCrawlLogs((prev) => [...prev, `[Error] ${data.error}`]);
        setCrawlResult({ success: false, message: data.error });
      }
    } catch (err: any) {
      setCrawlLogs((prev) => [...prev, `[Error] ${err.message}`]);
      setCrawlResult({ success: false, message: err.message });
    }
    setIsCrawling(false);
  };

  const handleTriggerFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !crawlBotId) return;

    if (selectedFile.size > 5 * 1024 * 1024) {
      alert('File exceeds the 5MB limit. Please upload a smaller file.');
      return;
    }

    setIsCrawling(true);
    setCrawlResult(null);
    setCrawlLogs([`[System] Initializing file upload for ${selectedFile.name}...`]);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('chatbotId', crawlBotId);

      const response = await fetch('/api/ingest/file', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (response.ok) {
        setCrawlLogs((prev) => [...prev, `[Success] Ingested ${data.chunksCount} chunks from file.`]);
        setCrawlResult({ success: true, message: data.message });
        setMetrics(prev => ({ ...prev, chunksCount: prev.chunksCount + data.chunksCount }));
        setSelectedFile(null);
        loadIngestedUrls(crawlBotId);
      } else {
        setCrawlLogs((prev) => [...prev, `[Error] ${data.error}`]);
        setCrawlResult({ success: false, message: data.error });
      }
    } catch (err: any) {
      setCrawlLogs((prev) => [...prev, `[Error] ${err.message}`]);
      setCrawlResult({ success: false, message: err.message });
    }
    setIsCrawling(false);
  };

  const handleExecuteShopify = () => {
    if (!shopifyAnalysis) return;
    
    setIsShopifyPreflight(false);
    setIsShopifyExecuting(true);
    setCrawlLogs([`[System] Initializing Shopify Ingestion Engine for ${shopifyAnalysis.storeUrl}...`]);
    setCrawlResult(null);

    const sseUrl = `/api/ingest/shopify/execute?storeUrl=${encodeURIComponent(shopifyAnalysis.storeUrl)}&chatbotId=${encodeURIComponent(crawlBotId)}`;
    const eventSource = new EventSource(sseUrl);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'status') {
          setCrawlLogs(prev => [...prev, `[Status] ${data.message}`]);
        } else if (data.type === 'progress') {
          setCrawlLogs(prev => [...prev, `[Progress] ${data.message} (${data.current}/${data.total})`]);
        } else if (data.type === 'warning') {
          setCrawlLogs(prev => [...prev, `[Warning] ${data.message}`]);
        } else if (data.type === 'complete') {
          setCrawlLogs(prev => [...prev, `[Success] ${data.message}`]);
          setCrawlResult({ success: true, message: data.message });
          setIsShopifyExecuting(false);
          loadIngestedUrls(crawlBotId);
          eventSource.close();
        } else if (data.type === 'error') {
          setCrawlLogs(prev => [...prev, `[Error] ${data.message}`]);
          setCrawlResult({ success: false, message: data.message });
          setIsShopifyExecuting(false);
          eventSource.close();
        }
      } catch (e) {
        // ignore JSON parse error
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE Error:", err);
      setCrawlLogs(prev => [...prev, `[System] Connection lost or closed unexpectedly.`]);
      setIsShopifyExecuting(false);
      eventSource.close();
    };
  };

  return (
    <>
          
            <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl space-y-6">
              <div>
                <h3 className="text-lg font-bold text-[var(--awb-color8)]">Ingest Website Content</h3>
                <p className="text-xs text-[var(--awb-color6)] mt-0.5">Scrapes client sites, chunks content, generates embeddings, and saves vectors to the chatbot.</p>
              </div>

              {!isShopifyPreflight ? (
              <form onSubmit={ingestMode === 'url' ? handleTriggerCrawl : ingestMode === 'text' ? handleTriggerText : handleTriggerFile} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-1">
                    <label className="block text-xs font-semibold text-[var(--awb-color6)] mb-1.5">Target Chatbot</label>
                    <select
                      value={crawlBotId}
                      onChange={(e) => setCrawlBotId(e.target.value)}
                      className="w-full bg-white border border-[#f2f3f5] rounded-xl px-3.5 py-2.5 text-sm text-[var(--awb-color8)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      required
                    >
                      <option value="" disabled>Select chatbot...</option>
                      {chatbots.filter(b => b.id !== 'global').map((bot) => (
                        <option key={bot.id} value={bot.id}>
                          {bot.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-1">
                    <label className="block text-xs font-semibold text-[var(--awb-color6)] mb-1.5">Rescan Frequency</label>
                    <select
                      value={crawlSchedule}
                      onChange={(e) => handleSaveSchedule(e.target.value)}
                      disabled={isSavingSchedule}
                      className="w-full bg-white border border-[#f2f3f5] rounded-xl px-3.5 py-2.5 text-sm text-[var(--awb-color8)] focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                    >
                      <option value="none">Never (Manual Only)</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Every 2 Weeks</option>
                    </select>
                  </div>
                  <div className="md:col-span-1">
                    <label className="block text-xs font-semibold text-[var(--awb-color6)] mb-1.5">Source Type</label>
                    <div className="flex bg-[var(--awb-color1)] text-[var(--awb-color8)] border-[var(--awb-color3)] rounded-xl border border-[var(--awb-color3)] overflow-hidden">
                      <button type="button" onClick={() => setIngestMode('url')} className={`flex-1 py-2.5 text-xs font-semibold ${ingestMode === 'url' ? 'bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px]/20 text-[var(--awb-color5)]' : 'text-[var(--awb-color6)] hover:bg-white/5'}`}>URL</button>
                      <button type="button" onClick={() => setIngestMode('text')} className={`flex-1 py-2.5 text-xs font-semibold border-l border-[var(--awb-color3)] ${ingestMode === 'text' ? 'bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px]/20 text-[var(--awb-color5)]' : 'text-[var(--awb-color6)] hover:bg-white/5'}`}>Text</button>
                      <button type="button" onClick={() => setIngestMode('file')} className={`flex-1 py-2.5 text-xs font-semibold border-l border-[var(--awb-color3)] ${ingestMode === 'file' ? 'bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px]/20 text-[var(--awb-color5)]' : 'text-[var(--awb-color6)] hover:bg-white/5'}`}>File</button>
                    </div>
                  </div>
                  
                  {ingestMode === 'url' && (
                    <div className="md:col-span-3">
                      <div className="flex justify-between items-end mb-1.5">
                        <label className="block text-xs font-semibold text-[var(--awb-color6)]">Website URLs to Scrape (comma or space separated)</label>
                        <button 
                          type="button" 
                          onClick={handleDiscoverSitemap}
                          disabled={isDiscoveringSitemap || !crawlUrl.trim()}
                          className="text-xs text-[var(--awb-color5)] hover:text-[var(--awb-color5)] font-medium disabled:opacity-50"
                        >
                          {isDiscoveringSitemap ? 'Searching...' : '🔍 Discover Sitemap'}
                        </button>
                      </div>
                      <textarea
                        placeholder="https://example.com/about, https://example.com/pricing"
                        value={crawlUrl}
                        onChange={(e) => setCrawlUrl(e.target.value)}
                        className="w-full bg-white border border-[#f2f3f5] rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-[var(--awb-color8)] min-h-[42px] resize-y"
                        required
                        rows={2}
                      />
                      
                      {sitemapMessage && (
                        <div className={`mt-2 p-2 rounded text-xs font-medium ${
                          sitemapMessage.type === 'success' ? 'bg-emerald-500/10 text-emerald-800' :
                          sitemapMessage.type === 'error' ? 'bg-red-500/10 text-red-400' :
                          'bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px]/10 text-[var(--awb-color5)]'
                        }`}>
                          {sitemapMessage.text}
                        </div>
                      )}
                    </div>
                  )}

                  {ingestMode === 'text' && (
                    <div className="md:col-span-3 space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-[var(--awb-color6)] mb-1.5">Source Name / Title</label>
                        <input
                          type="text"
                          value={rawTextSource}
                          onChange={(e) => setRawTextSource(e.target.value)}
                          placeholder="e.g. Employee Handbook"
                          className="w-full bg-white border border-[#f2f3f5] rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-[var(--awb-color8)]"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--awb-color6)] mb-1.5">Raw Text Content</label>
                        <textarea
                          value={rawTextContent}
                          onChange={(e) => setRawTextContent(e.target.value)}
                          placeholder="Paste your text content here..."
                          className="w-full bg-white border border-[#f2f3f5] rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-[var(--awb-color8)] min-h-[150px] resize-y styleflo-scrollbar"
                          required
                        />
                      </div>
                    </div>
                  )}

                  {ingestMode === 'file' && (
                    <div className="md:col-span-3">
                      <label className="block text-xs font-semibold text-[var(--awb-color6)] mb-1.5">Upload File (PDF or TXT, max 5MB)</label>
                      <div className="flex items-center gap-4">
                        <label className="flex-1 max-w-sm flex items-center justify-center px-4 py-6 bg-[var(--awb-color1)] text-[var(--awb-color8)] border-[var(--awb-color3)] border-2 border-dashed border-[var(--awb-color3)] rounded-xl cursor-pointer hover:border-indigo-500/50 hover:bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px]/5 transition-colors">
                          <div className="space-y-1 text-center">
                            <svg className="mx-auto h-8 w-8 text-[var(--awb-color6)]" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
                              <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <div className="text-sm text-[var(--awb-color6)]">
                              <span className="text-[var(--awb-color5)] font-semibold focus-within:outline-none focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2 hover:text-[var(--awb-color5)]">Upload a file</span>
                              <p className="pl-1 text-xs">or drag and drop</p>
                            </div>
                            <p className="text-xs text-[var(--awb-color6)]">PDF, TXT up to 5MB</p>
                          </div>
                          <input 
                            type="file" 
                            className="hidden" 
                            accept=".txt,.pdf"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                if (file.size > 5 * 1024 * 1024) {
                                  alert('File exceeds 5MB limit.');
                                } else {
                                  setSelectedFile(file);
                                }
                              }
                            }} 
                          />
                        </label>
                        {selectedFile && (
                          <div className="flex-1 bg-[var(--awb-color1)] text-[var(--awb-color8)] border-[var(--awb-color3)] border border-emerald-500/30 p-3 rounded-xl flex items-center justify-between">
                            <div className="flex flex-col min-w-0">
                              <span className="text-sm font-semibold text-emerald-800 truncate">{selectedFile.name}</span>
                              <span className="text-xs text-[var(--awb-color6)]">{(selectedFile.size / 1024).toFixed(1)} KB</span>
                            </div>
                            <button type="button" onClick={() => setSelectedFile(null)} className="text-[var(--awb-color6)] hover:text-red-400 p-1">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Sitemap Selection UI */}
                {discoveredSitemapUrls.length > 0 && (
                  <div className="mt-4 p-4 border border-indigo-500/30 bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px]/5 rounded-xl space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-[var(--awb-color8)]">Select Pages to Ingest</h4>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleSelectAllSitemap}
                          className="text-xs px-3 py-1.5 bg-[var(--awb-color2)] text-[var(--awb-color8)] hover:bg-gray-700 text-gray-200 rounded-lg transition-colors"
                        >
                          Select Up To 20
                        </button>
                        <button
                          type="button"
                          onClick={handleIngestSelectedSitemap}
                          disabled={selectedSitemapUrls.size === 0}
                          className="text-xs px-3 py-1.5 bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px] hover:bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px] text-[var(--awb-color8)] rounded-lg transition-colors disabled:opacity-50"
                        >
                          Add Selected to Queue ({selectedSitemapUrls.size})
                        </button>
                      </div>
                    </div>
                    
                    <div className="max-h-60 overflow-y-auto space-y-1 styleflo-scrollbar pr-2">
                      {discoveredSitemapUrls.map(url => (
                        <label key={url} className="flex items-start gap-3 p-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors group">
                          <input 
                            type="checkbox" 
                            checked={selectedSitemapUrls.has(url)}
                            onChange={() => handleToggleSitemapUrl(url)}
                            className="mt-0.5 rounded border-gray-600 text-indigo-500 focus:ring-indigo-500 bg-[var(--awb-color1)] w-4 h-4"
                          />
                          <span className="text-sm text-[var(--awb-color7)] break-all group-hover:text-[var(--awb-color8)] transition-colors">{url}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={isCrawling || !crawlBotId || (ingestMode === 'url' ? !crawlUrl : ingestMode === 'text' ? (!rawTextContent || !rawTextSource) : !selectedFile)}
                  className="bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px] hover:bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px] text-[var(--awb-color8)] text-sm font-semibold py-2 px-5 rounded-xl shadow-lg shadow-indigo-500/10 transition-colors disabled:opacity-50"
                >
                  {isCrawling || isShopifyExecuting ? 'Processing...' : ingestMode === 'url' ? 'Trigger Crawler Pipeline' : ingestMode === 'text' ? 'Ingest Text Content' : 'Upload File'}
                </button>
              </form>
              ) : (
                <div className="bg-[var(--awb-color1)] text-[var(--awb-color8)] border-[var(--awb-color3)] p-6 rounded-2xl border border-[var(--awb-color3)] space-y-4">
                  <h4 className="text-sm font-bold text-[var(--awb-color8)]">🛍️ Shopify Store Detected</h4>
                  <p className="text-sm text-[var(--awb-color6)] leading-relaxed">
                    We found a structured Shopify catalog at <strong className="text-gray-200">{shopifyAnalysis?.storeUrl}</strong>.
                    <br/>
                    Total Products: <span className="text-[var(--awb-color8)] font-mono">{shopifyAnalysis?.totalProducts}</span> <br/>
                    Estimated Data Chunks Required: <span className="text-[var(--awb-color8)] font-mono">{shopifyAnalysis?.estimatedChunks}</span>
                  </p>
                  
                  {shopifyAnalysis?.willHitLimit && (
                    <div className="bg-orange-500/10 border border-orange-500/30 p-4 rounded-xl mt-2">
                      <p className="text-xs font-bold text-orange-400 mb-1">⚠️ Data Limit Warning</p>
                      <p className="text-xs text-orange-300">
                        {shopifyAnalysis.limitError || `This store has more products than your current plan allows. We will ingest as much data as possible up to your limit of ${shopifyAnalysis.limitLimit} chunks. Please upgrade your plan to capture the entire store.`}
                      </p>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsShopifyPreflight(false)}
                      className="px-4 py-2 text-xs font-semibold text-[var(--awb-color7)] hover:text-[var(--awb-color8)] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleExecuteShopify}
                      className="px-5 py-2 bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px] hover:bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px] text-[var(--awb-color8)] text-xs font-semibold rounded-xl shadow-lg shadow-indigo-500/20 transition-colors"
                    >
                      {shopifyAnalysis?.willHitLimit ? 'Proceed with Reduced Data' : 'Start Shopify Ingestion'}
                    </button>
                  </div>
                </div>
              )}

              {/* Crawler Log Screen */}
              {crawlLogs.length > 0 && (
                <div className="space-y-2 mt-6">
                  <label className="block text-xs font-semibold text-[var(--awb-color6)]">Scraper Console Output:</label>
                  <div className="p-4 bg-white border border-[#f2f3f5] rounded-2xl font-mono text-xs text-[var(--awb-color7)] h-48 overflow-y-auto space-y-1.5 styleflo-scrollbar">
                    {crawlLogs.map((log, i) => (
                      <div key={i} className={
                        log.startsWith('[Error]') ? 'text-red-400' :
                        log.startsWith('[Success]') ? 'text-emerald-800 font-semibold' :
                        log.startsWith('[System]') ? 'text-[var(--awb-color5)]' : 'text-[var(--awb-color7)]'
                      }>
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Crawl Result Status Alert */}
              {crawlResult && (
                <div className={`p-4 rounded-xl border text-sm ${
                  crawlResult.success
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900/40 border-emerald-500/30 text-emerald-200'
                    : 'bg-red-950/40 border-red-500/30 text-red-200'
                }`}>
                  {crawlResult.message}
                </div>
              )}
            </div>

            {/* Ingested URLs List */}
            <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl space-y-4">
              <div>
                <h3 className="text-lg font-bold text-[var(--awb-color8)]">Ingested Sources</h3>
                <p className="text-xs text-[var(--awb-color6)] mt-0.5">Manage the websites and content already loaded into this chatbot's knowledge base.</p>
              </div>

              {isLoadingUrls ? (
                <div className="text-sm text-[var(--awb-color6)] py-4">Loading sources...</div>
              ) : ingestedUrls.length === 0 ? (
                <div className="text-sm text-[var(--awb-color6)] py-4">No sources ingested yet for this chatbot.</div>
              ) : (
                <div className="space-y-2">
                  {ingestedUrls.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-white border border-[#f2f3f5] rounded-xl">
                      <div className="flex-1 min-w-0 pr-4">
                        <p className="text-sm font-medium text-gray-200 truncate" title={item.url}>{item.url}</p>
                        <p className="text-xs text-[var(--awb-color6)] mt-0.5">
                          {item.chunkCount} {item.chunkCount === 1 ? 'chunk' : 'chunks'} &bull; Last updated {new Date(item.latestDate).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteUrl(item.url)}
                        className="p-1.5 text-[var(--awb-color6)] hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors shrink-0"
                        title="Delete source"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
    </>
  );
}

