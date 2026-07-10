const fs = require('fs');
let file = fs.readFileSync('src/components/DashboardClient.tsx', 'utf8');
file = file.replace("          {activeTab === 'chatbots' && (\r\n          {activeTab === 'chatbots' && <ChatbotManagerView />}", "          {activeTab === 'chatbots' && <ChatbotManagerView />}");
file = file.replace("          {activeTab === 'chatbots' && (\n          {activeTab === 'chatbots' && <ChatbotManagerView />}", "          {activeTab === 'chatbots' && <ChatbotManagerView />}");
fs.writeFileSync('src/components/DashboardClient.tsx', file);
