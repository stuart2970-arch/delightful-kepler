const fs = require('fs');

let lines = fs.readFileSync('src/components/DashboardClient.tsx', 'utf8').split('\n');

function findBounds(startStr, endStr=null, useBraces=false) {
  const start = lines.findIndex(l => l.includes(startStr));
  if (start === -1) return [-1, -1];
  
  if (useBraces) {
    let count = 0;
    for (let i = start; i < lines.length; i++) {
      count += (lines[i].match(/\{/g) || []).length;
      count -= (lines[i].match(/\}/g) || []).length;
      count += (lines[i].match(/\(/g) || []).length;
      count -= (lines[i].match(/\)/g) || []).length;
      if (count === 0 && i > start) return [start, i];
    }
  } else if (endStr) {
    const endOffset = lines.slice(start).findIndex(l => l.includes(endStr));
    if (endOffset !== -1) return [start, start + endOffset];
  }
  return [start, start];
}

const [jsxStart, jsxEnd] = findBounds("{activeTab === 'crawler' && (", null, true);
const [handlerStart, handlerEnd] = findBounds("const handleTriggerCrawl = async", null, true);
const stateStart = lines.findIndex(l => l.includes("const [crawlBotId, setCrawlBotId]"));
const stateEnd = stateStart + 4; // 5 state variables

const jsxLines = lines.slice(jsxStart, jsxEnd + 1);
const handlerLines = lines.slice(handlerStart, handlerEnd + 1);

const content = `import React, { useState, useEffect } from 'react';
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

${handlerLines.join('\n')}

  return (
    <>
${jsxLines.join('\n')}
    </>
  );
}
`;

fs.writeFileSync('src/components/dashboard-views/KnowledgeBaseView.tsx', content);
console.log('Created KnowledgeBaseView');

// Now clean up DashboardClient.tsx
// Reverse order to avoid shifting issues
lines.splice(jsxStart, jsxEnd - jsxStart + 1, "          {activeTab === 'crawler' && <KnowledgeBaseView />}");

// Also remove the useEffect check
const ueStart = lines.findIndex(l => l.includes("if (!crawlBotId && realBots.length > 0) {"));
if (ueStart !== -1) {
  lines.splice(ueStart, 3);
}

const handlerStartUpdated = lines.findIndex(l => l.includes("const handleTriggerCrawl = async"));
const handlerEndUpdated = lines.findIndex(l => l.includes("const handleDisconnectCalendar = async")); // Just to be safe?
// Actually we have handlerStart and handlerEnd, but due to splices below they change! 
// Let's just find them again!
const hStart = lines.findIndex(l => l.includes("const handleTriggerCrawl = async"));
if (hStart !== -1) {
  let count = 0;
  let hEnd = -1;
  for (let i = hStart; i < lines.length; i++) {
    count += (lines[i].match(/\{/g) || []).length;
    count -= (lines[i].match(/\}/g) || []).length;
    if (count === 0 && i > hStart) { hEnd = i; break; }
  }
  lines.splice(hStart, hEnd - hStart + 1);
}

const sStart = lines.findIndex(l => l.includes("const [crawlBotId, setCrawlBotId]"));
if (sStart !== -1) {
  lines.splice(sStart, 5); // 5 state variables
}

// remove crawlBotId from useEffect deps
const depLine = lines.findIndex(l => l.includes("}, [chatbots, crawlBotId]);"));
if (depLine !== -1) {
  lines[depLine] = lines[depLine].replace(", crawlBotId", "");
}

// Add import
lines.splice(6, 0, "import KnowledgeBaseView from './dashboard-views/KnowledgeBaseView';");

fs.writeFileSync('src/components/DashboardClient.tsx', lines.join('\n'));
console.log('Updated DashboardClient.tsx');
