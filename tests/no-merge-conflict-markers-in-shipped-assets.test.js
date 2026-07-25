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
 * Scope is the SHIPPED surface: root-level .js/.html PLUS every parse-critical
 * asset named in pages-publication-inventory.json (vendor/*.js, *.mjs, *.json,
 * *.css, subdirectories). Tests
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

/* Root-level .js/.html — the original scope. The directory branch here used to
   read `if (entry.isDirectory()) { if (!SKIP.has(entry.name)) continue; continue; }`
   where BOTH arms continue, so the skip-list did nothing and no subdirectory was
   ever visited. It read as covered-except-the-skipped-ones; it scanned root only.
   The skip-list is gone rather than fixed — subdirectory coverage now comes from
   the publication inventory below, which is the authoritative list of what ships. */
function rootFiles() {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (!/\.(js|html)$/i.test(entry.name)) continue;
    out.push(entry.name);
  }
  return out.sort();
}

/* Plus every parse-critical asset the publication inventory actually ships that
   the root scan cannot see. A marker in any of these is equally fatal:
     vendor/*.js, *.mjs   throw on parse, same as a root script
     *.json               JSON.parse throws — and app-version.json /
                          extension-version.json drive the update checker
     *.css                the rule breaks, silently
   Seven of these live in subdirectories (fonts/, vendor/) and four .json sit at
   root under an extension the old filter did not match, so eleven shipped
   parse-critical files were outside the gate that was written to prevent
   exactly this outage. */
function inventoryFiles() {
  let inv;
  try { inv = JSON.parse(fs.readFileSync(path.join(root, 'pages-publication-inventory.json'), 'utf8')); }
  catch (e) { return []; }
  const out = new Set();
  for (const v of Object.values(inv)) {
    if (!Array.isArray(v)) continue;
    for (const f of v) {
      if (typeof f !== 'string') continue;
      if (!/\.(js|mjs|json|css|html)$/i.test(f)) continue;
      if (!fs.existsSync(path.join(root, f))) continue;
      out.add(f);
    }
  }
  return [...out];
}

const files = [...new Set([...rootFiles(), ...inventoryFiles()])].sort();
assert(files.length > 50,
  'expected the shipped surface to hold well over 50 parse-critical files, found ' + files.length +
  ' - the scan is looking in the wrong place and would pass vacuously');

/* The gate must actually reach beyond the root, or it silently narrows again. */
const subdir = files.filter(f => f.includes('/'));
assert(subdir.length >= 7,
  'expected at least 7 shipped parse-critical files in subdirectories (fonts/, vendor/), found ' +
  subdir.length + ' - the inventory scan has stopped resolving them');
const json = files.filter(f => /\.json$/i.test(f));
assert(json.length >= 4,
  'expected the shipped .json files to be covered (a conflict marker makes JSON.parse throw, and ' +
  'app-version.json drives the update checker), found ' + json.length);

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

console.log('PASS no merge-conflict markers in ' + files.length + ' shipped parse-critical files (' +
  subdir.length + ' in subdirectories, ' + json.length + ' .json) — a marker in any of these throws on parse');
