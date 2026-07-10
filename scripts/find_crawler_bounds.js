const fs = require('fs');
const lines = fs.readFileSync('src/components/DashboardClient.tsx', 'utf8').split('\n');

const crawlerStart = lines.findIndex(l => l.includes("{activeTab === 'crawler' && ("));
let braceCount = 0;
let crawlerEnd = -1;
for (let i = crawlerStart; i < lines.length; i++) {
  const line = lines[i];
  braceCount += (line.match(/\{/g) || []).length;
  braceCount -= (line.match(/\}/g) || []).length;
  braceCount += (line.match(/\(/g) || []).length;
  braceCount -= (line.match(/\)/g) || []).length;
  if (braceCount === 0 && i > crawlerStart) {
    crawlerEnd = i;
    break;
  }
}

const triggerHandlerStart = lines.findIndex(l => l.includes("const handleTriggerCrawl = async"));
let braceCount2 = 0;
let triggerHandlerEnd = -1;
for (let i = triggerHandlerStart; i < lines.length; i++) {
  const line = lines[i];
  braceCount2 += (line.match(/\{/g) || []).length;
  braceCount2 -= (line.match(/\}/g) || []).length;
  if (braceCount2 === 0 && i > triggerHandlerStart) {
    triggerHandlerEnd = i;
    break;
  }
}

console.log('JSX:', crawlerStart, crawlerEnd);
console.log('Handler:', triggerHandlerStart, triggerHandlerEnd);
