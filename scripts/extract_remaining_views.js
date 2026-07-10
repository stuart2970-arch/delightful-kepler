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

// -----------------------------------------
// 1. SCHEDULING VIEW EXTRACTION
// -----------------------------------------
const [schedJsxStart, schedJsxEnd] = findBounds("{activeTab === 'scheduling' && (", true);
const schedStateStartStr = "const [isFetchingScheduling, setIsFetchingScheduling] = useState(false);";
const schedStateStart = lines.findIndex(l => l.includes(schedStateStartStr));
const schedStateEndStr = "const [newStaffSchedule, setNewStaffSchedule] = useState<{weeks: WeeklySchedule[]}>({";
const schedStateEnd = schedStateStart !== -1 ? findBounds(schedStateEndStr, true)[1] : -1;

const schedHandlersStartStr = "const handleAddService = async (e: React.FormEvent) => {";
const schedHandlersStart = lines.findIndex(l => l.includes(schedHandlersStartStr));
const schedHandlersEndStr = "const handleDeleteStaff = async (id: string) => {";
const schedHandlersEnd = schedHandlersStart !== -1 ? findBounds(schedHandlersEndStr, true)[1] : -1;

// -----------------------------------------
// 2. INTEGRATIONS VIEW EXTRACTION
// -----------------------------------------
const [intJsxStart, intJsxEnd] = findBounds("{activeTab === 'integrations' && (", true);
const intStateStartStr = "const [rwgIntegrityLogs, setRwgIntegrityLogs] = useState<string[]>([]);";
const intStateStart = lines.findIndex(l => l.includes(intStateStartStr));
const intStateEndStr = "const [rwgPhone, setRwgPhone] = useState(rwgConfig?.telephone || '');";
const intStateEnd = lines.findIndex(l => l.includes(intStateEndStr));

const intHandlersStartStr = "const handleSaveRwgSettings = async () => {";
const intHandlersStart = lines.findIndex(l => l.includes(intHandlersStartStr));
const intHandlersEndStr = "const handleDisconnectCalendar = async () => {";
const intHandlersEnd = intHandlersStart !== -1 ? findBounds(intHandlersEndStr, true)[1] : -1;


// BUILD SCHEDULING VIEW COMPONENT
const schedStateLines = lines.slice(schedStateStart, schedStateEnd + 1);
const schedHandlerLines = lines.slice(schedHandlersStart, schedHandlersEnd + 1);
const schedJsxLines = lines.slice(schedJsxStart, schedJsxEnd + 1);

const schedContent = `import React, { useState } from 'react';
import { useDashboardStore, DailySchedule, WeeklySchedule } from '../../lib/store';
import ServiceEditor from '../ServiceEditor';

export default function SchedulingView() {
  const { tenantId, services, setServices, staff, setStaff } = useDashboardStore();

${schedStateLines.join('\n')}

${schedHandlerLines.join('\n')}

  return (
    <>
${schedJsxLines.join('\n')}
    </>
  );
}
`;
fs.writeFileSync('src/components/dashboard-views/SchedulingView.tsx', schedContent);

// BUILD INTEGRATIONS VIEW COMPONENT
const intStateLines = lines.slice(intStateStart, intStateEnd + 1);
const intHandlerLines = lines.slice(intHandlersStart, intHandlersEnd + 1);
const intJsxLines = lines.slice(intJsxStart, intJsxEnd + 1);

const intContent = `import React, { useState } from 'react';
import { useDashboardStore } from '../../lib/store';

export default function IntegrationsView() {
  const { tenantId, isGoogleConnected, setIsGoogleConnected, bookingMode, bookingUrl, rwgConfig, services, staff } = useDashboardStore();

${intStateLines.join('\n')}

${intHandlerLines.join('\n')}

  return (
    <>
${intJsxLines.join('\n')}
    </>
  );
}
`;
fs.writeFileSync('src/components/dashboard-views/IntegrationsView.tsx', intContent);


// CLEAN UP DASHBOARD CLIENT (bottom to top)

// Replace JSX
if (intJsxStart !== -1) {
  lines.splice(intJsxStart, intJsxEnd - intJsxStart + 1, "          {activeTab === 'integrations' && <IntegrationsView />}");
}
if (schedJsxStart !== -1) {
  lines.splice(schedJsxStart, schedJsxEnd - schedJsxStart + 1, "          {activeTab === 'scheduling' && <SchedulingView />}");
}

// Remove Handlers
if (intHandlersStart !== -1) {
  lines.splice(intHandlersStart, intHandlersEnd - intHandlersStart + 1);
}
if (schedHandlersStart !== -1) {
  lines.splice(schedHandlersStart, schedHandlersEnd - schedHandlersStart + 1);
}

// Remove States
if (intStateStart !== -1) {
  lines.splice(intStateStart, intStateEnd - intStateStart + 1);
}
if (schedStateStart !== -1) {
  lines.splice(schedStateStart, schedStateEnd - schedStateStart + 1);
}

// Remove useStates for services, staff, isGoogleConnected from DashboardClient
// They are now in useDashboardStore
const useStatesToRemove = [
  "const [services, setServices] = useState<any[]>([]);",
  "const [staff, setStaff] = useState<any[]>([]);",
  "const [isGoogleConnected, setIsGoogleConnected] = useState(false);"
];
for (const str of useStatesToRemove) {
  const i = lines.findIndex(l => l.includes(str));
  if (i !== -1) lines.splice(i, 1);
}

// Add imports
lines.splice(5, 0, 
  "import SchedulingView from './dashboard-views/SchedulingView';",
  "import IntegrationsView from './dashboard-views/IntegrationsView';"
);

fs.writeFileSync('src/components/DashboardClient.tsx', lines.join('\n'));
console.log('Extracted SchedulingView and IntegrationsView!');
