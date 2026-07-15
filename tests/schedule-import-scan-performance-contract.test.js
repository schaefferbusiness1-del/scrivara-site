'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

function balancedFunctionAt(text, functionStart) {
  const brace = text.indexOf('{', functionStart);
  assert(brace >= 0, 'schedule-import callback has no body');
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = brace; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(functionStart, i + 1);
  }
  throw new Error('unterminated schedule-import callback');
}

function importCallback(text) {
  const candidates = [];
  const callbackPattern = /\.then\s*\(\s*(async\s+)?function\s*\([^)]*\)/g;
  let match;
  while ((match = callbackPattern.exec(text))) {
    const functionStart = match.index + match[0].indexOf(match[1] ? 'async' : 'function');
    const block = balancedFunctionAt(text, functionStart);
    if (block.includes('calendar-read-unverified') && block.includes('backendRowId(')) {
      candidates.push({ header: match[0], block });
    }
  }
  assert.strictEqual(candidates.length, 1, 'could not uniquely identify the verified calendar-import callback');
  return candidates[0];
}

function archiveScan(callback) {
  const start = callback.indexOf('backendRowId(');
  const end = callback.indexOf('var created', start);
  assert(start >= 0 && end > start, 'could not isolate the backend appointment archive scan');
  return callback.slice(start, end);
}

function hasExactPatientCache(text, scan) {
  const objectLookup = scan.match(/\b([A-Za-z_$][\w$]*)\s*\[\s*String\s*\([^;\n]*patient_external_id[^;\n]*\)\s*\]/);
  const mapLookup = scan.match(/\b([A-Za-z_$][\w$]*)\.get\s*\(\s*String\s*\([^;\n]*patient_external_id[^;\n]*\)\s*\)/);
  const cacheName = (objectLookup || mapLookup || [])[1];
  if (!cacheName) return false;

  const escaped = cacheName.replace(/[$]/g, '\\$&');
  const builtFromPatients = new RegExp(`(?:${escaped}\\s*\\[[^\\]]+\\]|${escaped}\\.set\\s*\\()[\\s\\S]{0,160}?=?.*?pts\\s*\\[|pts\\s*\\[[\\s\\S]{0,160}?(?:${escaped}\\s*\\[|${escaped}\\.set\\s*\\()`).test(text);
  const walksPatientsOnce = /for\s*\([^)]*;[^;]*<\s*pts\.length\s*;/.test(text) || /pts\.forEach\s*\(/.test(text);
  return builtFromPatients && walksPatientsOnce;
}

function hasPerDayLedgerCache(scan) {
  const escape = value => value.replace(/[$]/g, '\\$&');
  const objectGuards = [...scan.matchAll(/hasOwnProperty\.call\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)];
  const objectCache = objectGuards.some(match => {
    const cache = escape(match[1]);
    const day = escape(match[2]);
    return new RegExp(`readIndex\\s*\\(\\s*${day}\\s*\\)`).test(scan) &&
      new RegExp(`${cache}\\s*\\[\\s*${day}\\s*\\]`).test(scan) &&
      new RegExp(`${cache}\\s*\\[\\s*${day}\\s*\\]\\s*=`).test(scan);
  });
  const mapGuards = [...scan.matchAll(/\b([A-Za-z_$][\w$]*)\.has\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)];
  const mapCache = mapGuards.some(match => {
    const cache = escape(match[1]);
    const day = escape(match[2]);
    return new RegExp(`readIndex\\s*\\(\\s*${day}\\s*\\)`).test(scan) &&
      new RegExp(`${cache}\\.get\\s*\\(\\s*${day}\\s*\\)`).test(scan) &&
      new RegExp(`${cache}\\.set\\s*\\(\\s*${day}\\s*,`).test(scan);
  });
  return objectCache || mapCache;
}

function hasBoundedYield(scan) {
  const chunk = scan.match(/%\s*(\d+)\s*={2,3}\s*0[\s\S]{0,320}?\bawait\b/);
  if (!chunk) return false;
  const size = Number(chunk[1]);
  /* 2026-07-15: a hidden MLS tab clamps bare setTimeout to ~one tick per
     minute, freezing the import mid-pull. The yield must run through the
     worker-backed deadline scheduler (throttle-immune); a bare main-thread
     timer no longer satisfies this contract. */
  const yieldsToBrowser = /\bawait\b[\s\S]{0,320}?absoluteDeadlines\.arm\s*\(/.test(scan);
  return size >= 16 && size <= 1000 && yieldsToBrowser;
}

function performanceIssues(text) {
  const found = importCallback(text);
  const scan = archiveScan(found.block);
  const issues = [];

  if (!/\.then\s*\(\s*async\s+function\s*\(/.test(found.header)) {
    issues.push('verified calendar-import callback must be async');
  }
  if (/\bpts\s*\.\s*find\s*\(/.test(scan)) {
    issues.push('backend archive scan must not linearly search patients per appointment');
  }
  if (!hasExactPatientCache(text, scan)) {
    issues.push('backend archive scan must use a one-time exact local-patient-id cache');
  }
  if (!hasPerDayLedgerCache(scan)) {
    issues.push('backend archive scan must memoize readIndex by appointment day');
  }
  if (!hasBoundedYield(scan)) {
    issues.push('backend archive scan must yield to the browser between bounded chunks');
  }

  for (const identityCall of [
    'appointmentIdentity(',
    'appointmentSlotIdentity(',
    'appointmentCoreIdentity(',
    'appointmentDayProviderIdentity(',
    'indexExisting('
  ]) {
    if (!scan.includes(identityCall)) issues.push(`archive optimization lost ${identityCall.slice(0, -1)} reconciliation`);
  }
  return issues;
}

const issues = performanceIssues(source);
assert.deepStrictEqual(issues, [], issues.join('; '));

console.log('PASS schedule import archive scan: exact patient/day caches with bounded browser yields');

module.exports = { performanceIssues };
