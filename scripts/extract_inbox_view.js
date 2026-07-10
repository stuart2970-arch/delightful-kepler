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
    // For useEffect with [] array at the end
    let count = 0;
    for (let i = start + 1; i < lines.length; i++) {
      count += (lines[i].match(/\{/g) || []).length;
      count -= (lines[i].match(/\}/g) || []).length;
      if (count === 0 && i > start) {
        // usually the line with `}, [deps]);`
        if (lines[i].includes(');')) return [start, i];
      }
    }
  }
  return [start, start];
}

const [jsxStart, jsxEnd] = findBounds("{activeTab === 'conversations' && (", true);
const [ueStart, ueEnd] = findBounds("// Fetch messages when conversation selection changes", false);

// states:
// const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
// const [conversationMessages, setConversationMessages] = useState<Message[]>([]);
// const [isFetchingMessages, setIsFetchingMessages] = useState(false);
// const [convPage, setConvPage] = useState(0);

const sStart = lines.findIndex(l => l.includes("const [selectedConversation, setSelectedConversation]"));
const sEnd = sStart + 3; // 4 states

const jsxLines = lines.slice(jsxStart, jsxEnd + 1);
const ueLines = lines.slice(ueStart, ueEnd + 1);

const content = `import React, { useState, useEffect } from 'react';
import { useDashboardStore, Message } from '../../lib/store';
import { createBrowserClient } from '@supabase/ssr';

export default function InboxView() {
  const { tenantId, conversations } = useDashboardStore();
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<Message[]>([]);
  const [isFetchingMessages, setIsFetchingMessages] = useState(false);
  const [convPage, setConvPage] = useState(0);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = supabaseUrl && supabaseAnonKey ? createBrowserClient(supabaseUrl, supabaseAnonKey) : null;

${ueLines.join('\n')}

  return (
    <>
${jsxLines.join('\n')}
    </>
  );
}
`;

fs.writeFileSync('src/components/dashboard-views/InboxView.tsx', content);
console.log('Created InboxView');

// Clean up DashboardClient
lines.splice(jsxStart, jsxEnd - jsxStart + 1, "          {activeTab === 'conversations' && <InboxView />}");
lines.splice(ueStart, ueEnd - ueStart + 1);
const stateStart = lines.findIndex(l => l.includes("const [selectedConversation, setSelectedConversation]"));
if (stateStart !== -1) {
  lines.splice(stateStart, 4);
}

// remove Conversation and Message interfaces since they are in store
const convoIntStart = lines.findIndex(l => l.includes("interface Conversation {"));
if (convoIntStart !== -1) {
  lines.splice(convoIntStart, 6);
}

// Add import
lines.splice(6, 0, "import InboxView from './dashboard-views/InboxView';");

fs.writeFileSync('src/components/DashboardClient.tsx', lines.join('\n'));
console.log('Updated DashboardClient.tsx');
