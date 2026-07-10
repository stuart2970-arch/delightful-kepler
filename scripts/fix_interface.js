const fs = require('fs');
let file = fs.readFileSync('src/components/DashboardClient.tsx', 'utf8');
const toReplace = `import ChatbotManagerView from './dashboard-views/ChatbotManagerView';
    agent_role?: string;`;
const replacement = `import ChatbotManagerView from './dashboard-views/ChatbotManagerView';

export interface Chatbot {
  id: string;
  name: string;
  primary_color: string;
  configuration_json: {
    welcome_message?: string;
    suggested_prompts?: string[];
    agent_name?: string;
    agent_role?: string;`;
file = file.replace(toReplace, replacement);
fs.writeFileSync('src/components/DashboardClient.tsx', file);
