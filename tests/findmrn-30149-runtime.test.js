'use strict';
/* MLS Assist 3.0.149 — findmrn-1.0.0: on athena's Find results, when no row passes the exact printed-name + DOB
 * pair and exactly one row carries the requested MRN with no contradicting DOB, that row is the patient. Runs the
 * REAL row-evidence function (exactResultRow) with the driver's own key/pair/MRN helpers against fake result
 * tables; pins the pool acceptance, the re-read, the counter, the content allowlist and the legs-diag merge. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
const ct = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
function fnBlock(src, start, from) { const i = src.indexOf(start, from || 0); assert(i >= 0, 'fn: ' + start.slice(0, 50)); let d = 0, e = i; for (; e < src.length; e++) { if (src[e] === '{') d++; else if (src[e] === '}') { d--; if (d === 0) break; } } return src.slice(i, e + 1); }

const drvStart = bg.indexOf('  async function mlsFindPatientOpenDriverFn(name, dob, requestGuard, mrn, mode) {');
ok(drvStart > 0, 'Find driver located');
const driver = fnBlock(bg, '  async function mlsFindPatientOpenDriverFn(name, dob, requestGuard, mrn, mode) {');
/* static pins */
ok(driver.includes("mrnHit:!!wantMrn&&cells.some(function(x){return mrnCellMatches(x,wantMrn);}),dobVeto:dates.length===1&&!!mlsExactDobKey(dob)&&dates[0]!==mlsExactDobKey(dob)}"), 'the row evidence carries MRN hit and DOB veto');
ok(driver.includes("else if(evidence.mrnHit&&!evidence.dobVeto){__fd.findMrnHit++; mrnPool.push({a:chartAs[c],dob:evidence.dob,mrnMatched:true});}"), 'an MRN row with no contradicting DOB joins the MRN pool');
ok(driver.includes("if(pool.length===0&&mrnPool.length===1){pool=mrnPool;mrnNarrowed=true;}"), 'exactly one MRN row is accepted only when the exact pair found nobody');
ok(driver.includes("if(_rvEv.ok||(pool[0].mrnMatched===true&&_rvEv.mrnHit&&!_rvEv.dobVeto))_rvRows.push(_rvAs[_rvI]);"), 'the re-read accepts the same evidence');
ok(driver.includes("findMrnHit: 0 }"), 'the counter exists');
ok(ct.includes("'findRetries' /* compound3-1.0.0 (3.0.139) */, 'findMrnHit' /* findmrn-1.0.0 (3.0.149) */, 'findByDob' /* findbydob-1.0.0 (3.0.153) */]"), 'content.js allowlists findMrnHit as a count');
ok(bg.includes("['findRows', 'findDobHit', 'findNameHit', 'findDobOnly', 'findAltRows', 'findMrnHit', 'findTokens', 'findRetries'].forEach(function (k) { if (__p.diag[k] == null && __fr.diag[k] != null) __p.diag[k] = __fr.diag[k]; });"), 'every refusal carries the Find counts (legsdiag-1.1.0)');

