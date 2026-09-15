'use strict';
/* MLS Assist 3.0.157 - findbydob-2.0.0 (usedname opener) + axrefusals-1.0.0 (Fable, 2026-09-15).
 * Run AG (3.0.156, shape histogram): the one refused row has NO MRN on the schedule, athena's Find by NAME lists
 * nobody for the printed name, and Find by DOB lists 35 patients of that birth date: 34 share no name token and
 * exactly ONE (code lx44) has the same four-token name with only the FIRST token different - the schedule prints
 * the patient's USED first name and athena's Find prints the LEGAL one. The owner's rule (8/28): auto-merge only on
 * MRN or exact name+DOB, with the banner's other printed name (used vs legal) accepted as an exact alternative when
 * the DOB is exact - and the chart handler's identity gate already applies exactly that (altNames, 10759+).
 * Cure: in dob mode, when the exact pool and the MRN pool are both empty, EXACTLY one DOB-hit row differs from the
 * printed name in the first token only (same token count, every other token equal), and athena's "N results found"
 * equals the rows read (no page cap hid a twin), the driver opens THAT row (re-verified on the settled list like every
 * other open). Nothing is captured on the open: the chart read that follows must still prove the printed name as
 * the banner's used or legal name with an exact DOB, or it refuses wrong-chart and captures nothing. Two such rows
 * (twins) stay refused. The open answers usedNameCandidate:true so every receipt shows how the row was found.
 * axrefusals-1.0.0: the ax encounter loop's single axRefused counter is split in the receipt (refusedNav /
 * refusedIdentity / refusedBody / refusedAfterIdentity) so "attempted 1, parsed 0" names its step.
 * Latin1 seams, inverse proof. Run once (after splice-30155c.js).
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
  const inverse = (x) => { let y = x; for (const [a, b] of edits.slice().reverse()) { assert(count(y, b) === 1, 'inverse unique: ' + b.slice(0, 50)); y = y.replace(b, () => a); } return y; };
  return { rep, inverse, get: () => out };
}
splice('background.js', (before) => {
  const m = mk(before);
  /* --- findbydob-2.0.0 --- */
  m.rep(" var __dobShapes = {}; function __shapeCode(req, row) {",
        " var usedPool = [], usedNarrowed = false, __resTotal = (function () { var __rm = (typeof resText === 'string') ? /(\\d+)\\s+results?\\s+found/i.exec(resText) : null; return __rm ? +__rm[1] : 0; })();" +
        " function __usedShape(req, row) { /* findbydob-2.0.0 (3.0.157): the printed name and the row differ in the FIRST token only (used vs legal first name); same token count, every other token equal */" +
        " function toks(s) { var r = String(s || '').toLowerCase(); try { r = r.normalize('NFKD').replace(/[\\u0300-\\u036f]/g, ''); } catch (e0) {} var ps = r.split(','); if (ps.length === 2) r = ps[1] + ' ' + ps[0]; return r.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(function (t) { return t && !/^(mr|mrs|ms|miss|dr|prof|jr|sr|ii|iii|iv)$/.test(t); }); }" +
        " var a = toks(req), b = toks(row); if (a.length < 2 || a.length !== b.length || a[0] === b[0]) return false; for (var i = 1; i < a.length; i++) { if (a[i] !== b[i]) return false; } return true; }" +
        " var __dobShapes = {}; function __shapeCode(req, row) {", 'used shape');
  m.rep("else if(evidence.mrnHit&&!evidence.dobVeto){__fd.findMrnHit++; mrnPool.push({a:chartAs[c],dob:evidence.dob,mrnMatched:true});} /* findmrn-1.0.0 */",
        "else if(evidence.mrnHit&&!evidence.dobVeto){__fd.findMrnHit++; mrnPool.push({a:chartAs[c],dob:evidence.dob,mrnMatched:true});} /* findmrn-1.0.0 */ else if(byDob&&evidence.dobHit&&__usedShape(name,evidence.rowName)){__fd.findUsedRows=(__fd.findUsedRows||0)+1; usedPool.push({a:chartAs[c],dob:evidence.dob,mrnMatched:false,usedName:true});} /* findbydob-2.0.0 */", 'used pool');
  m.rep("if(pool.length===0&&mrnPool.length===1){pool=mrnPool;mrnNarrowed=true;}",
        "if(pool.length===0&&mrnPool.length===1){pool=mrnPool;mrnNarrowed=true;} if(byDob){__fd.findResultsTotal=__resTotal;} if(byDob&&pool.length===0&&mrnPool.length===0&&usedPool.length===1&&__resTotal>0&&__resTotal===__fd.findRows){pool=usedPool;usedNarrowed=true;} /* findbydob-2.0.0 (3.0.157): exactly one used-vs-legal row on an uncapped list; the chart read's banner gate (used or legal name + exact DOB) still decides before anything is captured */", 'used narrowing');
  m.rep("if(_rvEv.ok||(pool[0].mrnMatched===true&&_rvEv.mrnHit&&!_rvEv.dobVeto))_rvRows.push(_rvAs[_rvI]);",
        "if(_rvEv.ok||(pool[0].mrnMatched===true&&_rvEv.mrnHit&&!_rvEv.dobVeto)||(pool[0].usedName===true&&_rvEv.dobHit&&__usedShape(name,_rvEv.rowName)))_rvRows.push(_rvAs[_rvI]);", 're-read');
  m.rep("return { opened: true, via: 'findpatient', rowDob: pool[0].dob || '', rowMrnMatched: pool[0].mrnMatched === true, mrnNarrowed: mrnNarrowed };",
        "return { opened: true, via: 'findpatient', rowDob: pool[0].dob || '', rowMrnMatched: pool[0].mrnMatched === true, mrnNarrowed: mrnNarrowed, usedNameCandidate: pool[0].usedName === true, diag: __fd };", 'open answer');
  m.rep("rowMrnMatched: findRes.rowMrnMatched === true, diag: { route: 'findpatient'",
        "rowMrnMatched: findRes.rowMrnMatched === true, usedNameCandidate: findRes.usedNameCandidate === true, diag: { route: 'findpatient', usedNameCandidate: findRes.usedNameCandidate === true", 'open response');
  /* --- axrefusals-1.0.0 --- */
  m.rep("var axVisits = [], axRefused = 0, axShapeUnknown = 0, axAttempted = 0,",
        "var axVisits = [], axRefused = 0, axShapeUnknown = 0, axAttempted = 0, axRefNav = 0, axRefIdentity = 0, axRefBody = 0, axRefAfter = 0, /* axrefusals-1.0.0 (3.0.157) */", 'ax counters');
  m.rep("if (!axNavOk || axNavOk.ok !== true) { axRefused++; continue; }", "if (!axNavOk || axNavOk.ok !== true) { axRefused++; axRefNav++; continue; }", 'ax nav');
  m.rep("if (axIdent && (axIdent.name || axIdent.dob)) axRefused++;", "if (axIdent && (axIdent.name || axIdent.dob)) { axRefused++; axRefIdentity++; }", 'ax identity');
  m.rep("if (!axBody || !axBody.ok || axBody.encounterPath !== axE.hrefPath) { axRefused++; continue; }", "if (!axBody || !axBody.ok || axBody.encounterPath !== axE.hrefPath) { axRefused++; axRefBody++; continue; }", 'ax body');
  m.rep("if (!axAfterIdent || !visitIdentityGate(frozenHint, axAfterIdent).ok) { axRefused++; continue; }", "if (!axAfterIdent || !visitIdentityGate(frozenHint, axAfterIdent).ok) { axRefused++; axRefAfter++; continue; }", 'ax after');
  m.rep("expected: axExpected, parsed: axKept, attempted: axAttempted,",
        "expected: axExpected, parsed: axKept, attempted: axAttempted, refusedNav: axRefNav, refusedIdentity: axRefIdentity, refusedBody: axRefBody, refusedAfterIdentity: axRefAfter, shapeUnknown: axShapeUnknown, /* axrefusals-1.0.0 */", 'ax receipt');
  console.log('splice-30157 background.js: 12 seams');
  return { out: m.get(), inverse: m.inverse };
});
splice('content.js', (before) => {
  const m = mk(before);
  m.rep("              safeDiag.rowMrnMatched = openedDiag.rowMrnMatched === true;",
        "              safeDiag.rowMrnMatched = openedDiag.rowMrnMatched === true; safeDiag.usedNameCandidate = openedDiag.usedNameCandidate === true; /* findbydob-2.0.0 (3.0.157) */", 'content flag');
  m.rep("'dobFindRows', 'dobFindDobHit', 'dobFindNameHit', 'dobFindAltRows' /* findbydob-1.1.0 (3.0.154) */].forEach(function (key) {",
        "'dobFindRows', 'dobFindDobHit', 'dobFindNameHit', 'dobFindAltRows' /* findbydob-1.1.0 (3.0.154) */, 'findUsedRows', 'findResultsTotal' /* findbydob-2.0.0 (3.0.157) */].forEach(function (key) {", 'content counts');
  console.log('splice-30157 content.js: 2 seams');
  return { out: m.get(), inverse: m.inverse };
});
