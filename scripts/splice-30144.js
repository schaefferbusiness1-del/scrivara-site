'use strict';
/* MLS Assist 3.0.144 - visitsshadow-1.0.0 + rowveto-1.0.0 (Fable, 2026-09-15). Run U on 3.0.143 (Sep 14, all
 * notes, hidden work window): 40 rows offered, 33 read; the two remaining classes, read from the refusal receipts:
 *
 *  1. chart-swap-never-settled x4 ("athenaOne is still showing a different patient than this read expects",
 *     the visits pre-gate, 45 s each). The visits driver's 'identity' op reads document.body.innerText with
 *     label regexes (DOB:, MRN:, "Patient ..."). Since athena's 2026-09-02 release the patient banner lives in
 *     an open shadow root, which innerText does not include - so the ax chart frame answers with no identity
 *     and a stale legacy frame (still printing the previous patient) wins the frame vote. The chart-open leg had
 *     just verified the SAME tab through the shadow banner (shadowbanner-1.0.0 / mlsReadChartIdentityShadow).
 *     Cure: the visits driver gets the same shadow-banner reader (a verbatim copy of the write probe's
 *     shadowBannerIdentities helper) and answers from it first, via 'banner' with a score that outranks any
 *     regex hit; the visits identity gate accepts the banner's other printed name (used vs legal) as an exact
 *     alternative, DOB still exact - the same rule the read path applies (chartNameViaLegal).
 *
 *  2. visit-bodies-incomplete x2 rows (four tries each): on a clincmp-ax chart the classic walk indexed the
 *     PROBLEM LIST as the encounter list (candidates problembullet:11 score 84, medicationrow:7 score 77;
 *     every body read failed no-bound-clinical-detail with d2 rowCls problembullet, kidCls problemitem).
 *     Cure: rows from the generic selectors are vetoed when their own or their parent's class names name a
 *     chart section that is not an encounter list (problem, medication, allergy, surgical/family/social
 *     history, immunization, vitals, orders, results); the count travels in the diagnose census
 *     (counts.furnitureVetoed). athena's explicit li.encounter-list-item rows are untouched.
 *
 * Latin1 seams (the two inserted blocks copy their neighbour's terminator), inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90) + ' (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
function eolAfter(anchor) { const i = out.indexOf(anchor); assert(i >= 0, 'eol anchor: ' + anchor.slice(0, 60)); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }
function fnBlock(src, start) { const i = src.indexOf(start); assert(i >= 0, 'fn: ' + start.slice(0, 50)); let d = 0, e = i; for (; e < src.length; e++) { if (src[e] === '{') d++; else if (src[e] === '}') { d--; if (d === 0) break; } } return src.slice(i, e + 1); }

/* the visits driver and the write probe's shadow-banner helper */
const drvStart = '  function mlsVisitsDriverFn(op, cfg, idx, expectedBinding) {';
assert(count(out, drvStart) === 1, 'visits driver header unique');
const helperSrc = fnBlock(out, '    function shadowBannerIdentities(doc) {');
assert(helperSrc.length > 3000 && helperSrc.length < 12000 && helperSrc.indexOf('found.push({ name: name, dob: dob, mrn: mrn, altNames: altNames, via: via });') > 0, 'helper shape');
assert(count(out, '    function shadowBannerIdentities(doc) {') === 1, 'helper unique (the write probe)');
const helperCopy = helperSrc.replace('    function shadowBannerIdentities(doc) {', '    function visitsShadowBanner(doc) { /* visitsshadow-1.0.0 (3.0.144): verbatim copy of the write probe\'s shadowBannerIdentities - the two injected functions cannot share code */');
assert(helperCopy.indexOf('function shadowBannerIdentities') < 0 && helperCopy.indexOf('function visitsShadowBanner(doc)') === 4, 'copy renamed');

/* 1. the identity op answers from the shadow banner first */
const idop = "    if (op === 'identity') {";
{
  const N = eolAfter(idop);
  rep(idop, helperCopy + N + idop, 'helper copy');
}
rep("      var body = txt(document.body), dob = '', name = '', mrn = '', weakName = false;",
    "      var body = txt(document.body), dob = '', name = '', mrn = '', weakName = false;" +
    " try { var __sbv = visitsShadowBanner(document); if (__sbv && __sbv.length && __sbv[0] && __sbv[0].name && __sbv[0].dob) { return { name: __sbv[0].name, dob: __sbv[0].dob, mrn: __sbv[0].mrn || '', weakName: false, via: 'banner', score: 30, altNames: (__sbv[0].altNames || []).slice(0, 3), shadow: true }; } } catch (_eSbv) {} /* visitsshadow-1.0.0 (3.0.144): body.innerText cannot see athena's shadow-root banner; a stale legacy frame used to win the vote */", 'identity op');

/* 2. the visits identity gate accepts the banner's other printed name, DOB still exact */
rep("    return mlsExactIdentityPair(frozen, live);",
    "    var __gr = mlsExactIdentityPair(frozen, live);" +
    " /* visitsshadow-1.0.0 (3.0.144): athena's banner prints a used name and a legal name; the read path accepts either exact pair (chartNameViaLegal) - so does this gate, DOB still exact */" +
    " if (__gr && !__gr.ok && __gr.reason === 'same-frame-name-mismatch' && live && Array.isArray(live.altNames)) { for (var __ai = 0; __ai < live.altNames.length && __ai < 3; __ai++) { var __alt = mlsExactIdentityPair(frozen, { name: live.altNames[__ai], dob: live.dob, mrn: live.mrn }); if (__alt && __alt.ok) { __alt.viaAltName = true; return __alt; } } }" +
    " return __gr;", 'gate');

/* 3. generic-selector rows that belong to another chart section never form an encounter index */
const cg = '    function candidateGroups() {';
{
  const N = eolAfter(cg);
  rep(cg,
      "    var __furnitureVetoed = 0; /* rowveto-1.0.0 (3.0.144) */" + N +
      "    function furnitureRow(n) { try { var c = String((n.className && n.className.baseVal != null ? n.className.baseVal : n.className) || '') + ' ' + String((n.parentElement && n.parentElement.className && n.parentElement.className.baseVal == null ? n.parentElement.className : '') || ''); return /problem|medication|allerg|surgicalhx|familyhx|socialhx|immuniz|vaccin|vitals?(row|item|bullet)|orderrow|resultrow/i.test(c); } catch (_eFr) { return false; } } /* rowveto-1.0.0 (3.0.144): the classic walk indexed a problem list as the encounter list */" + N +
      cg, 'veto helper');
}
rep("      var groups = [];", "      var groups = []; __furnitureVetoed = 0;", 'veto reset');
rep("          if (cfg.rowSelectors[s] !== 'li.encounter-list-item' && excluded(t)) continue;",
    "          if (cfg.rowSelectors[s] !== 'li.encounter-list-item' && excluded(t)) continue;" +
    " if (cfg.rowSelectors[s] !== 'li.encounter-list-item' && furnitureRow(n)) { __furnitureVetoed++; continue; } /* rowveto-1.0.0 (3.0.144) */", 'veto');
rep("visitish: cnt('[class*=\"visit\" i]') },", "visitish: cnt('[class*=\"visit\" i]'), furnitureVetoed: __furnitureVetoed },", 'census');

let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30144: ' + edits.length + ' verified seams');
