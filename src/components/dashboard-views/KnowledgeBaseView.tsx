import React, { useState, useEffect } from 'react';
import { useDashboardStore } from '../../lib/store';

export default function KnowledgeBaseView() {
  const { chatbots, setMetrics } = useDashboardStore();
  const [crawlBotId, setCrawlBotId] = useState(chatbots.filter(b => b.id !== '00000000-0000-0000-0000-000000000000')[0]?.id || '');
  const [crawlUrl, setCrawlUrl] = useState('');
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
    } else {
      setIngestedUrls([]);
    }
  }, [crawlBotId]);

  const handleDeleteUrl = async (url: string) => {
    if (!crawlBotId || !confirm(`Are you sure you want to delete all chunks for ${url}?`)) return;
    
    try {
      const res = await fetch(`/api/ingest/urls?chatbotId=${encodeURIComponent(crawlBotId)}&sourceUrl=${encodeURIComponent(url)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setIngestedUrls(prev => prev.filter(item => item.url !== url));
        // We could also optionally adjust the metric chunksCount down here, but usually it's fine.
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

  return (
    <>
          
            <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl space-y-6">
              <div>
                <h3 className="text-lg font-bold text-white">Ingest Website Content</h3>
                <p className="text-xs text-gray-400 mt-0.5">Scrapes client sites, chunks content, generates embeddings, and saves vectors to the chatbot.</p>
              </div>

              <form onSubmit={handleTriggerCrawl} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-1">
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">Target Chatbot</label>
                    <select
                      value={crawlBotId}
                      onChange={(e) => setCrawlBotId(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                  <div className="md:col-span-2">
                    <div className="flex justify-between items-end mb-1.5">
                      <label className="block text-xs font-semibold text-gray-400">Website URLs to Scrape (comma or space separated)</label>
                      <button 
                        type="button" 
                        onClick={handleDiscoverSitemap}
                        disabled={isDiscoveringSitemap || !crawlUrl.trim()}
                        className="text-xs text-indigo-400 hover:text-indigo-300 font-medium disabled:opacity-50"
                      >
                        {isDiscoveringSitemap ? 'Searching...' : '🔍 Discover Sitemap'}
                      </button>
                    </div>
                    <textarea
                      placeholder="https://example.com/about, https://example.com/pricing"
                      value={crawlUrl}
                      onChange={(e) => setCrawlUrl(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white min-h-[42px] resize-y"
                      required
                      rows={2}
                    />
                    
                    {sitemapMessage && (
                      <div className={`mt-2 p-2 rounded text-xs font-medium ${
                        sitemapMessage.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                        sitemapMessage.type === 'error' ? 'bg-red-500/10 text-red-400' :
                        'bg-indigo-500/10 text-indigo-400'
                      }`}>
                        {sitemapMessage.text}
                      </div>
                    )}
                  </div>
                </div>

                {/* Sitemap Selection UI */}
                {discoveredSitemapUrls.length > 0 && (
                  <div className="mt-4 p-4 border border-indigo-500/30 bg-indigo-500/5 rounded-xl space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-white">Select Pages to Ingest</h4>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleSelectAllSitemap}
                          className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors"
                        >
                          Select Up To 20
                        </button>
                        <button
                          type="button"
                          onClick={handleIngestSelectedSitemap}
                          disabled={selectedSitemapUrls.size === 0}
                          className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50"
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
                            className="mt-0.5 rounded border-gray-600 text-indigo-500 focus:ring-indigo-500 bg-gray-900 w-4 h-4"
                          />
                          <span className="text-sm text-gray-300 break-all group-hover:text-white transition-colors">{url}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={isCrawling || !crawlBotId || !crawlUrl}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-2 px-5 rounded-xl shadow-lg shadow-indigo-500/10 transition-colors disabled:opacity-50"
                >
                  {isCrawling ? 'Processing Crawler...' : 'Trigger Crawler Pipeline'}
                </button>
              </form>

              {/* Crawler Log Screen */}
              {crawlLogs.length > 0 && (
                <div className="space-y-2 mt-6">
                  <label className="block text-xs font-semibold text-gray-400">Scraper Console Output:</label>
                  <div className="p-4 bg-gray-950 border border-gray-900 rounded-2xl font-mono text-xs text-gray-300 h-48 overflow-y-auto space-y-1.5 styleflo-scrollbar">
                    {crawlLogs.map((log, i) => (
                      <div key={i} className={
                        log.startsWith('[Error]') ? 'text-red-400' :
                        log.startsWith('[Success]') ? 'text-emerald-400 font-semibold' :
                        log.startsWith('[System]') ? 'text-indigo-400' : 'text-gray-300'
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
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200'
                    : 'bg-red-950/40 border-red-500/30 text-red-200'
                }`}>
                  {crawlResult.message}
                </div>
              )}
            </div>

            {/* Ingested URLs List */}
            <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl space-y-4">
              <div>
                <h3 className="text-lg font-bold text-white">Ingested Sources</h3>
                <p className="text-xs text-gray-400 mt-0.5">Manage the websites and content already loaded into this chatbot's knowledge base.</p>
              </div>

              {isLoadingUrls ? (
                <div className="text-sm text-gray-400 py-4">Loading sources...</div>
              ) : ingestedUrls.length === 0 ? (
                <div className="text-sm text-gray-500 py-4">No sources ingested yet for this chatbot.</div>
              ) : (
                <div className="space-y-2">
                  {ingestedUrls.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-gray-950 border border-gray-800 rounded-xl">
                      <div className="flex-1 min-w-0 pr-4">
                        <p className="text-sm font-medium text-gray-200 truncate" title={item.url}>{item.url}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {item.chunkCount} {item.chunkCount === 1 ? 'chunk' : 'chunks'} &bull; Last updated {new Date(item.latestDate).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteUrl(item.url)}
                        className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors shrink-0"
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
