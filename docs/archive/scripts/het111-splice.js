'use strict';
/* het-1.1.1 — the ancestorIdentity census stamp reports the WALK's own
 * outcome, not the frame's leftover header state.
 *
 * The stamp read `chartHeader.ambiguous` — but when the walk exhausts with
 * nothing found, chartHeader is still the FRAME's own (ambiguous) header, so
 * 'ambiguous' also meant "no ancestor carried any identity at all". Three
 * het iterations chased a phantom banner conflict on that reading. The walk
 * now tracks its own verdict — found | ancestor-ambiguous | none-found —
 * plus the hop count, and the census stamps that. */
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
  if (idx < 0) throw new Error('het111: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het111: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

spliceOne('walk-verdict-init',
  "          var hetAncWin = null; try { hetAncWin = fr.w && fr.w.parent && fr.w.parent !== fr.w ? fr.w.parent : null; } catch (eHet0) { hetAncWin = null; }",
  "          var hetWalkVerdict = 'none-found';\n          var hetAncWin = null; try { hetAncWin = fr.w && fr.w.parent && fr.w.parent !== fr.w ? fr.w.parent : null; } catch (eHet0) { hetAncWin = null; }");

spliceOne('walk-verdict-ambig',
  "            if (hetHeader.ambiguous) { chartHeader = hetHeader; break; }",
  "            if (hetHeader.ambiguous) { hetWalkVerdict = 'ancestor-ambiguous'; chartHeader = hetHeader; break; }");

spliceOne('walk-verdict-found',
  "            if (hetHeader.identity) { chartHeader = hetHeader; observedIdentity = hetHeader.identity; break; }",
  "            if (hetHeader.identity) { hetWalkVerdict = 'found'; chartHeader = hetHeader; observedIdentity = hetHeader.identity; break; }");

spliceOne('stamp-true-verdict',
  "          hetDiag.ancestorIdentity = observedIdentity ? 'found' : (chartHeader.ambiguous ? 'ambiguous' : 'none');",
  "          hetDiag.ancestorIdentity = hetWalkVerdict; hetDiag.walkHops = hetHops;");

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.1.1 spliced OK');
