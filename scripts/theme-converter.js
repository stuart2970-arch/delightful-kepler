const fs = require('fs');
const path = require('path');

const targetFiles = [
  ...fs.readdirSync(path.join(__dirname, '../src/components/dashboard-views')).map(f => path.join(__dirname, '../src/components/dashboard-views', f)),
  path.join(__dirname, '../src/components/ServiceEditor.tsx')
].filter(f => f.endsWith('.tsx'));

targetFiles.forEach(filePath => {
  let content = fs.readFileSync(filePath, 'utf8');

  // Perform conversions
  content = content.replace(/bg-gray-950\/[0-9]+/g, 'bg-[var(--awb-color2)]');
  content = content.replace(/bg-gray-900\/[0-9]+/g, 'bg-[var(--awb-color1)]');
  content = content.replace(/bg-gray-950/g, 'bg-[var(--awb-color1)] text-[var(--awb-color8)] border-[var(--awb-color3)]');
  content = content.replace(/bg-gray-900/g, 'bg-[var(--awb-color1)]');
  content = content.replace(/bg-gray-800\/[0-9]+/g, 'bg-[var(--awb-color2)]');
  content = content.replace(/bg-gray-800/g, 'bg-[var(--awb-color2)] text-[var(--awb-color8)]');
  
  content = content.replace(/border-gray-950\/[0-9]+/g, 'border-[var(--awb-color3)]');
  content = content.replace(/border-gray-950/g, 'border-[var(--awb-color3)]');
  content = content.replace(/border-gray-900/g, 'border-[var(--awb-color3)]');
  content = content.replace(/border-gray-800\/[0-9]+/g, 'border-[var(--awb-color3)]');
  content = content.replace(/border-gray-800/g, 'border-[var(--awb-color3)]');
  content = content.replace(/border-gray-700/g, 'border-[var(--awb-color3)]');
  
  content = content.replace(/text-white/g, 'text-[var(--awb-color8)]');
  content = content.replace(/text-gray-300/g, 'text-[var(--awb-color7)]');
  content = content.replace(/text-gray-400/g, 'text-[var(--awb-color6)]');
  content = content.replace(/text-gray-500/g, 'text-[var(--awb-color6)]');

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated ${path.basename(filePath)} to Light Theme.`);
});
