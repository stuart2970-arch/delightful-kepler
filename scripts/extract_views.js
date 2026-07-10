const fs = require('fs');
const lines = fs.readFileSync('src/components/DashboardClient.tsx', 'utf8').split('\n');

const handlers = lines.slice(313, 439).join('\n');
const jsxLines = lines.slice(962, 1169);

// Remove the `          )}` line if it exists at the end
if (jsxLines[jsxLines.length - 1].trim() === ')}') {
  jsxLines.pop();
}

const jsx = jsxLines.join('\n');

const content = `import React, { useState } from 'react';
import { useDashboardStore, Chatbot } from '../../lib/store';
import { createBrowserClient } from '@supabase/ssr';

export default function ChatbotManagerView() {
  const { chatbots, setChatbots, setMetrics, tenantId, isSuperAdmin, testWidgetBotId, setTestWidgetBotId } = useDashboardStore();
  const [newBotName, setNewBotName] = useState('');
  const [newBotColor, setNewBotColor] = useState('#4F46E5');
  const [newBotWelcome, setNewBotWelcome] = useState('Hello! How can I help you today?');
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentRole, setNewAgentRole] = useState('AI Assistant');
  const [newAgentAvatar, setNewAgentAvatar] = useState('/avatars/avatar1.png');
  const [isCreatingBot, setIsCreatingBot] = useState(false);
  const [editingBotId, setEditingBotId] = useState<string | null>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = supabaseUrl && supabaseAnonKey ? createBrowserClient(supabaseUrl, supabaseAnonKey) : null;
  const globalBotId = '00000000-0000-0000-0000-000000000000';

${handlers}

  return (
    <>
${jsx}
    </>
  );
}
`;

fs.writeFileSync('src/components/dashboard-views/ChatbotManagerView.tsx', content);
console.log('Fixed ChatbotManagerView');