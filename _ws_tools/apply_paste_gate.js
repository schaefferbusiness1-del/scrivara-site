/* Second byte-safe edit: Adam-only TEST policy on the generic paste lane.
 * Same latin1 + CR-integrity discipline as apply_background_edits.js.
 * The paste-handler region is CRLF; the inserted block is pure-LF (adds zero
 * CRs), which is valid JS and keeps the CR-count integrity check meaningful. */
'use strict';
const fs = require('fs');
const path = require('path');
const target = path.join(__dirname, '..', 'background.js');
let buf = fs.readFileSync(target, 'latin1');
const beforeBytes = buf.length, beforeCRs = (buf.match(/\r/g) || []).length;
if (buf.includes('MLS_WRITE_SAFETY_PASTE_GATE_START')) { console.error('ALREADY APPLIED'); process.exit(2); }

/* Unique line inside the mlsAppPasteRequest handler, directly after its
 * identity gate — the policy gate slots in just before it. */
const anchor = '        // v1.56: do NOT foreground the EMR tab until a note field is confirmed on it.';
let n = 0, i = 0;
while ((i = buf.indexOf(anchor, i)) >= 0) { n++; i += anchor.length; }
if (n !== 1) { console.error('anchor count ' + n + ' — refusing'); process.exit(1); }

const block = [
  "        /* MLS_WRITE_SAFETY_PASTE_GATE_START (wsg-1.0.0) — Adam-only TEST policy",
  "           on the generic paste lane (athenanet targets are already refused",
  "           above): test-marked content may only reach Adam J Schaeffer",
  "           (7833832); any write to Adam must be TEST-marked and free of real",
  "           medication/order/instruction language. */",
  "        if (self.MLSWriteSafety) {",
  "          const wsPasteGate = self.MLSWriteSafety.checkTestWritePolicy({ patient: { name: chartId.name || mlsPt.name, mrn: chartId.mrn || mlsPt.mrn }, noteText: note });",
  "          if (wsPasteGate) return sendResponse(wsPasteGate);",
  "        }",
  "        /* MLS_WRITE_SAFETY_PASTE_GATE_END */"
].join('\n');
if (/\r/.test(block)) { console.error('block contains CR'); process.exit(1); }

const at = buf.indexOf(anchor);
let lineStart = buf.lastIndexOf('\n', at);
lineStart = lineStart < 0 ? 0 : lineStart + 1;
buf = buf.slice(0, lineStart) + block + '\n' + buf.slice(lineStart);
fs.writeFileSync(target, buf, 'latin1');
const after = fs.readFileSync(target, 'latin1');
if ((after.match(/\r/g) || []).length !== beforeCRs) { console.error('CR DAMAGE'); process.exit(1); }
if (after.length !== beforeBytes + block.length + 1) { console.error('SIZE MISMATCH'); process.exit(1); }
console.log('OK: paste gate applied. bytes', beforeBytes, '->', after.length, ', CRs', beforeCRs);
