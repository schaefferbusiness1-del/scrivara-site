'use strict';
/* MLS Assist 3.0.154 - findbydob-1.1.0 (Fable, 2026-09-15). Run AD on 3.0.153: the by-DOB search RAN on the one
 * remaining row (findByDob 1) and athena LISTED rows for that date of birth, but none passed the gate
 * (findByDobReason no-name-match; the schedule row carries no MRN). So the printed schedule name and athena's
 * own Find row disagree in shape. Before touching any gate, the driver now describes HOW they disagree as a
 * closed code per DOB-hit row (never a name): e exact, s first/last swapped, l same last (p first is a prefix
 * of the other, x not), f same first (h one last contains the other, x not), c request tokens all inside the
 * row, r row tokens all inside the request, n nothing shared; followed by the request and row token counts.
 * The by-DOB attempt's row counts travel too (dobFindRows/DobHit/NameHit/AltRows). The gate is untouched.
 * Latin1 seams, inverse proof. Run once (after splice-30153.js).
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
function mk(before) {
  let out = before; const edits = [];
  function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam (' + count(out, a) + ')'); assert(a.indexOf(b) >= 0 || count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
  const inverse = (x) => { let y = x; for (const [a, b] of edits.slice().reverse()) { assert(count(y, b) === 1, 'inverse unique'); y = y.replace(b, () => a); } return y; };
  return { rep, inverse, get: () => out };
}
splice('background.js', (before) => {
  const m = mk(before);
  /* 1. the row evidence keeps the printed row name INSIDE the driver (never returned) */
  m.rep("        return {ok:dates.length===1&&mlsExactIdentityPair({name:name,dob:dob},{name:rowName,dob:dates[0]}).ok,",
        "        return {rowName:rowName /* findbydob-1.1.0 (3.0.154): stays inside the driver; only the shape code below leaves */,ok:dates.length===1&&mlsExactIdentityPair({name:name,dob:dob},{name:rowName,dob:dates[0]}).ok,", 'row name');
  /* 2. the shape coder + the per-row collection */
  m.rep("      var __fd = { findRows: 0, findDobHit: 0, findNameHit: 0, findDobOnly: 0, findAltRows: 0, findMrnHit: 0 }; var mrnPool = [];",
        "      var __fd = { findRows: 0, findDobHit: 0, findNameHit: 0, findDobOnly: 0, findAltRows: 0, findMrnHit: 0 }; var mrnPool = [];" +
        " var __dobShapes = []; function __shapeCode(req, row) { /* findbydob-1.1.0 (3.0.154): a closed code, never a name */" +
        " function toks(s) { var r = String(s || '').toLowerCase(); try { r = r.normalize('NFKD').replace(/[\\u0300-\\u036f]/g, ''); } catch (e0) {} var ps = r.split(','); if (ps.length === 2) r = ps[1] + ' ' + ps[0]; return r.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(function (t) { return t && !/^(mr|mrs|ms|miss|dr|prof|jr|sr|ii|iii|iv)$/.test(t); }); }" +
        " var a = toks(req), b = toks(row); if (!a.length || !b.length) return 'n' + a.length + b.length; var af = a[0], al = a[a.length - 1], bf = b[0], bl = b[b.length - 1]; var c = 'n';" +
        " if (mlsExactNameKey(req) && mlsExactNameKey(req) === mlsExactNameKey(row)) c = 'e'; else if (af === bl && al === bf) c = 's';" +
        " else if (al === bl) c = 'l' + ((af.indexOf(bf) === 0 || bf.indexOf(af) === 0) ? 'p' : 'x'); else if (af === bf) c = 'f' + ((b.indexOf(al) >= 0 || a.indexOf(bl) >= 0) ? 'h' : 'x');" +
        " else if (a.every(function (t) { return b.indexOf(t) >= 0; })) c = 'c'; else if (b.every(function (t) { return a.indexOf(t) >= 0; })) c = 'r';" +
        " return c + Math.min(9, a.length) + Math.min(9, b.length); }", 'shape coder');
  m.rep("        __fd.findRows++; if(evidence.dobHit)__fd.findDobHit++;",
        "        __fd.findRows++; if(byDob&&evidence.dobHit&&__dobShapes.length<4)__dobShapes.push(__shapeCode(name,evidence.rowName)); if(evidence.dobHit)__fd.findDobHit++;", 'collect');
  m.rep("      if(pool.length!==1) return {opened:false,attempted:false,reason:pool.length?'ambiguous':'no-name-match',count:pool.length,tier:'exact-name-dob',diag:__fd};",
        "      if(byDob)__fd.findByDobShape=__dobShapes.join('-'); /* findbydob-1.1.0 */ if(pool.length!==1) return {opened:false,attempted:false,reason:pool.length?'ambiguous':'no-name-match',count:pool.length,tier:'exact-name-dob',diag:__fd};", 'attach');
  /* 3. the ladder carries the by-DOB attempt's counts and shape codes */
  m.rep("findByDobReason: String((frd && frd.reason) || '') }); } catch (eFrd) {} }",
        "findByDobReason: String((frd && frd.reason) || ''), findByDobShape: String((frd && frd.diag && frd.diag.findByDobShape) || ''), dobFindRows: Number(frd && frd.diag && frd.diag.findRows) || 0, dobFindDobHit: Number(frd && frd.diag && frd.diag.findDobHit) || 0, dobFindNameHit: Number(frd && frd.diag && frd.diag.findNameHit) || 0, dobFindAltRows: Number(frd && frd.diag && frd.diag.findAltRows) || 0 }); } catch (eFrd) {} }", 'ladder');
  console.log('splice-30154 background.js: 5 seams');
  return { out: m.get(), inverse: m.inverse };
});
splice('content.js', (before) => {
  const m = mk(before);
  m.rep("'findMrnHit' /* findmrn-1.0.0 (3.0.149) */, 'findByDob' /* findbydob-1.0.0 (3.0.153) */].forEach(function (key) {",
        "'findMrnHit' /* findmrn-1.0.0 (3.0.149) */, 'findByDob' /* findbydob-1.0.0 (3.0.153) */, 'dobFindRows', 'dobFindDobHit', 'dobFindNameHit', 'dobFindAltRows' /* findbydob-1.1.0 (3.0.154) */].forEach(function (key) {", 'counts');
  m.rep("['legFind', 'legSched', 'legOrder', 'findByDobReason' /* findbydob-1.0.0 (3.0.153) */].forEach(function (key) {",
        "['legFind', 'legSched', 'legOrder', 'findByDobReason' /* findbydob-1.0.0 (3.0.153) */, 'findByDobShape' /* findbydob-1.1.0 (3.0.154) */].forEach(function (key) {", 'codes');
  console.log('splice-30154 content.js: 2 seams');
  return { out: m.get(), inverse: m.inverse };
});
