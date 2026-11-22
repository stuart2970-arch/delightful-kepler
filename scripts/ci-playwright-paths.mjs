#!/usr/bin/env node
/**
 * Map PR file changes to Playwright CI areas (staging path filter).
 * Release PRs into main always run every area (set PLAYWRIGHT_CI_FORCE_ALL=1).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  CI_PLAYWRIGHT_GROUPS,
  testPathsForGroup,
} from './ci-playwright-groups.mjs';

/**
 * @param {string} file
 * @param {string} pattern
 */
function globMatch(file, pattern) {
  const re = pattern
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§GLOBSTAR§')
    .replace(/\*/g, '[^/]*')
    .replace(/§GLOBSTAR§/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${re}$`).test(file.replace(/\\/g, '/'));
}

const root = join(import.meta.dirname, '..');
const configPath = join(root, '.github/playwright-area-paths.json');

/** @type {{ shared: string[], areas: Record<string, string[]> }} */
const config = JSON.parse(readFileSync(configPath, 'utf8'));

const AREA_IDS = CI_PLAYWRIGHT_GROUPS.map((g) => g.id);

/**
 * @param {string} changedPath
 * @param {string[]} patterns
 */
function matchesAny(changedPath, patterns) {
  const normalised = changedPath.replace(/\\/g, '/');
  return patterns.some((pattern) => globMatch(normalised, pattern));
}

/**
 * @param {string} areaId
 * @returns {string[]}
 */
export function patternsForArea(areaId) {
  const src = config.areas[areaId] ?? [];
  const specs = testPathsForGroup(areaId);
  return [...src, ...specs];
}

/**
 * @param {string[]} changedFiles
 * @param {{ baseRef?: string, forceAll?: boolean }} options
 */
export function resolveAreasToRun(changedFiles, options = {}) {
  const forceAll = options.forceAll === true;
  if (forceAll) {
    const all = new Set(AREA_IDS);
    return { forceAll: true, areas: all, uncovered: [] };
  }

  const normalized = changedFiles.map((f) => f.replace(/\\/g, '/').trim()).filter(Boolean);
  if (normalized.length === 0) {
    return { forceAll: true, areas: new Set(AREA_IDS), uncovered: [] };
  }

  for (const file of normalized) {
    if (matchesAny(file, config.shared)) {
      return { forceAll: true, areas: new Set(AREA_IDS), uncovered: [] };
    }
  }

  /** @type {Set<string>} */
  const areas = new Set();
  /** @type {string[]} */
  const uncovered = [];

  for (const file of normalized) {
    let matched = false;
    for (const areaId of AREA_IDS) {
      if (matchesAny(file, patternsForArea(areaId))) {
        areas.add(areaId);
        matched = true;
      }
    }
    if (!matched) {
      uncovered.push(file);
    }
  }

  if (uncovered.length > 0) {
    return { forceAll: true, areas: new Set(AREA_IDS), uncovered };
  }

  return { forceAll: false, areas, uncovered: [] };
}

function gitChangedFiles(baseSha, headSha) {
  if (!baseSha || !headSha) {
    return [];
  }
  const out = execSync(`git diff --name-only ${baseSha} ${headSha}`, {
    cwd: root,
    encoding: 'utf8',
  });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function emitGithubOutputs(resolution) {
  const lines = [];
  lines.push(`force_all=${resolution.forceAll ? 'true' : 'false'}`);
  for (const areaId of AREA_IDS) {
    const key = areaId.replace(/-/g, '_');
    const run = resolution.forceAll || resolution.areas.has(areaId);
    lines.push(`area_${key}=${run ? 'true' : 'false'}`);
  }
  if (resolution.uncovered.length > 0) {
    lines.push(`uncovered=${resolution.uncovered.join(',')}`);
  } else {
    lines.push('uncovered=');
  }
  return lines.join('\n');
}

function isMain() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return import.meta.url === pathToFileURL(argv1).href;
}

if (isMain()) {
  const mode = process.argv[2] || 'github-output';
  const baseSha = process.env.BASE_SHA || process.argv[3];
  const headSha = process.env.HEAD_SHA || process.argv[4];
  const baseBranch = process.env.BASE_BRANCH || '';
  const forceAllEnv = process.env.PLAYWRIGHT_CI_FORCE_ALL === '1'
    || baseBranch === 'main';

  if (mode === 'github-output') {
    const changed = gitChangedFiles(baseSha, headSha);
    const resolution = resolveAreasToRun(changed, { forceAll: forceAllEnv });
    process.stdout.write(`${emitGithubOutputs(resolution)}\n`);
    process.exit(0);
  }

  if (mode === 'print') {
    const files = process.argv.slice(3);
    const resolution = resolveAreasToRun(files, { forceAll: forceAllEnv });
    console.log(JSON.stringify({
      forceAll: resolution.forceAll,
      areas: [...resolution.areas],
      uncovered: resolution.uncovered,
    }, null, 2));
    process.exit(0);
  }

  console.error('Usage: ci-playwright-paths.mjs [github-output|print]');
  process.exit(2);
}