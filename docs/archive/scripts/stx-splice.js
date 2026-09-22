'use strict';
/* stx-1.0.0 — the free-line text lane never mints an appointment from a time
 * token sitting mid-line.
 *
 * Live root cause, 2026-08-25 (b1068 + ext 3.0.81): the weekly grid's day had
 * 26 real rows, and one booking's comment prose — "LT SI JOINT/LUMBAR/RT HIP/
 * MEDICARE LMOM RS'D APPT TO 1:30pm …" — minted a 27th text-lane "appointment"
 * ("1:30 PM") with no DOM twin. pp-1.1 then correctly refused the whole day
 * (fabricated text row), and the refusal repeated at every scroll position:
 * an unfixable-by-operator loop caused by the MINT, not the gate.
 *
 * The discriminator: on every scraped schedule surface (dashboard day list,
 * classic weekly grid, classic sidebar) a real text row LEADS with its time
 * cell; comment prose never does. The mint now requires the first time token
 * within the first 3 characters of the cleaned line. Skips are counted in
 * diag.timeMidlineRowsSkipped — visible in the schedule receipt, never silent —
 * and the header-mapped tabular lane is untouched. pp-1.1 keeps refusing any
 * text-only row that still mints.
 *
 * background.js law: latin1, index-splice, LF-first-then-CRLF with the
 * replacement inheriting the matched form.
 */
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
  if (idx < 0) throw new Error('stx-splice: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('stx-splice: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

/* 1: the diag object grows the visible skip counter */
spliceOne('diag-counter',
  "tabularUnmappedRows: 0, apptCount: 0, providerCount: 0, credsSeen: [], providerNames: [] } };",
  "tabularUnmappedRows: 0, timeMidlineRowsSkipped: 0, apptCount: 0, providerCount: 0, credsSeen: [], providerNames: [] } };");

/* 2: the free-line mint is position-gated */
const OLD_MINT = "        if (hasTime(ln)) {\n          var nm = patientNameFromRow(ln);\n          if (nm) out.appts.push({ time: firstTime(ln), name: nm, provider: current || '' });\n        }";
const NEW_MINT = "        if (hasTime(ln)) {\n          /* stx-1.0.0: a real schedule text row LEADS with its time cell on\n             every scraped surface (dashboard day list, weekly grid, sidebar);\n             a time token sitting mid-line is booking-comment prose (\"RS'D\n             APPT TO 1:30pm\"), and minting a row from it fabricates an\n             appointment no DOM row can verify - the pp-1.1 phantom class,\n             measured live 2026-08-25 as a whole-day refusal. Skips are\n             counted in diag, never silent; the header-mapped tabular lane\n             above is untouched. */\n          if (ln.search(RE_TIME) > 2) { out.diag.timeMidlineRowsSkipped++; }\n          else {\n            var nm = patientNameFromRow(ln);\n            if (nm) out.appts.push({ time: firstTime(ln), name: nm, provider: current || '' });\n          }\n        }";
spliceOne('free-line-mint-gate', OLD_MINT, NEW_MINT);

/* scensus EOL law: the mint block sits in a CRLF pocket of the mixed-EOL file,
 * but repo hygiene requires `git diff --check` clean — normalize the inserted
 * block (and only it) to LF, exactly as scensus-eol-fix did for its region. */
const nStart = src.indexOf("          /* stx-1.0.0: a real schedule text row LEADS");
const nEnd = src.indexOf("      var withAppts = {};");
if (nStart < 0 || nEnd < 0 || nEnd < nStart) throw new Error('stx-splice: normalize block not found');
const block = src.slice(nStart, nEnd);
src = src.slice(0, nStart) + block.replace(/\r\n/g, '\n') + src.slice(nEnd);

fs.writeFileSync(file, src, 'latin1');
console.log('stx-1.0.0 spliced OK');
