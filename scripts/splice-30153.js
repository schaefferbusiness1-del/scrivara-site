'use strict';
/* MLS Assist 3.0.153 - findbydob-1.0.0 (Fable, 2026-09-15). Run AC (legsdiag): the two rows that still refuse both
 * have legFind no-results - athena's Find by NAME lists nobody for the name the schedule printed (one a two-word
 * name, one a particle surname after five shapes). The classic Find page also searches by date of birth
 * (filtertype=DOB). Cure: when every name shape answered no-results (or listed rows with no exact/MRN match), the
 * open handler asks the same driver ONCE more in 'dob' mode - the Find page filtered by the patient's date of
 * birth - and the driver's unchanged row gate decides: the exact printed-name + DOB pair, or exactly one row
 * carrying the requested MRN with no contradicting DOB (findmrn-1.0.0). Never a name-only or DOB-only match.
 * Counted as findRetries 5 and findByDob 1 (content.js allowlists findByDob). Latin1 seams, inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
function splice(file, fn) {
  const target = path.join(__dirname, '..', file);
  const before = fs.readFileSync(target, 'latin1');
  const { out, inverse } = fn(before);
  assert.strictEqual(inverse(out), before, file + ' inverse restores original');
  fs.writeFileSync(target, Buffer.from(out, 'latin1'));
}
const count = (s, n) => s.split(n).length - 1;
splice('background.js', (before) => {
  let out = before; const edits = [];
  function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam (' + count(out, a) + ')'); assert(a.indexOf(b) >= 0 || count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
  /* 1. the driver takes a mode; in 'dob' mode the Find page is filtered by date of birth */
  rep("  async function mlsFindPatientOpenDriverFn(name, dob, requestGuard, mrn) {",
      "  async function mlsFindPatientOpenDriverFn(name, dob, requestGuard, mrn, mode) {", 'signature');
  rep("      var searchStr = fq ? (lname + ',' + fq) : lname;",
      "      var searchStr = fq ? (lname + ',' + fq) : lname;" +
      " var __dobKeyF = mlsExactDobKey(dob), __dobP = __dobKeyF ? __dobKeyF.split('-') : null, __dobUs = __dobP ? (('0' + __dobP[1]).slice(-2) + '/' + ('0' + __dobP[2]).slice(-2) + '/' + __dobP[0]) : '';" +
      " var byDob = (mode === 'dob' && !!__dobUs); var findText = byDob ? __dobUs : searchStr; /* findbydob-1.0.0 (3.0.153): the Find page filtered by date of birth; the row gate below is unchanged */", 'search text');
  rep("      best.w.location.href = prefix + 'client/findpatient.esp?filtertype=NAME&findtext=' + encodeURIComponent(searchStr)",
      "      best.w.location.href = prefix + 'client/findpatient.esp?filtertype=' + (byDob ? 'DOB' : 'NAME') + '&findtext=' + encodeURIComponent(findText)", 'url');
  rep("        if (!setVal(inp, searchStr)) return deadlineOut();", "        if (!setVal(inp, findText)) return deadlineOut();", 'fill');
  rep("        if (inpChk && inpChk.value === searchStr) { filled = true; break; }", "        if (inpChk && inpChk.value === findText) { filled = true; break; }", 'fill check');
  rep("          if (inpR) { if (!setVal(inpR, searchStr)) return deadlineOut(); await sleep(500); }", "          if (inpR) { if (!setVal(inpR, findText)) return deadlineOut(); await sleep(500); }", 'refill');
  /* 2. the ladder asks by date of birth once, after every name shape */
  const closeOfCompound = (function () {
    const p = out.indexOf("try { findRes.diag = Object.assign({}, findRes.diag || {}, { findRetries: 3 + __ps }); } catch (eFrp) {}");
    assert(p > 0, 'particle block present');
    const forClose = out.indexOf('\n                    }', p); const ifClose = out.indexOf('\n                  }', forClose + 1); const c16 = out.indexOf('\n                }', ifClose + 1); const c14 = out.indexOf('\n              }', c16 + 1);
    assert(forClose > p && ifClose > forClose && c16 > ifClose && c14 > c16 && c14 - p < 400, 'closes located');
    assert(out.slice(c14, c14 + 200).indexOf('if (findRes && findRes.opened) {') > 0, 'the comma-less compound block closes right before the opened branch');
    return c14 + '\n              }'.length;
  })();
  const eol = out.indexOf('\n', closeOfCompound); const N = (eol > 0 && out[eol - 1] === '\r') ? '\r\n' : '\n';
  const block = [
    "              /* findbydob-1.0.0 (3.0.153): when every name shape answered no-results, or listed rows with no exact/MRN match, ask",
    "                 athena's Find ONCE by date of birth; the driver's row gate (exact name+DOB, or one exact-MRN row) still decides. */",
    "              if (findRes && !findRes.opened && /^(no-results|no-name-match)$/.test(findRes.reason || '') && msg.dob && !responseSent) {",
    "                if (senderTab) progress(senderTab, 'Still no match by name - asking athenaOne by date of birth...', openGuard.token);",
    "                var fxd = await execOpen({ target: { tabId: tab.id }, world: 'MAIN', args: [msg.name || '', msg.dob || '', findGuard, frozenMrn, 'dob'], func: mlsFindPatientOpenDriverFn }, 42000);",
    "                if (fxd.timeout) { failOpenDeadline('find-by-dob open'); return; }",
    "                var frd = (fxd && fxd.r && fxd.r[0] && fxd.r[0].result) || null;",
    "                if (frd && (frd.opened || /^(ambiguous|dob-mismatch)$/.test(frd.reason || ''))) findRes = frd;",
    "                else { try { findRes.diag = Object.assign({}, findRes.diag || {}, { findRetries: 5, findByDob: 1, findByDobReason: String((frd && frd.reason) || '') }); } catch (eFrd) {} }",
    "              }"
  ].join(N) + N;
  assert(count(before, 'findbydob-1.0.0') === 0, 'not applied yet');
  const withBlock = out.slice(0, eol + 1) + block + out.slice(eol + 1);
  const inverse = (x) => { let y = x.slice(0, eol + 1) + x.slice(eol + 1 + block.length); for (const [a, b] of edits.slice().reverse()) { assert(count(y, b) === 1, 'inverse unique'); y = y.replace(b, () => a); } return y; };
  console.log('splice-30153 background.js: ' + edits.length + ' seams + 1 insertion (' + JSON.stringify(N) + ')');
  return { out: withBlock, inverse };
});
splice('content.js', (before) => {
  const a = "'findRetries' /* compound3-1.0.0 (3.0.139) */, 'findMrnHit' /* findmrn-1.0.0 (3.0.149) */].forEach(function (key) {";
  const b = "'findRetries' /* compound3-1.0.0 (3.0.139) */, 'findMrnHit' /* findmrn-1.0.0 (3.0.149) */, 'findByDob' /* findbydob-1.0.0 (3.0.153) */].forEach(function (key) {";
  assert(count(before, a) === 1 && count(before, b) === 0, 'content allowlist seam');
  const out = before.replace(a, () => b);
  /* the DOB-search outcome code rides through the closed sanitizer beside the leg codes */
  const c = "['legFind', 'legSched', 'legOrder'].forEach(function (key) {";
  const d = "['legFind', 'legSched', 'legOrder', 'findByDobReason' /* findbydob-1.0.0 (3.0.153) */].forEach(function (key) {";
  assert(count(out, c) === 1 && count(out, d) === 0, 'content leg codes seam');
  const out2 = out.replace(c, () => d);
  console.log('splice-30153 content.js: 2 seams');
  return { out: out2, inverse: (x) => x.replace(d, () => c).replace(b, () => a) };
});
