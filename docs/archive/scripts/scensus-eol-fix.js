#!/usr/bin/env node
'use strict';
/* scensus-1.0.1 EOL repair (Codex blocker 3 on 10f41d2d). The scensus-1.0.0
 * splice normalized every inserted newline to CRLF, but the AllVisits census
 * region of mixed-EOL background.js is an LF region - so the multi-line
 * insertions landed as CRLF lines inside LF context and `git diff --check`
 * flags each stray CR as trailing whitespace. No line has real trailing
 * spaces (measured: 0). This script re-reads the exact newStr literals out
 * of scripts/scensus-splice.js and replaces each block's CRLF form with its
 * LF form. Each target must occur exactly once or it refuses and writes
 * nothing. */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'background.js');
const spliceSrc = fs.readFileSync(path.join(__dirname, 'scensus-splice.js'), 'utf8');
let t = fs.readFileSync(file, 'latin1');

/* pull every template-literal argument pair out of the splice script; the
 * second literal of each pair is the newStr that landed in background.js */
const calls = [...spliceSrc.matchAll(/splice\('([^']+)',\s*`([\s\S]*?)`,\s*`([\s\S]*?)`\);/g)];
if (calls.length !== 5) throw new Error('expected the 5 scensus splices, found ' + calls.length);

let fixed = 0;
for (const [, label, , newStr] of calls) {
  if (!newStr.includes('\n')) { console.log('skip', label, '- single-line, no EOL introduced'); continue; }
  const crlfForm = newStr.replace(/\n/g, '\r\n');
  const first = t.indexOf(crlfForm);
  if (first < 0) { console.log('skip', label, '- CRLF form absent (already repaired?)'); continue; }
  if (t.indexOf(crlfForm, first + 1) >= 0) throw new Error(label + ': CRLF form not unique');
  t = t.slice(0, first) + newStr + t.slice(first + crlfForm.length);
  fixed += (crlfForm.match(/\r\n/g) || []).length;
  console.log('repaired', label);
}
if (fixed === 0) throw new Error('nothing repaired - already clean or the splice literals drifted');
fs.writeFileSync(file, t, 'latin1');
console.log('background.js EOL-repaired;', fixed, 'newlines; bytes now', t.length);
