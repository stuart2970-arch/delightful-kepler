const fs = require('fs');
let lines = fs.readFileSync('src/components/DashboardClient.tsx', 'utf8').split('\n');

// 1. We replace the JSX (lines 962-1170) with <ChatbotManagerView />
// Lines are 0-indexed.
// 962 is `{activeTab === 'chatbots' && (`
// 1170 is `          )}` (from our previous analysis, line index 1169).
// Let's replace the array elements 962 through 1169 with one element: `          {activeTab === 'chatbots' && <ChatbotManagerView />}`
lines.splice(962, 1170 - 962 + 1, "          {activeTab === 'chatbots' && <ChatbotManagerView />}");

// 2. We remove the handlers (lines 313-439)
// Since we removed from the bottom, line numbers for the top part haven't changed.
lines.splice(313, 439 - 313 + 1);

// 3. Add import at the top
lines.splice(10, 0, "import ChatbotManagerView from './dashboard-views/ChatbotManagerView';");

fs.writeFileSync('src/components/DashboardClient.tsx', lines.join('\n'));
console.log('DashboardClient.tsx updated.');
