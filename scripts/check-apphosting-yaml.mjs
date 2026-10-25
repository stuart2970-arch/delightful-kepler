#!/usr/bin/env node
/**
 * STYL-203: Validate apphosting.yaml / apphosting.*.yaml against the documented
 * Firebase App Hosting schema (offline — no firebase CLI / network).
 *
 * Docs: https://firebase.google.com/docs/app-hosting/configure#apphosting-yaml
 *
 * Catches the class of failure seen on build 4c860af7:
 *   "Your apphosting.yaml file … is not formatted properly"
 * including empty `value: ""` (explicitly rejected by App Hosting).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/** @type {typeof import('js-yaml')} */
const yaml = require('js-yaml');

const root = process.cwd();

const ALLOWED_TOP_LEVEL = new Set([
  'runConfig',
  'env',
  'scripts',
  'outputFiles',
]);

const ALLOWED_RUN_CONFIG = new Set([
  'cpu',
  'memoryMiB',
  'concurrency',
  'minInstances',
  'maxInstances',
  'cpuAlwaysAllocated',
  'vpcAccess',
]);

const ALLOWED_ENV_KEYS = new Set(['variable', 'value', 'secret', 'availability']);
const ALLOWED_AVAILABILITY = new Set(['BUILD', 'RUNTIME']);

const RESERVED_ENV_NAMES = new Set([
  'PORT',
  'K_SERVICE',
  'K_REVISION',
  'K_CONFIGURATION',
]);

function listApphostingFiles() {
  const names = readdirSync(root).filter(
    (n) => n === 'apphosting.yaml' || /^apphosting\.[^.]+\.yaml$/.test(n),
  );
  return names.map((n) => join(root, n)).sort();
}

/**
 * @param {string} filePath
 * @returns {string[]}
 */
