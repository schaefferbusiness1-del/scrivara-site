'use strict';
/* MLS Assist 3.0.139 - metabind-1.0.0 (Fable, 2026-09-15). Measured on the first full-day pull through the
 * hidden work window (3.0.138, recorder capturing receipt frame counts): the three schedule-route rows that
 * navaccept-1.0.0 now opens come back ok:true with receipt.complete:false - expectedClinicalFrames 2,
 * readClinicalFrames 1, unboundClinicalFrames 1 - and the app refuses the receipt. The unbound frame is
 * athena's encounter surface: clinical vocabulary, no banner, a URL without the appointment id, no
 * name+DOB line in its text, so none of the three binding doors accepts it. athena stamps that surface
 * with the machine-typed `<meta content='[{"encounter_id":..,"patient_id":..}]'>` the write probe already
 * trusts (het-1.0.0). Door 4: a frame whose meta patient_id equals the requested MRN is bound by athena
 * itself. MRN supports, it never vetoes: a missing or different meta changes nothing. The receipt counts
 * metaBoundClinicalFrames. Latin1 seams, inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function eolAt(anchor) { const i = out.indexOf(anchor); assert(i >= 0, 'eol anchor: ' + anchor.slice(0, 60)); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90) + ' (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
var a;

/* 1. both injected per-frame readers (primary, 12-space; retry, 14-space) also return the machine-typed meta patient id (digits only) */
[12, 14].forEach(function (ind) {
  var sp = " ".repeat(ind), sp2 = " ".repeat(ind + 2);
  var head = "\n" + sp + "try {";
  var i = out.indexOf(head + "\r\n" + sp2 + "if (!document.body) return { u: u, t: '', fullLen: 0, truncated: false, readOk: false, reason: 'body-missing' };");
  var N = i >= 0 ? "\r\n" : "\n";
  var anchor = head + N + sp2 + "if (!document.body) return { u: u, t: '', fullLen: 0, truncated: false, readOk: false, reason: 'body-missing' };" + N + sp2 + "const raw = String(document.body.innerText || '');" + N + sp2 + "return { u: u, t: raw.slice(0, PER_FRAME_CAP), fullLen: raw.length, truncated: raw.length > PER_FRAME_CAP, readOk: true };";
  var mpLine = sp2 + "var mp = ''; try { var ms = document.querySelectorAll('meta'); for (var mi = 0; mi < ms.length; mi++) { var mc = ms[mi].getAttribute('content') || ''; if (!/encounter_id/.test(mc)) continue; var arr = JSON.parse(mc); if (!Array.isArray(arr)) continue; for (var ai = 0; ai < arr.length; ai++) { var it = arr[ai]; if (it && typeof it === 'object' && it.patient_id != null) { mp = String(it.patient_id).replace(/\D/g, ''); break; } } if (mp) break; } } catch (eMp) { mp = ''; } /* metabind-1.0.0 (3.0.139) */";
  rep(anchor, head + N + sp2 + "if (!document.body) return { u: u, t: '', fullLen: 0, truncated: false, readOk: false, reason: 'body-missing' };" + N + sp2 + "const raw = String(document.body.innerText || '');" + N + mpLine + N + sp2 + "return { u: u, t: raw.slice(0, PER_FRAME_CAP), fullLen: raw.length, truncated: raw.length > PER_FRAME_CAP, readOk: true, mp: mp };", "reader-" + ind);
});
/* 2. the raw-frame mapper carries it */
a = "            return { frameId: (r && typeof r.frameId === 'number') ? r.frameId : -1, u: x.u || '', t: x.t || '', fullLen: Number(x.fullLen || 0), truncated: x.truncated === true, readOk: x.readOk === true, reason: x.reason || '' };";
rep(a, "            return { frameId: (r && typeof r.frameId === 'number') ? r.frameId : -1, u: x.u || '', t: x.t || '', fullLen: Number(x.fullLen || 0), truncated: x.truncated === true, readOk: x.readOk === true, reason: x.reason || '', mp: String(x.mp || '').replace(/\\D/g, '') };", 'mapper');

/* 3. Door 4 in the binding gate, counted */
a = "          const frameBoundToTarget = (f) => {" + eolAt("          const frameBoundToTarget = (f) => {") +
    "            if (!want || (!wantDob && !wantMrn)) return false;" + eolAt("          const frameBoundToTarget = (f) => {") +
    "            if (identityMatchesTarget(frameIdentity[f.frameId])) return true;";
{
  const N = eolAt("          const frameBoundToTarget = (f) => {");
  rep(a, "          let metaBoundClinicalFrames = 0; /* metabind-1.0.0 (3.0.139) */" + N +
         "          const frameBoundToTarget = (f) => {" + N +
         "            if (!want || (!wantDob && !wantMrn)) return false;" + N +
         "            if (identityMatchesTarget(frameIdentity[f.frameId])) return true;" + N +
         "            /* metabind-1.0.0 (3.0.139) DOOR 4: athena's own machine-typed stage context names this patient." + N +
         "               Exact digit equality with the requested MRN; a missing or different meta binds nothing. */" + N +
         "            if (wantMrn && f.mp && f.mp.length >= 4 && f.mp === String(wantMrn).replace(/\\D/g, '')) { metaBoundClinicalFrames++; return true; }", 'door4');
}
a = "            boundClinicalFrames: chosenStrict.length, unboundClinicalFrames: unboundClinicalFrames,";
rep(a, a + " metaBoundClinicalFrames: metaBoundClinicalFrames, /* metabind-1.0.0 (3.0.139) */", 'receipt');

let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30139b: ' + edits.length + ' verified seams');
