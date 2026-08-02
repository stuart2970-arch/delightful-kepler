const fs = require('fs');
const path = require('path');

const targetFiles = [
  ...fs.readdirSync(path.join(__dirname, '../src/components/dashboard-views')).map(f => path.join(__dirname, '../src/components/dashboard-views', f)),
  path.join(__dirname, '../src/components/ServiceEditor.tsx'),
  path.join(__dirname, '../src/components/DashboardClient.tsx'),
  path.join(__dirname, '../src/components/dashboard-views/SidebarNavigation.tsx')
].filter(f => f.endsWith('.tsx'));

targetFiles.forEach(filePath => {
  let content = fs.readFileSync(filePath, 'utf8');

  // Fix button text contrast where blue background had dark text
  content = content.replace(/bg-\[var\(--awb-color5\)\]\s+text-\[var\(--awb-color8\)\]/g, 'bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px]');
  content = content.replace(/bg-\[var\(--awb-color5\)\]/g, 'bg-[#198fd9] text-white');
  content = content.replace(/hover:bg-\[var\(--awb-color5\)\]/g, 'hover:bg-[#157ab8]');

  // Fix dark leftover containers & badges
  content = content.replace(/bg-emerald-950/g, 'bg-emerald-50 border-emerald-300 text-emerald-900');
  content = content.replace(/bg-yellow-950/g, 'bg-amber-50 border-amber-300 text-amber-900');
  content = content.replace(/bg-indigo-950\/[0-9]+/g, 'bg-blue-50 border border-blue-200');
  content = content.replace(/bg-amber-950\/[0-9]+/g, 'bg-amber-50 border border-amber-200');

  // Fix low contrast text colors
  content = content.replace(/text-indigo-200/g, 'text-[#434549]');
  content = content.replace(/text-indigo-300/g, 'text-[#198fd9]');
  content = content.replace(/text-amber-200/g, 'text-amber-900');
  content = content.replace(/text-amber-300\/80/g, 'text-amber-800');
  content = content.replace(/text-amber-400/g, 'text-amber-900');
  content = content.replace(/text-emerald-400/g, 'text-emerald-800');
  content = content.replace(/text-yellow-400/g, 'text-amber-900');

  // Ensure card backgrounds are clean white
  content = content.replace(/bg-\[var\(--awb-color1\)\] text-\[var\(--awb-color8\)\] border-\[var\(--awb-color3\)\] border border-\[var\(--awb-color3\)\]/g, 'bg-white border border-[#f2f3f5]');

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Refined theme for ${path.basename(filePath)}`);
});
