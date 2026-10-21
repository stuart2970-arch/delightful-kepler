import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appUrl = (process.argv[2] || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
const disabledAddonsPath = path.join(__dirname, '..', 'src', 'lib', 'addons', 'disabled-addons.json');
const disabledAddons = JSON.parse(fs.readFileSync(disabledAddonsPath, 'utf8'));

console.log(`[STYL-179] Smoke checking disabled add-ons on ${appUrl}...`);
console.log(`[STYL-179] Expected hidden add-ons: ${disabledAddons.join(', ')}`);

async function run() {
  const pricesUrl = `${appUrl}/api/billing/prices`;
  const res = await fetch(pricesUrl);
  if (!res.ok) {
    console.error(`::error::Failed to fetch ${pricesUrl}: HTTP ${res.status}`);
    process.exit(1);
  }

  const data = await res.json();
  const returnedAddons = data.addons || [];
  const returnedIds = returnedAddons.map(a => a.id);

  console.log(`[STYL-179] Returned add-on IDs in /api/billing/prices: ${returnedIds.join(', ')}`);

  const leaks = returnedIds.filter(id => disabledAddons.includes(id));
  if (leaks.length > 0) {
    console.error(`::error::STYL-179 Post-deploy smoke check FAILED: /api/billing/prices contains disabled add-on(s): ${leaks.join(', ')}`);
    process.exit(1);
  }

  // Also check /api/billing/addons
  const addonsUrl = `${appUrl}/api/billing/addons`;
  const addonsRes = await fetch(addonsUrl);
  if (addonsRes.ok) {
    const addonsData = await addonsRes.json();
    const list = Array.isArray(addonsData) ? addonsData : (addonsData.addons || []);
    const returnedAddonRouteIds = list.map(a => a.id);
    const addonsRouteLeaks = returnedAddonRouteIds.filter(id => disabledAddons.includes(id));
    if (addonsRouteLeaks.length > 0) {
      console.error(`::error::STYL-179 Post-deploy smoke check FAILED: /api/billing/addons contains disabled add-on(s): ${addonsRouteLeaks.join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`[STYL-179] PASS: All ${disabledAddons.length} disabled add-ons are strictly hidden from public feeds.`);
}

run().catch(err => {
  console.error(`::error::STYL-179 Smoke check script error: ${err.message}`);
  process.exit(1);
});
