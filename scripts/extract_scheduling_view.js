const fs = require('fs');

let lines = fs.readFileSync('src/components/DashboardClient.tsx', 'utf8').split('\n');

function findBounds(startStr, useBraces=false) {
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
  } else {
    let count = 0;
    for (let i = start + 1; i < lines.length; i++) {
      count += (lines[i].match(/\{/g) || []).length;
      count -= (lines[i].match(/\}/g) || []).length;
      if (count === 0 && i > start) {
        if (lines[i].includes(');')) return [start, i];
      }
    }
  }
  return [start, start];
}

const [jsxStart, jsxEnd] = findBounds("{activeTab === 'scheduling' && (", true);

// useEffect for scheduling
const ueIndexStart = lines.findIndex(l => l.includes("async function fetchScheduling() {"));
// The actual useEffect starts 2 lines above usually
let ueStart = -1;
let ueEnd = -1;
if (ueIndexStart !== -1) {
  ueStart = lines.slice(0, ueIndexStart).findLastIndex(l => l.includes("useEffect(() => {"));
  const bounds = findBounds("useEffect(() => {", false); // might not find the right one if we just search from top
  // let's do it manually
  let count = 0;
  for (let i = ueStart; i < lines.length; i++) {
    count += (lines[i].match(/\{/g) || []).length;
    count -= (lines[i].match(/\}/g) || []).length;
    if (count === 0 && i > ueStart) {
      if (lines[i].includes(');')) { ueEnd = i; break; }
    }
  }
}

// Extract States:
const stateStartStr = "const [services, setServices] = useState<any[]>([]);";
const stateStart = lines.findIndex(l => l.includes(stateStartStr));
const stateEndStr = "const [rwgPhone, setRwgPhone] = useState(rwgConfig?.telephone || '');";
const stateEnd = lines.findIndex(l => l.includes(stateEndStr));

// Extract handlers
const handlersStartStr = "const handleSaveRwgSettings = async () => {";
const hStart = lines.findIndex(l => l.includes(handlersStartStr));

// We need to find the end of the last handler: `handleDeleteStaff`
const lastHandlerStr = "const handleDeleteStaff = async (id: string) => {";
const lastHandlerIndex = lines.findIndex(l => l.includes(lastHandlerStr));
let hEnd = -1;
if (lastHandlerIndex !== -1) {
  let count = 0;
  for (let i = lastHandlerIndex; i < lines.length; i++) {
    count += (lines[i].match(/\{/g) || []).length;
    count -= (lines[i].match(/\}/g) || []).length;
    if (count === 0 && i > lastHandlerIndex) {
      hEnd = i;
      break;
    }
  }
}

console.log('JSX:', jsxStart, jsxEnd);
console.log('UE:', ueStart, ueEnd);
console.log('State:', stateStart, stateEnd);
console.log('Handlers:', hStart, hEnd);

const jsxLines = lines.slice(jsxStart, jsxEnd + 1);
const ueLines = lines.slice(ueStart, ueEnd + 1);
const stateLines = lines.slice(stateStart, stateEnd + 1);
const handlerLines = lines.slice(hStart, hEnd + 1);

const content = `import React, { useState, useEffect } from 'react';
import { useDashboardStore, DailySchedule, WeeklySchedule } from '../../lib/store';
import ServiceEditor from '../ServiceEditor';

export default function SchedulingView() {
  const { tenantId, rwgConfig, bookingMode, bookingUrl } = useDashboardStore();

${stateLines.join('\n')}

${ueLines.join('\n')}

${handlerLines.join('\n')}

  return (
    <>
${jsxLines.join('\n')}
    </>
  );
}
`;

fs.writeFileSync('src/components/dashboard-views/SchedulingView.tsx', content);
console.log('Created SchedulingView.tsx');

// NOW UPDATE DASHBOARDCLIENT
// Replace JSX
lines.splice(jsxStart, jsxEnd - jsxStart + 1, "          {activeTab === 'scheduling' && <SchedulingView />}");

// We must remove bottom to top to avoid shifting indexes
lines.splice(hStart, hEnd - hStart + 1);
lines.splice(ueStart, ueEnd - ueStart + 1);
lines.splice(stateStart, stateEnd - stateStart + 1);

// Add import
lines.splice(6, 0, "import SchedulingView from './dashboard-views/SchedulingView';");

fs.writeFileSync('src/components/DashboardClient.tsx', lines.join('\n'));
console.log('Updated DashboardClient.tsx');
