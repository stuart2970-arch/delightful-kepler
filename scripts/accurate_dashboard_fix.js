const fs = require('fs');
const lines = fs.readFileSync('src/components/DashboardClient.tsx', 'utf8').split('\n');
function findBlock(startStr) {
  const start = lines.findIndex(l => l.includes(startStr));
  if (start === -1) return [-1, -1];
  let count = 0;
  for(let i = start; i < lines.length; i++) {
    count += (lines[i].match(/\{/g) || []).length;
    count -= (lines[i].match(/\}/g) || []).length;
    count += (lines[i].match(/\(/g) || []).length;
    count -= (lines[i].match(/\)/g) || []).length;
    if (count === 0 && i > start) return [start, i];
  }
}

// Handlers
const handlers = [
  ['handleSaveConfiguration', 'const handleDeployWidget = async () => {'], // chatbots
  ['handleTriggerCrawl', 'const handleTriggerCrawl = async () => {'], // crawler
  ['handleSaveRwgSettings', 'const handleDisconnectCalendar = async () => {'], // integrations
  ['handleAddService', 'const handleDeleteStaff = async (id: string) => {'] // scheduling
];

function findHandlers(startStr, endStr) {
  const start = lines.findIndex(l => l.includes(startStr));
  if (start === -1) return [-1, -1];
  const endIndex = lines.findIndex(l => l.includes(endStr));
  if (endIndex === -1) return [-1, -1];
  let count = 0;
  for(let i = endIndex; i < lines.length; i++) {
    count += (lines[i].match(/\{/g) || []).length;
    count -= (lines[i].match(/\}/g) || []).length;
    if (count === 0 && i > endIndex) return [start, i];
  }
}

const res = {
  chatbots: findBlock("{activeTab === 'chatbots' && ("),
  crawler: findBlock("{activeTab === 'crawler' && ("),
  conversations: findBlock("{activeTab === 'conversations' && ("),
  scheduling: findBlock("{activeTab === 'scheduling' && ("),
  integrations: findBlock("{activeTab === 'integrations' && ("),
  handlers_chatbots: findHandlers("const handleSaveConfiguration = async () => {", "const handleDeployWidget = async () => {"),
  handlers_crawler: findHandlers("const handleTriggerCrawl = async () => {", "const handleTriggerCrawl = async () => {"),
  handlers_integrations: findHandlers("const handleSaveRwgSettings = async () => {", "const handleDisconnectCalendar = async () => {"),
  handlers_scheduling: findHandlers("const handleAddService = async (e: React.FormEvent) => {", "const handleDeleteStaff = async (id: string) => {")
};

console.log(JSON.stringify(res, null, 2));

// Generate the fix_dashboard.js based on these exact lines:
// But actually we just want to replace these blocks precisely.

let newLines = [...lines];

const splices = [];
if (res.chatbots[0] !== -1) splices.push({ start: res.chatbots[0], end: res.chatbots[1], content: "          {activeTab === 'chatbots' && <ChatbotManagerView />}" });
if (res.crawler[0] !== -1) splices.push({ start: res.crawler[0], end: res.crawler[1], content: "          {activeTab === 'crawler' && <KnowledgeBaseView />}" });
if (res.conversations[0] !== -1) splices.push({ start: res.conversations[0], end: res.conversations[1], content: "          {activeTab === 'conversations' && <InboxView />}" });
if (res.scheduling[0] !== -1) splices.push({ start: res.scheduling[0], end: res.scheduling[1], content: "          {activeTab === 'scheduling' && <SchedulingView />}" });
if (res.integrations[0] !== -1) splices.push({ start: res.integrations[0], end: res.integrations[1], content: "          {activeTab === 'integrations' && <IntegrationsView />}" });

// sort by start descending so splicing works
splices.sort((a, b) => b.start - a.start);

for (const s of splices) {
  newLines.splice(s.start, s.end - s.start + 1, s.content);
}

// Handlers
const hSplices = [];
if (res.handlers_scheduling[0] !== -1) hSplices.push({ start: res.handlers_scheduling[0], end: res.handlers_scheduling[1] });
if (res.handlers_integrations[0] !== -1) hSplices.push({ start: res.handlers_integrations[0], end: res.handlers_integrations[1] });
if (res.handlers_crawler[0] !== -1) hSplices.push({ start: res.handlers_crawler[0], end: res.handlers_crawler[1] });
if (res.handlers_chatbots[0] !== -1) hSplices.push({ start: res.handlers_chatbots[0], end: res.handlers_chatbots[1] });

// Fetch messages useEffect
const inboxUeStart = newLines.findIndex(l => l.includes("// Fetch messages when conversation selection changes"));
if (inboxUeStart !== -1) {
  let uecount = 0;
  for(let i = inboxUeStart + 1; i < newLines.length; i++) {
    uecount += (newLines[i].match(/\{/g) || []).length;
    uecount -= (newLines[i].match(/\}/g) || []).length;
    if (uecount === 0 && newLines[i].includes(');')) {
      hSplices.push({ start: inboxUeStart, end: i });
      break;
    }
  }
}

hSplices.sort((a, b) => b.start - a.start);

for (const s of hSplices) {
  newLines.splice(s.start, s.end - s.start + 1);
}

