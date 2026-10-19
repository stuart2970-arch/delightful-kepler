import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      env[key] = val;
    }
  }
  return env;
}

async function checkJira() {
  const env = loadEnv();
  const baseUrl = env.JIRA_BASE_URL || process.env.JIRA_BASE_URL;
  const email = env.JIRA_EMAIL || process.env.JIRA_EMAIL;
  const token = env.JIRA_API_TOKEN || process.env.JIRA_API_TOKEN;

  if (!baseUrl || !email || !token) {
    console.error('Missing Jira credentials in .env.local');
    process.exit(1);
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const jql = `labels = antigravity AND status in ('In Progress', 'in-progress')`;
  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=id,key,summary,status,description,priority,assignee,labels`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Jira API error (${res.status}): ${text}`);
      process.exit(1);
    }

    const data = await res.json();
    const issues = data.issues || [];

    if (issues.length === 0) {
      console.log('NO_TASKS_FOUND: No tickets matching `status in ("In Progress", "in-progress") AND labels = "antigravity"`');
      return;
    }

    console.log(`FOUND_${issues.length}_TASKS:`);
    for (const issue of issues) {
      console.log(JSON.stringify({
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status?.name,
        assignee: issue.fields.assignee?.displayName || 'Unassigned',
        labels: issue.fields.labels,
      }, null, 2));
    }
  } catch (err) {
    console.error('Failed to query Jira:', err);
    process.exit(1);
  }
}

checkJira();
