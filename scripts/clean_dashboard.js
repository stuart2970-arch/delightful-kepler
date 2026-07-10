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

// 1. Chatbot View
const [cbJsxStart, cbJsxEnd] = findBounds("{activeTab === 'chatbots' && (", true);
const cbHandlersStart = lines.findIndex(l => l.includes("const handleSaveConfiguration = async () => {"));
const cbHandlersEnd = lines.findIndex(l => l.includes("const handleDeployWidget = async () => {"));
const cbHandlersEndBlock = cbHandlersEnd !== -1 ? findBounds("const handleDeployWidget = async () => {", true)[1] : -1;

const cbStateStart = lines.findIndex(l => l.includes("const [editingChatbotId, setEditingChatbotId]"));
const cbStateEnd = cbStateStart !== -1 ? cbStateStart + 5 : -1;

// 2. Knowledge Base View
const [kbJsxStart, kbJsxEnd] = findBounds("{activeTab === 'crawler' && (", true);
const kbHandlersStart = lines.findIndex(l => l.includes("const handleTriggerCrawl = async () => {"));
const kbHandlersEndBlock = kbHandlersStart !== -1 ? findBounds("const handleTriggerCrawl = async () => {", true)[1] : -1;

const kbStateStart = lines.findIndex(l => l.includes("const [crawlBotId, setCrawlBotId]"));
const kbStateEnd = kbStateStart !== -1 ? kbStateStart + 4 : -1;

// 3. Inbox View
const [inboxJsxStart, inboxJsxEnd] = findBounds("{activeTab === 'conversations' && (", true);
const [inboxUeStart, inboxUeEnd] = findBounds("// Fetch messages when conversation selection changes", false);

const inboxStateStart = lines.findIndex(l => l.includes("const [selectedConversation, setSelectedConversation]"));
const inboxStateEnd = inboxStateStart !== -1 ? inboxStateStart + 3 : -1;

// Now, carefully splice from bottom to top!

// Bottom is JSX (lines ~900-1100)
// Inbox JSX
if (inboxJsxStart !== -1) {
  lines.splice(inboxJsxStart, inboxJsxEnd - inboxJsxStart + 1, "          {activeTab === 'conversations' && <InboxView />}");
}
// KB JSX
if (kbJsxStart !== -1) {
  const [newKbStart, newKbEnd] = findBounds("{activeTab === 'crawler' && (", true);
  lines.splice(newKbStart, newKbEnd - newKbStart + 1, "          {activeTab === 'crawler' && <KnowledgeBaseView />}");
}
// Chatbot JSX
if (cbJsxStart !== -1) {
  const [newCbStart, newCbEnd] = findBounds("{activeTab === 'chatbots' && (", true);
  lines.splice(newCbStart, newCbEnd - newCbStart + 1, "          {activeTab === 'chatbots' && <ChatbotManagerView />}");
}

// Handlers (lines 300-500)
// KB Handlers
if (kbHandlersStart !== -1) {
  const hStart = lines.findIndex(l => l.includes("const handleTriggerCrawl = async () => {"));
  const hEnd = findBounds("const handleTriggerCrawl = async () => {", true)[1];
  lines.splice(hStart, hEnd - hStart + 1);
}

// Chatbot Handlers
if (cbHandlersStart !== -1) {
  const hStart = lines.findIndex(l => l.includes("const handleSaveConfiguration = async () => {"));
  const hEnd = findBounds("const handleDeployWidget = async () => {", true)[1];
  lines.splice(hStart, hEnd - hStart + 1);
}

// Inbox useEffect
if (inboxUeStart !== -1) {
  const hStart = lines.findIndex(l => l.includes("// Fetch messages when conversation selection changes"));
  const hEnd = findBounds("// Fetch messages when conversation selection changes", false)[1];
  lines.splice(hStart, hEnd - hStart + 1);
}

// States (lines 100-200)
// KB States
if (kbStateStart !== -1) {
  const sStart = lines.findIndex(l => l.includes("const [crawlBotId, setCrawlBotId]"));
  lines.splice(sStart, 5);
}

// Inbox States
if (inboxStateStart !== -1) {
  const sStart = lines.findIndex(l => l.includes("const [selectedConversation, setSelectedConversation]"));
  lines.splice(sStart, 4);
}

// Chatbot States
if (cbStateStart !== -1) {
  const sStart = lines.findIndex(l => l.includes("const [editingChatbotId, setEditingChatbotId]"));
  lines.splice(sStart, 6);
}

// Remove Interfaces
const convInt = lines.findIndex(l => l.includes("interface Conversation {"));
if (convInt !== -1) {
  lines.splice(convInt, 6);
}
const msgInt = lines.findIndex(l => l.includes("interface Message {"));
if (msgInt !== -1) {
  lines.splice(msgInt, 6);
}

// Add Imports at top
lines.splice(5, 0, 
  "import ChatbotManagerView from './dashboard-views/ChatbotManagerView';",
  "import KnowledgeBaseView from './dashboard-views/KnowledgeBaseView';",
  "import InboxView from './dashboard-views/InboxView';"
);

fs.writeFileSync('src/components/DashboardClient.tsx', lines.join('\n'));
console.log('Cleaned DashboardClient.tsx!');
