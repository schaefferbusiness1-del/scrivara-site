'use strict';

/* A file with merge-conflict markers in it is not a degraded page - it is a
 * SYNTAX ERROR served to users.
 *
 * This actually happened: commit 6ea5677, "HOTFIX: merge-conflict markers were
 * committed into a live .js file and served". Four lanes ship through this repo
 * and rebase around each other constantly; a botched conflict resolution is a
 * matter of when, not if. Nothing in the 311-suite gate looked for it, so the
 * only thing standing between `<<<<<<< HEAD` and production was somebody
 * noticing.
 *
 * The failure mode is maximally bad and maximally cheap to prevent:
 *   - a JS file with conflict markers throws on parse, so EVERY module after it
 *     in the load order never runs
 *   - an HTML file renders the markers as visible text to the user
 *   - it costs one string scan to catch
 *
 * Scope is deliberately the SHIPPED surface: root-level .js and .html. Tests
 * and node_modules are excluded (a fixture may legitimately contain a marker
 * string), and so is this file, which necessarily names the markers. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

/* Built as fragments so this file cannot flag itself. */
const MARKERS = [
  { re: new RegExp('^' + '<'.repeat(7) + ' ', 'm'), name: '<<<<<<< (ours)' },
  { re: new RegExp('^' + '='.repeat(7) + '$', 'm'), name: '======= (divider)' },
  { re: new RegExp('^' + '>'.repeat(7) + ' ', 'm'), name: '>>>>>>> (theirs)' }
];

const SKIP_DIRS = new Set(['node_modules', 'tests', '.git', 'RETIRED_HTML', 'dispatch-work', 'scratchpad']);

function shippedFiles() {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) continue; continue; }
    if (!/\.(js|html)$/i.test(entry.name)) continue;
    out.push(entry.name);
  }
  return out.sort();
}

const files = shippedFiles();
assert(files.length > 50,
  'expected the shipped root surface to hold well over 50 .js/.html files, found ' + files.length +
  ' - the scan is looking in the wrong place and would pass vacuously');

const hits = [];
for (const rel of files) {
  let src;
  try { src = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (e) { continue; }
  for (const m of MARKERS) {
    const found = m.re.exec(src);
    if (found) {
      const line = src.slice(0, found.index).split('\n').length;
      hits.push(rel + ':' + line + '  ' + m.name);
    }
  }
}

assert.strictEqual(hits.length, 0,
  'MERGE CONFLICT MARKERS ARE IN SHIPPED FILES - this would be served to users:\n  ' +
  hits.join('\n  ') + '\n\n' +
  'A .js file with these markers throws on parse, so every module after it in the load order never\n' +
  'runs; a .html file renders them as visible text. Resolve the conflict properly - do NOT delete the\n' +
  'markers without checking which side was meant to survive. This is exactly the incident 6ea5677\n' +
  'hotfixed after it reached production.');

console.log('PASS no merge-conflict markers in ' + files.length + ' shipped root .js/.html files');