/* the real evidence function */
const pieces = [
  fnBlock(driver, 'function mlsExactNameKey(value) {'),
  fnBlock(driver, 'function mlsExactDobKey(value) {'),
  fnBlock(driver, 'function mlsExactIdentityPair(expected, observed) {'),
  fnBlock(driver, 'function nrmMrn(s) {'),
  fnBlock(driver, 'function mrnCellMatches(value, wanted) {'),
  fnBlock(driver, 'function exactResultRow(row) {')
];
function cell(text) { return { innerText: text }; }
function table(headers, rows) {
  const t = { rows: [], querySelectorAll(sel) { if (/thead/.test(sel)) return headers.map(cell); if (sel === 'tr') return t.rows; return []; } };
  t.rows = rows.map((cells) => ({ closest: () => t, querySelectorAll: (sel) => (/td,th|th,td/.test(sel) ? cells.map(cell) : []) }));
  return t;
}
function evidence(name, dob, mrn, headers, cells) {
  const t = table(headers, [cells]);
  const fn = new Function('name', 'dob', 'wantMrn', pieces.join('\n') + '\nreturn exactResultRow;');
  return fn(name, dob, String(mrn || '').toLowerCase().replace(/[^a-z0-9]/g, ''))(t.rows[0]);
}
const H = ['First Name', 'Last Name', 'DOB', 'Patient ID', 'Phone'];
let ev = evidence('Robert Dunne', '1980-01-02', '5551234', H, ['Robert', 'Dunne', '01/02/1980', '5551234', '555-0100']);
eq(ev.ok, true, 'exact pair still passes'); eq(ev.mrnHit, true, 'and the MRN is seen'); eq(ev.dobVeto, false, 'no veto');
ev = evidence('Robert Dunne', '1980-01-02', '5551234', H, ['Bob', 'Dunne', '01/02/1980', '5551234', '555-0100']);
eq(ev.ok, false, 'a different printed first name fails the exact pair'); eq(ev.mrnHit, true, 'the MRN identifies the row'); eq(ev.dobVeto, false, 'the DOB agrees');
ev = evidence('Robert Dunne', '1980-01-02', '5551234', H, ['Bob', 'Dunne', '01/03/1980', '5551234', '555-0100']);
eq(ev.mrnHit, true, 'MRN seen'); eq(ev.dobVeto, true, 'but a different DOB vetoes the row');
ev = evidence('Robert Dunne', '1980-01-02', '5551234', H, ['Bob', 'Dunne', '01/02/1980', '5551235', '555-0100']);
eq(ev.mrnHit, false, 'a different MRN never matches');
ev = evidence('Robert Dunne', '1980-01-02', '', H, ['Bob', 'Dunne', '01/02/1980', '5551234', '555-0100']);
eq(ev.mrnHit, false, 'no requested MRN, no MRN evidence');
ev = evidence('Robert Dunne', '1980-01-02', '1980', H, ['Bob', 'Dunne', '01/02/1980', '1980', '555-0100']);
eq(ev.mrnHit, false, 'a short number is never an MRN (the matcher\'s own floor)');
ev = evidence('Robert Dunne', '1980-01-02', '5551234', H, ['Bob', 'Dunne', '01/02/1980', '', 'MRN: 5551234']);
eq(ev.mrnHit, true, 'a labeled MRN in any cell counts');

/* the pool logic, executed as written */
const poolSrc = "var pool = [], mrnPool = [], mrnNarrowed = false, __fd = { findMrnHit: 0 };\n" +
  "rows.forEach(function (evidence) { if(evidence.ok) pool.push({a:1,dob:evidence.dob,mrnMatched:false}); else if(evidence.mrnHit&&!evidence.dobVeto){__fd.findMrnHit++; mrnPool.push({a:1,dob:evidence.dob,mrnMatched:true});} });\n" +
  "if(pool.length===0&&mrnPool.length===1){pool=mrnPool;mrnNarrowed=true;}\n" +
  "return { pool: pool, mrnNarrowed: mrnNarrowed, hits: __fd.findMrnHit };";
const poolFn = new Function('rows', poolSrc);
let p = poolFn([{ ok: false, mrnHit: true, dobVeto: false }, { ok: false, mrnHit: false }]);
eq(p.pool.length, 1, 'one MRN row is chosen'); eq(p.mrnNarrowed, true, 'and flagged'); eq(p.hits, 1, 'counted');
p = poolFn([{ ok: false, mrnHit: true, dobVeto: false }, { ok: false, mrnHit: true, dobVeto: false }]);
eq(p.pool.length, 0, 'two MRN rows: nobody is chosen'); eq(p.hits, 2, 'both counted');
p = poolFn([{ ok: true, mrnHit: true }, { ok: false, mrnHit: true, dobVeto: false }]);
eq(p.pool.length, 1, 'an exact-pair row wins'); eq(p.mrnNarrowed, false, 'without MRN narrowing'); eq(p.pool[0].mrnMatched, false, 'chosen by the pair');
p = poolFn([{ ok: false, mrnHit: true, dobVeto: true }]);
eq(p.pool.length, 0, 'a vetoed MRN row is never chosen');
console.log('PASS findmrn-30149-runtime: ' + checks + ' checks');