// States
const statesToRemove = [
  "const [editingChatbotId, setEditingChatbotId] = useState<string | null>(null);",
  "const [newChatbotName, setNewChatbotName] = useState('');",
  "const [newChatbotColor, setNewChatbotColor] = useState('#6366f1');",
  "const [isSavingChatbot, setIsSavingChatbot] = useState(false);",
  "const [isDeployingWidget, setIsDeployingWidget] = useState(false);",
  "const [showChatbotModal, setShowChatbotModal] = useState(false);",
  
  "const [crawlBotId, setCrawlBotId] = useState",
  "const [crawlUrl, setCrawlUrl] = useState('');",
  "const [isCrawling, setIsCrawling] = useState(false);",
  "const [crawlLogs, setCrawlLogs] = useState<string[]>([]);",
  "const [crawlResult, setCrawlResult] = useState",

  "const [selectedConversation, setSelectedConversation] = useState<string | null>(null);",
  "const [conversationMessages, setConversationMessages] = useState<Message[]>([]);",
  "const [isFetchingMessages, setIsFetchingMessages] = useState(false);",
  "const [convPage, setConvPage] = useState(0);",

  "const [showServiceModal, setShowServiceModal] = useState(false);",
  "const [editingServiceId, setEditingServiceId] = useState<string | null>(null);",
  "const [newServiceName, setNewServiceName] = useState('');",
  "const [newServiceDesc, setNewServiceDesc] = useState('');",
  "const [newServiceDuration, setNewServiceDuration] = useState('30');",
  "const [newServicePrice, setNewServicePrice] = useState('0');",

  "const [showStaffModal, setShowStaffModal] = useState(false);",
  "const [editingStaffId, setEditingStaffId] = useState<string | null>(null);",
  "const [newStaffName, setNewStaffName] = useState('');",
  "const [newStaffEmail, setNewStaffEmail] = useState('');",
  "const [newStaffCalId, setNewStaffCalId] = useState('');",
  "const [newStaffServices, setNewStaffServices] = useState<string[]>([]);",
  
  "const [newStaffSchedule, setNewStaffSchedule] = useState<{weeks: WeeklySchedule[]}>({",
  
  "const [rwgIntegrityLogs, setRwgIntegrityLogs] = useState<string[]>([]);",
  "const [isCheckingRwgIntegrity, setIsCheckingRwgIntegrity] = useState(false);",
  "const [isSavingRwg, setIsSavingRwg] = useState(false);",
  "const [rwgBusinessName, setRwgBusinessName] = useState",
  "const [rwgStreetAddress, setRwgStreetAddress] = useState",
  "const [rwgCity, setRwgCity] = useState",
  "const [rwgPostcode, setRwgPostcode] = useState",
  "const [rwgPhone, setRwgPhone] = useState",
  "const [isSavingBookingMode, setIsSavingBookingMode] = useState(false);"
];

// we also need to remove createEmptySchedule
const emptySchedIndex = newLines.findIndex(l => l.includes("const createEmptySchedule = (weekDate?: string): WeeklySchedule => ({"));
if (emptySchedIndex !== -1) {
  let count = 0;
  for(let i = emptySchedIndex; i < newLines.length; i++) {
    count += (newLines[i].match(/\{/g) || []).length;
    count -= (newLines[i].match(/\}/g) || []).length;
    if (count === 0 && newLines[i].includes('});')) {
      newLines.splice(emptySchedIndex, i - emptySchedIndex + 1);
      break;
    }
  }
}

// remove the newStaffSchedule block
const newStaffSchedIndex = newLines.findIndex(l => l.includes("const [newStaffSchedule, setNewStaffSchedule] = useState<{weeks: WeeklySchedule[]}>({"));
if (newStaffSchedIndex !== -1) {
  let count = 0;
  for(let i = newStaffSchedIndex; i < newLines.length; i++) {
    count += (newLines[i].match(/\{/g) || []).length;
    count -= (newLines[i].match(/\}/g) || []).length;
    if (count === 0 && newLines[i].includes('});')) {
      newLines.splice(newStaffSchedIndex, i - newStaffSchedIndex + 1);
      break;
    }
  }
}

// Remove the explicit states
for (const str of statesToRemove) {
  const i = newLines.findIndex(l => l.includes(str));
  if (i !== -1) newLines.splice(i, 1);
}

// Remove store variables that were handled
const storeVars = [
  "const [services, setServices] = useState<any[]>([]);",
  "const [staff, setStaff] = useState<any[]>([]);",
  "const [isGoogleConnected, setIsGoogleConnected] = useState(false);"
];
for (const str of storeVars) {
  const i = newLines.findIndex(l => l.includes(str));
  if (i !== -1) newLines.splice(i, 1);
}

// remove Conversation and Message interfaces
const convInt = newLines.findIndex(l => l.includes("interface Conversation {"));
if (convInt !== -1) newLines.splice(convInt, 6);
const msgInt = newLines.findIndex(l => l.includes("interface Message {"));
if (msgInt !== -1) newLines.splice(msgInt, 6);


fs.writeFileSync('src/components/DashboardClient.tsx', newLines.join('\n'));
console.log('Fixed DashboardClient.tsx!');
