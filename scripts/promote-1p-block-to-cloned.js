#!/usr/bin/env node
'use strict';
/*
 * Promote ONE proven /1p feature block into the /cloned lane.
 *
 *   node scripts/promote-1p-block-to-cloned.js --block msl-1.0.0 [--note "why"] [--dry]
 *   node scripts/promote-1p-block-to-cloned.js --demote msl-1.0.0
 *
 * Owner's pipeline (2026-08-17): build on /1p → TEST on /1p → everything that
 * works is added to /cloned → what does not work is fixed until it can be →
 * when /cloned is perfect it becomes main. This is the "add to cloned" step,
 * kept deliberately plain: a /1p feature is a DELIMITED BLOCK in
 * 1pScribeFlow.html —
 *     <!-- ===== <name> ... -->      …      <!-- ===== end <name> ... -->
 * — and promotion is a byte copy of that block into cloned/index.html at the
 * same neighbourhood, plus one entry in tests/cloned-promotions.json that
 * tests/cloned-lane-contract.test.js reads: it asserts the block is present
 * exactly once, its sha256 matches what was promoted, and canonicalizes it
 * away so the rest of the clone still byte-compares to production.
 *
 * Refuses: a block that is not exactly once in the source, that references
 * anything /1p-only (__MLS_P1_PREVIEW, 1p-feat_*.js, 1p-mls-connect.js, /1p
 * routes), or whose neighbourhood cannot be located uniquely in the clone.
 * Nested blocks travel with their parent (msl-today rides inside msl-1.0.0).
 * Blocks whose feature also needs a shared feat_*.js fork are NOT handled
 * here — that is a cloned-feat_*.js fork + loader repoint + publication
 * registration, done by hand and asserted by hand.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : ''; };
const dry = args.includes('--dry');
const blockName = opt('--block');
const demoteName = opt('--demote');
const note = opt('--note') || '';
const SOURCE = '1pScribeFlow.html';
const TARGET = 'cloned/index.html';
const MANIFEST = 'tests/cloned-promotions.json';
const read = (n) => fs.readFileSync(path.join(root, n), 'utf8');
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const P1_ONLY = ['__MLS_P1_PREVIEW', '1p-feat_', '1p-mls-connect', "'/1p", '"/1p', 'p1-live-1.0.0', 'window.__MLS_P1'];

function loadManifest() {
  try { return JSON.parse(read(MANIFEST)); } catch (e) { return { promoted: [] }; }
}
function saveManifest(m) {
  fs.writeFileSync(path.join(root, MANIFEST), JSON.stringify(m, null, 2) + '\n', 'utf8');
}
function locateBlock(text, name) {
  const open = `<!-- ===== ${name} `;
  const close = `<!-- ===== end ${name} `;
  const nOpen = text.split(open).length - 1, nClose = text.split(close).length - 1;
  if (nOpen !== 1 || nClose !== 1) throw new Error(`block ${name}: open×${nOpen} close×${nClose} (need exactly 1 each)`);
  const start = text.indexOf(open);
  const closeIdx = text.indexOf(close);
  if (closeIdx < start) throw new Error(`block ${name}: close marker precedes open marker`);
  const closeLineEnd = text.indexOf('\n', closeIdx);
  const end = closeLineEnd < 0 ? text.length : closeLineEnd + 1; // include the newline that ends the close-marker line
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  if (text.slice(lineStart, start).trim() !== '') throw new Error(`block ${name}: open marker must start its line`);
  return { start: lineStart, end, text: text.slice(lineStart, end), open, close };
}

if (demoteName) {
  const m = loadManifest();
  const entry = m.promoted.find((p) => p.name === demoteName);
  if (!entry) throw new Error(`not promoted: ${demoteName}`);
  const cloned = read(TARGET);
  const loc = locateBlock(cloned, demoteName);
  if (sha(loc.text) !== entry.sha256) throw new Error(`clone's ${demoteName} block does not match the promoted sha — hand-check before demoting`);
  const out = cloned.slice(0, loc.start) + cloned.slice(loc.end);
  m.promoted = m.promoted.filter((p) => p.name !== demoteName);
  if (dry) { console.log(`DRY: would remove ${loc.text.length} bytes (${demoteName}) from ${TARGET}`); process.exit(0); }
  fs.writeFileSync(path.join(root, TARGET), out, 'utf8');
  saveManifest(m);
  console.log(`demoted ${demoteName}: removed ${loc.text.length} bytes from ${TARGET}; manifest now ${m.promoted.length} promotion(s)`);
  process.exit(0);
}

if (!blockName) { console.error('usage: --block <name> [--note "..."] [--dry] | --demote <name>'); process.exit(2); }

const src = read(SOURCE);
const cloned = read(TARGET);
const loc = locateBlock(src, blockName);
for (const bad of P1_ONLY) {
  if (loc.text.indexOf(bad) >= 0) throw new Error(`block ${blockName} references a /1p-only thing (${JSON.stringify(bad)}) — make it lane-neutral on /1p first`);
}
if (cloned.indexOf(loc.open) >= 0) throw new Error(`clone already carries a ${blockName} open marker — demote first or pick a new version name`);

/* Neighbourhood: prefer the text that FOLLOWS the block in the source (so
   chained end-of-body blocks keep their order), else what precedes it. Both
   must be unique in the clone. */
const CTX = 240;
const following = src.slice(loc.end, loc.end + CTX);
const preceding = src.slice(Math.max(0, loc.start - CTX), loc.start);
let insertAt = -1, how = '';
if (following && cloned.split(following).length - 1 === 1) { insertAt = cloned.indexOf(following); how = 'before the same following context'; }
else if (preceding && cloned.split(preceding).length - 1 === 1) { insertAt = cloned.indexOf(preceding) + preceding.length; how = 'after the same preceding context'; }
if (insertAt < 0) throw new Error(`could not locate a unique neighbourhood for ${blockName} in ${TARGET}; promote its predecessor block first, or place by hand and add the manifest entry`);

const out = cloned.slice(0, insertAt) + loc.text + cloned.slice(insertAt);
const entry = {
  name: blockName,
  kind: 'block',
  open: loc.open.trimEnd(),
  close: loc.close.trimEnd(),
  sha256: sha(loc.text),
  bytes: loc.text.length,
  from: SOURCE,
  promotedAt: new Date().toISOString().slice(0, 10),
  note
};
if (dry) {
  console.log(`DRY: would insert ${loc.text.length} bytes of ${blockName} into ${TARGET} ${how} at offset ${insertAt}; sha256 ${entry.sha256.slice(0, 12)}…`);
  process.exit(0);
}
fs.writeFileSync(path.join(root, TARGET), out, 'utf8');
const m = loadManifest();
m.promoted.push(entry);
saveManifest(m);
console.log(`promoted ${blockName}: ${loc.text.length} bytes into ${TARGET} ${how}; manifest now ${m.promoted.length} promotion(s). Next: node tests/cloned-lane-contract.test.js, then the full gate.`);
