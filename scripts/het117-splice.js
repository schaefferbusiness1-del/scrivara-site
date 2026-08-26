'use strict';
/* het-1.1.7 — the stage visit date is stored in the driver's canonical key
 * form, because dateKey MANGLES ISO.
 *
 * postGate census (het-1.1.6) named the dropping gate: visit-date. The stage
 * capture is strict ISO (\d{4}-\d{2}-\d{2} = '2026-08-25') but dateKey's
 * regex is m/d/y-first, so it matches inside the ISO string and returns
 * '6/8/2025'. The equality gate then compares '6/8/2025' against
 * dateKey('8/25/2026') = '8/25/2026' and refuses every qualified stage
 * frame. Convert the ISO capture to m/d/yyyy directly at storage; the
 * equality gate itself does not move. */
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'background.js');
let src = fs.readFileSync(file, 'latin1');

function spliceOne(label, findLF, replLF) {
  const findCRLF = findLF.replace(/\n/g, '\r\n');
  const replCRLF = replLF.replace(/\n/g, '\r\n');
  let idx = src.indexOf(findLF);
  let find = findLF, repl = replLF;
  if (idx < 0) { idx = src.indexOf(findCRLF); find = findCRLF; repl = replCRLF; }
  if (idx < 0) throw new Error('het117: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het117: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

spliceOne('iso-visit-date',
  "        var visitDate = dateKey(dates[0]);",
  "        /* het-1.1.7: the capture is strict ISO but dateKey is m/d/y-first\n" +
  "           and mangles it ('2026-08-25' -> '6/8/2025'), refusing every\n" +
  "           qualified frame at the visit-date equality. Convert directly. */\n" +
  "        var hetIso = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(dates[0]);\n" +
  "        var visitDate = hetIso ? (Number(hetIso[2]) + '/' + Number(hetIso[3]) + '/' + hetIso[1]) : dateKey(dates[0]);");

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.1.7 spliced OK');
