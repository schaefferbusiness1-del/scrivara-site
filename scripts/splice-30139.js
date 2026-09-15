'use strict';
/* MLS Assist 3.0.139 - compound3-1.0.0 (Fable, 2026-09-15). Measured on three pulls (3.0.136/3.0.137,
 * finddiag counts): the one row that never opens has a FOUR-word name with no punctuation and no comma,
 * no appointment id (so no schedule fallback), and athena's Find answers "no results" for "Last,First"
 * and again for the two-word surname retry. The only untried honest shape is a three-word surname
 * ("De La Cruz, Maria"). Add that as a bounded third retry, only for 4+ token names that already failed
 * twice, adopting the answer only when it opens or contradicts (ambiguous / dob-mismatch) exactly like the
 * existing compound retry; the same DOB veto and exact-pair row gate run inside the driver. The refusal
 * diag counts the retries (findRetries) so the next run says what was tried. Latin1 seams, inverse proof.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const only = process.argv[2] || '';
function editFile(file, plan) {
  const target = path.join(__dirname, '..', file);
  const before = fs.readFileSync(target, 'latin1');
  let out = before; const edits = [];
  const count = (s, n) => s.split(n).length - 1;
  function eolAt(anchor) { const i = out.indexOf(anchor); assert(i >= 0, 'eol anchor: ' + anchor.slice(0, 60)); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }
  function rep(a, b, label) { assert(count(out, a) === 1, file + ' ' + label + ' unique seam: ' + a.slice(0, 90) + ' (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
  plan(rep, eolAt);
  let restored = out;
  for (const [a, b] of edits.slice().reverse()) { assert(count(restored, b) === 1, 'inverse unique'); restored = restored.replace(b, () => a); }
  assert.strictEqual(restored, before, file + ' inverse restores original');
  fs.writeFileSync(target, Buffer.from(out, 'latin1'));
  console.log('splice-30139 ' + file + ': ' + edits.length + ' verified seams');
}

if (!only || only === 'background.js') editFile('background.js', function (rep, eolAt) {
  var a = "                  if (frc && (frc.opened || /^(ambiguous|dob-mismatch)$/.test(frc.reason || ''))) findRes = frc;";
  var N = eolAt(a);
  rep(a, a + N +
      "                  else { try { findRes.diag = Object.assign({}, findRes.diag || {}, { findRetries: 1 }); } catch (eFr1) {} } /* compound3-1.0.0 (3.0.139): count the honest retries */" + N +
      "                  /* compound3-1.0.0 (3.0.139): a FOUR-word name that found nothing as \"Last,First\" and nothing" + N +
      "                     as a two-word surname gets ONE more honest shape - the last three words as the surname." + N +
      "                     Same adoption rule, same DOB veto and exact-pair row gate inside the driver, never name-only. */" + N +
      "                  if (!(frc && (frc.opened || /^(ambiguous|dob-mismatch)$/.test(frc.reason || ''))) && cTok.length >= 4 && !responseSent) {" + N +
      "                    var cName3 = cTok.slice(-3).join(' ') + ', ' + cTok.slice(0, -3).join(' ');" + N +
      "                    if (senderTab) progress(senderTab, 'Still no match - retrying once with a three-word last name...', openGuard.token);" + N +
      "                    var fxc3 = await execOpen({ target: { tabId: tab.id }, world: 'MAIN', args: [cName3, msg.dob || '', findGuard, frozenMrn], func: mlsFindPatientOpenDriverFn }, 42000);" + N +
      "                    if (fxc3.timeout) { failOpenDeadline('compound-name open'); return; }" + N +
      "                    var frc3 = (fxc3 && fxc3.r && fxc3.r[0] && fxc3.r[0].result) || null;" + N +
      "                    if (frc3 && (frc3.opened || /^(ambiguous|dob-mismatch)$/.test(frc3.reason || ''))) findRes = frc3;" + N +
      "                    else { try { findRes.diag = Object.assign({}, findRes.diag || {}, { findRetries: 2 }); } catch (eFr2) {} }" + N +
      "                  }", 'compound3');
});

if (!only || only === 'content.js') editFile('content.js', function (rep, eolAt) {
  var a = "               'eaChanged', 'eaDatelessChanged' /* navaccept-1.0.0 (3.0.137) */].forEach(function (key) {";
  rep(a, "               'eaChanged', 'eaDatelessChanged' /* navaccept-1.0.0 (3.0.137) */," + eolAt(a) +
         "               'findRetries' /* compound3-1.0.0 (3.0.139) */].forEach(function (key) {", 'allowlist');
});
