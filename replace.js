const fs = require('fs');

let content = fs.readFileSync('src/components/DashboardClient.tsx', 'utf-8');

// 1. Remove global settings state
content = content.replace(/  \/\/ Global settings state[\s\S]*?const \[isSavingDisclaimer, setIsSavingDisclaimer\] = useState\(false\);\s*/g, '');
content = content.replace(/  const \[globalBrandingHtml, setGlobalBrandingHtml\][\s\S]*?setIsSavingGlobal\] = useState\(false\);\s*/g, '');

// 2. Update useEffect
content = content.replace(/  \/\/ Auto-select first real chatbot for crawler if available, and load global settings\s*useEffect\(\(\) => \{\s*const realBots = chatbots\.filter\(b => b\.id !== globalBotId\);\s*const globalBot = chatbots\.find\(b => b\.id === globalBotId\);[\s\S]*?  \}, \[chatbots\]\);/g, '  // Auto-select first real chatbot for crawler if available\n  useEffect(() => {\n    const realBots = chatbots.filter(b => b.id !== globalBotId);\n  }, [chatbots]);');

// 3. Remove handlers
content = content.replace(/  const handleSaveBranding = async.*?alert\('Failed to save global disclaimer.*?\}\s*\n    \} finally \{\s*\n      setIsSavingGlobal\(false\);\s*\n    \}\s*\n  \};\s*/sg, '');

// 4. Remove UI block
content = content.replace(/          \{\/\* Platform Settings Tab \*\/\}.*?activeTab === 'settings' && !isImpersonating && \(\s*<div className="space-y-6">[\s\S]*?          \)\}\s*/sg, '');

fs.writeFileSync('src/components/DashboardClient.tsx', content, 'utf-8');