function validateFile(filePath) {
  const errors = [];
  const label = basename(filePath);
  let doc;

  try {
    doc = yaml.load(readFileSync(filePath, 'utf8'), { schema: yaml.DEFAULT_SCHEMA });
  } catch (e) {
    return [`${label}: invalid YAML — ${e instanceof Error ? e.message : String(e)}`];
  }

  if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) {
    return [`${label}: root must be a mapping (got ${doc === null ? 'null' : typeof doc})`];
  }

  for (const key of Object.keys(doc)) {
    if (!ALLOWED_TOP_LEVEL.has(key)) {
      errors.push(`${label}: unsupported top-level key "${key}"`);
    }
  }

  if ('runConfig' in doc) {
    const rc = doc.runConfig;
    if (rc == null || typeof rc !== 'object' || Array.isArray(rc)) {
      errors.push(`${label}: runConfig must be a mapping`);
    } else {
      for (const key of Object.keys(rc)) {
        if (!ALLOWED_RUN_CONFIG.has(key)) {
          errors.push(`${label}: unsupported runConfig.${key}`);
        }
      }
      for (const numKey of ['cpu', 'memoryMiB', 'concurrency', 'minInstances', 'maxInstances']) {
        if (numKey in rc && typeof rc[numKey] !== 'number') {
          errors.push(`${label}: runConfig.${numKey} must be a number`);
        }
      }
      if (
        'cpuAlwaysAllocated' in rc &&
        typeof rc.cpuAlwaysAllocated !== 'boolean'
      ) {
        errors.push(`${label}: runConfig.cpuAlwaysAllocated must be a boolean`);
      }
    }
  }

  if ('env' in doc) {
    const env = doc.env;
    if (!Array.isArray(env)) {
      errors.push(`${label}: env must be a list`);
    } else {
      const seen = new Set();
      env.forEach((entry, i) => {
        const prefix = `${label}: env[${i}]`;
        if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
          errors.push(`${prefix}: must be a mapping`);
          return;
        }
        for (const key of Object.keys(entry)) {
          if (!ALLOWED_ENV_KEYS.has(key)) {
            errors.push(`${prefix}: unsupported key "${key}"`);
          }
        }
        if (typeof entry.variable !== 'string' || !entry.variable.trim()) {
          errors.push(`${prefix}: "variable" must be a non-empty string`);
        } else {
          const name = entry.variable;
          if (seen.has(name)) {
            errors.push(`${label}: duplicate env variable "${name}"`);
          }
          seen.add(name);
          if (RESERVED_ENV_NAMES.has(name)) {
            errors.push(`${prefix}: reserved variable name "${name}"`);
          }
          if (name.includes('=')) {
            errors.push(`${prefix}: variable name must not contain "="`);
          }
          if (
            name.startsWith('X_FIREBASE_') ||
            name.startsWith('X_GOOGLE_') ||
            name.startsWith('CLOUD_RUN_')
          ) {
            errors.push(`${prefix}: variable name uses a reserved prefix`);
          }
        }

        const hasValue = Object.prototype.hasOwnProperty.call(entry, 'value');
        const hasSecret = Object.prototype.hasOwnProperty.call(entry, 'secret');
        if (hasValue === hasSecret) {
          errors.push(
            `${prefix}: must set exactly one of "value" or "secret" (not both, not neither)`,
          );
        }
        if (hasValue) {
          if (typeof entry.value !== 'string') {
            errors.push(
              `${prefix}: "value" must be a string (got ${typeof entry.value})`,
            );
          } else if (entry.value === '') {
            // App Hosting rejects empty strings — build 4c860af7.
            errors.push(
              `${prefix}: "value" must not be an empty string (omit the variable instead)`,
            );
          }
        }
        if (hasSecret) {
          if (typeof entry.secret !== 'string' || !entry.secret.trim()) {
            errors.push(`${prefix}: "secret" must be a non-empty string`);
          }
        }
        if ('availability' in entry) {
          const avail = entry.availability;
          if (!Array.isArray(avail) || avail.length === 0) {
            errors.push(`${prefix}: availability must be a non-empty list`);
          } else {
            for (const a of avail) {
              if (!ALLOWED_AVAILABILITY.has(a)) {
                errors.push(
                  `${prefix}: availability entry must be BUILD or RUNTIME (got ${JSON.stringify(a)})`,
                );
              }
            }
          }
        }
      });
    }
  }

  if ('scripts' in doc) {
    const scripts = doc.scripts;
    if (scripts == null || typeof scripts !== 'object' || Array.isArray(scripts)) {
      errors.push(`${label}: scripts must be a mapping`);
    } else {
      for (const key of Object.keys(scripts)) {
        if (key !== 'buildCommand' && key !== 'runCommand') {
          errors.push(`${label}: unsupported scripts.${key}`);
        } else if (typeof scripts[key] !== 'string' || !scripts[key].trim()) {
          errors.push(`${label}: scripts.${key} must be a non-empty string`);
        }
      }
    }
  }

  if ('outputFiles' in doc) {
    const of = doc.outputFiles;
    if (of == null || typeof of !== 'object' || Array.isArray(of)) {
      errors.push(`${label}: outputFiles must be a mapping`);
    }
  }

  return errors;
}

const files = listApphostingFiles();
if (files.length === 0) {
  console.error('[STYL-203] No apphosting.yaml files found at repo root.');
  process.exit(1);
}

const missingBase = !existsSync(join(root, 'apphosting.yaml'));
if (missingBase) {
  console.error('[STYL-203] apphosting.yaml is required at repo root.');
  process.exit(1);
}

const allErrors = files.flatMap(validateFile);
if (allErrors.length) {
  console.error('[STYL-203] apphosting*.yaml schema validation failed:');
  for (const e of allErrors) console.error(`  - ${e}`);
  console.error(
    'See https://firebase.google.com/docs/app-hosting/configure#apphosting-yaml',
  );
  process.exit(1);
}

console.log(
  `[STYL-203] apphosting*.yaml OK (${files.map((f) => basename(f)).join(', ')})`,
);
process.exit(0);
