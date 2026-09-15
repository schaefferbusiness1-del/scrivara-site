'use strict';
/* MLS Assist 3.0.151 - findparticle-1.0.0 (Fable, 2026-09-15). Run AB (legsdiag): the one row whose Find never
 * matches has legFind no-results and legSched name-not-found, and its requested name has the shape
 * "Capitalized Initial lowercase-word Capitalized" - a surname carrying a particle (de, van, la, ...). The Find
 * ladder tries "Last, First M de", then the two- and three-word compound surnames, and athena answers no results
 * to all of them (athena files such surnames joined or under the bare last word). Cure: two more honest shapes,
 * only when a lowercase particle sits inside the name - the particle-joined surname ("DeLast, First M") and the
 * bare last word with the bare first word ("Last, First"); the driver's exact name+DOB row gate and DOB veto
 * decide as before (its name key already folds the particle away), so no weaker match is ever accepted. Counted
 * as findRetries 3 and 4. The block is inserted after the compound3 block's closing line, with that line's own
 * terminator; inverse proof. Run once (after splice-30151b.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
const count = (s, n) => s.split(n).length - 1;
const a1 = "else { try { findRes.diag = Object.assign({}, findRes.diag || {}, { findRetries: 2 }); } catch (eFr2) {} }";
assert(count(before, a1) === 1, 'compound3 retry line unique');
const i1 = before.indexOf(a1);
const closeIdx = before.indexOf('                  }', i1 + a1.length);
assert(closeIdx > i1 && closeIdx - i1 < 200, 'compound3 block close follows its retry line');
const eol = before.indexOf('\n', closeIdx);
const N = (eol > 0 && before[eol - 1] === '\r') ? '\r\n' : '\n';
const block = [
  "                  /* findparticle-1.0.0 (3.0.151): a surname carrying a lowercase particle (de, van, la, ...) is filed by",
  "                     athena joined or under its bare last word; two more honest shapes, same driver gate, never name-only. */",
  "                  var __pIdx = -1; for (var __pi = 1; __pi < cTok.length - 1; __pi++) { if (/^(de|da|del|della|delle|di|du|dos|das|la|le|les|van|von|der|den|ter|te|el|al|bin|ibn|st|saint|mc|mac|o)$/.test(cTok[__pi]) && cTok[__pi] === cTok[__pi].toLowerCase()) { __pIdx = __pi; break; } }",
  "                  if (__pIdx > 0 && !(findRes && (findRes.opened || /^(ambiguous|dob-mismatch)$/.test(findRes.reason || ''))) && !responseSent) {",
  "                    var __pShapes = [cTok.slice(__pIdx).join('') + ', ' + cTok.slice(0, __pIdx).join(' '), cTok[cTok.length - 1] + ', ' + cTok[0]];",
  "                    for (var __ps = 0; __ps < __pShapes.length && !responseSent; __ps++) {",
  "                      if (senderTab) progress(senderTab, 'Still no match - retrying with the surname written as athena may file it...', openGuard.token);",
  "                      var fxp = await execOpen({ target: { tabId: tab.id }, world: 'MAIN', args: [__pShapes[__ps], msg.dob || '', findGuard, frozenMrn], func: mlsFindPatientOpenDriverFn }, 42000);",
  "                      if (fxp.timeout) { failOpenDeadline('compound-name open'); return; }",
  "                      var frp = (fxp && fxp.r && fxp.r[0] && fxp.r[0].result) || null;",
  "                      if (frp && (frp.opened || /^(ambiguous|dob-mismatch)$/.test(frp.reason || ''))) { findRes = frp; break; }",
  "                      try { findRes.diag = Object.assign({}, findRes.diag || {}, { findRetries: 3 + __ps }); } catch (eFrp) {}",
  "                    }",
  "                  }"
].join(N) + N;
assert(count(before, 'findparticle-1.0.0') === 0, 'not applied yet');
const out = before.slice(0, eol + 1) + block + before.slice(eol + 1);
assert.strictEqual(out.slice(0, eol + 1) + out.slice(eol + 1 + block.length), before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30151c: 1 verified insertion (' + block.length + ' bytes, ' + JSON.stringify(N) + ')');
