'use strict';
/* cap-mrn-1.0.0 - the capture reply's MRN is digits-only, always.
 *
 * Pull-matrix path 3 (open-patient capture), measured 2026-08-26 on three
 * consecutive captures of the SAME open chart: runs 1-2 returned mrn
 * '7833832', run 3 returned '#7833832'. The backend extractor echoes the
 * banner's raw decoration and the all-frames text scrape shuffles what it
 * sees run to run. Every identity comparator downstream keys on digits;
 * normalize once at the reply boundary so no consumer ever sees the
 * decorated form. */
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'background.js');
let src = fs.readFileSync(file, 'latin1');

function spliceOne(label, findLF, replLF) {
  const findCRLF = findLF.replace(/\n/g, '\r\n');
  const replCRLF = replLF; /* scensus law: the inserted block stays LF even in a CRLF pocket */
  let idx = src.indexOf(findLF);
  let find = findLF, repl = replLF;
  if (idx < 0) { idx = src.indexOf(findCRLF); find = findCRLF; repl = replCRLF; }
  if (idx < 0) throw new Error('capmrn: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('capmrn: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

spliceOne('capture-mrn-digits',
  "        const res = await callBackend('/api/assist/extract', { pageText, url: tab.url });\n" +
  "        sendResponse(Object.assign({ fromTab: tab.url }, res));",
  "        const res = await callBackend('/api/assist/extract', { pageText, url: tab.url });\n" +
  "        /* cap-mrn-1.0.0: the backend echoes the banner's raw MRN decoration\n" +
  "           and it VARIES run-to-run ('7833832' vs '#7833832' measured on\n" +
  "           consecutive captures of one open chart). Every downstream identity\n" +
  "           comparator keys on digits - normalize at the reply boundary. */\n" +
  "        try { if (res && res.captured && res.captured.mrn != null) res.captured.mrn = String(res.captured.mrn).replace(/\\D+/g, ''); } catch (eCapMrn) {}\n" +
  "        sendResponse(Object.assign({ fromTab: tab.url }, res));");

fs.writeFileSync(file, src, 'latin1');
console.log('cap-mrn-1.0.0 spliced OK');
