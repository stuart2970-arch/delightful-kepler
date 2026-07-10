import React, { useState, useEffect } from 'react';
import { useDashboardStore } from '../../lib/store';

export default function KnowledgeBaseView() {
  const { chatbots, setMetrics } = useDashboardStore();
  const [crawlBotId, setCrawlBotId] = useState(chatbots.filter(b => b.id !== '00000000-0000-0000-0000-000000000000')[0]?.id || '');
  const [crawlUrl, setCrawlUrl] = useState('');
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlLogs, setCrawlLogs] = useState<string[]>([]);
  const [crawlResult, setCrawlResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    const realBots = chatbots.filter(b => b.id !== '00000000-0000-0000-0000-000000000000');
    if (!crawlBotId && realBots.length > 0) {
      setCrawlBotId(realBots[0].id);
    }
  }, [chatbots, crawlBotId]);

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
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">Website URLs to Scrape (comma or space separated)</label>
                    <textarea
                      placeholder="https://example.com/about, https://example.com/pricing"
                      value={crawlUrl}
                      onChange={(e) => setCrawlUrl(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white min-h-[42px] resize-y"
                      required
                      rows={2}
                    />
                  </div>
                </div>
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
    </>
  );
}
