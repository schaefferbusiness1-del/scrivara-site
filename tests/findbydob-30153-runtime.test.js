'use strict';
/* MLS Assist 3.0.153 — findbydob-1.0.0: after every name shape answered no-results (or no-name-match), the open
 * handler asks the Find driver once in 'dob' mode; the driver then filters athena's Find page by date of birth
 * and its unchanged row gate decides. Executes the real ladder block with a fake driver; pins the driver's mode
 * handling and the content allowlist. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
const ct = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* driver pins */
ok(bg.includes('  async function mlsFindPatientOpenDriverFn(name, dob, requestGuard, mrn, mode) {'), 'the driver takes a mode');
ok(bg.includes("var byDob = (mode === 'dob' && !!__dobUs); var findText = byDob ? __dobUs : searchStr;"), 'dob mode searches the printed date of birth');
ok(bg.includes("'client/findpatient.esp?filtertype=' + (byDob ? 'DOB' : 'NAME') + '&findtext=' + encodeURIComponent(findText)"), 'the Find page is filtered by DOB in dob mode');
eq(bg.split('setVal(inp, findText)').length - 1, 1, 'the fill uses the same text'); eq(bg.split('inpChk.value === findText').length - 1, 1, 'and the fill check');
ok(!bg.includes('setVal(inp, searchStr)'), 'no stale fill with the name in dob mode');
ok(ct.includes("'findByDob' /* findbydob-1.0.0 (3.0.153) */"), 'content.js allowlists findByDob as a count');
ok(ct.includes("['legFind', 'legSched', 'legOrder', 'findByDobReason' /* findbydob-1.0.0 (3.0.153) */"), 'content.js carries the DOB-search outcome code');
/* the driver's own DOB formatting */
const drvStart = bg.indexOf('  async function mlsFindPatientOpenDriverFn(');
const keyStart = bg.indexOf('function mlsExactDobKey(value) {', drvStart);
const keyFn = new Function(bg.slice(keyStart, bg.indexOf('\n}', keyStart) + 2) + '\nreturn mlsExactDobKey;')();
eq(keyFn('1980-01-02'), '1980-1-2', 'the driver\'s DOB key is unpadded (the reason the search text pads it)');
const dobExpr = "var __dobKeyF = mlsExactDobKey(dob), __dobP = __dobKeyF ? __dobKeyF.split('-') : null, __dobUs = __dobP ? (('0' + __dobP[1]).slice(-2) + '/' + ('0' + __dobP[2]).slice(-2) + '/' + __dobP[0]) : '';";
ok(bg.includes(dobExpr), 'the search text is built from the DOB key');
const toUs = new Function('mlsExactDobKey', 'dob', dobExpr + ' return __dobUs;');
eq(toUs(keyFn, '1980-01-02'), '01/02/1980', 'an ISO date of birth searches as athena\'s MM/DD/YYYY');
eq(toUs(keyFn, '12/25/1962'), '12/25/1962', 'a US date of birth searches unchanged');
eq(toUs(keyFn, '1962-3-4'), '03/04/1962', 'a loose ISO date pads');
eq(toUs(keyFn, ''), '', 'no date of birth, no search text (the ladder never asks without one)');

/* findbydob-1.1.0 (3.0.154): the by-DOB rows' shapes travel as closed codes, never names */
ok(bg.includes("return {rowName:rowName /* findbydob-1.1.0 (3.0.154): stays inside the driver; only the shape code below leaves */,ok:dates.length===1&&mlsExactIdentityPair("), 'the row name stays inside the driver');
ok(bg.includes("if(byDob&&evidence.dobHit){var __sc=__shapeCode(name,evidence.rowName);__dobShapes[__sc]=(__dobShapes[__sc]||0)+1;}"), 'EVERY DOB-hit row is coded (findbydob-1.2.0: a histogram, no four-row cap)');
ok(bg.includes("if(byDob)__fd.findByDobShape=Object.keys(__dobShapes).sort().map(function(k){return k+'x'+__dobShapes[k];}).join('-').slice(0,40); /* findbydob-1.2.0 (3.0.155): every DOB-hit row, as code x count */ if(pool.length!==1) return {opened:false,attempted:false,reason:pool.length?'ambiguous':'no-name-match',count:pool.length,tier:'exact-name-dob',diag:__fd};"), 'the codes ride the unchanged refusal as code x count');
ok(bg.includes(" var __dobShapes = {}; function __shapeCode(req, row) {"), 'the shape store is a histogram');
ok(bg.includes("findByDobShape: String((frd && frd.diag && frd.diag.findByDobShape) || ''), dobFindRows: Number(frd && frd.diag && frd.diag.findRows) || 0, dobFindDobHit: Number(frd && frd.diag && frd.diag.findDobHit) || 0, dobFindNameHit: Number(frd && frd.diag && frd.diag.findNameHit) || 0, dobFindAltRows: Number(frd && frd.diag && frd.diag.findAltRows) || 0 }"), 'the ladder carries the by-DOB counts and codes');
ok(ct.includes("'dobFindRows', 'dobFindDobHit', 'dobFindNameHit', 'dobFindAltRows' /* findbydob-1.1.0 (3.0.154) */"), 'content.js allowlists the by-DOB counts');
ok(ct.includes("'findByDobShape' /* findbydob-1.1.0 (3.0.154) */"), 'content.js carries the shape code through the closed sanitizer');
const shStart = bg.indexOf('function __shapeCode(req, row) {'); const shEndTok = "return c + Math.min(9, a.length) + Math.min(9, b.length); }"; const shEnd = bg.indexOf(shEndTok, shStart);
ok(shStart > 0 && shEnd > shStart, 'shape coder present');
const nameKeyStart = bg.indexOf('function mlsExactNameKey(value) {');
const shape = new Function(bg.slice(nameKeyStart, bg.indexOf('\n}', nameKeyStart) + 2) + '\n' + bg.slice(shStart, shEnd + shEndTok.length) + '\nreturn __shapeCode;')();
eq(shape('Maria Souza', 'Maria Souza'), 'e22', 'exact');
eq(shape('Souza Maria', 'Maria Souza'), 's22', 'first/last swapped');
eq(shape('Bill Souza', 'William Souza'), 'lx22', 'same last, different first');
eq(shape('Will Souza', 'William Souza'), 'lp22', 'same last, first a prefix');
eq(shape('Maria Souza', 'Maria Souza-Lima'), 'fh23', 'same first, the request last is one of the row tokens (a hyphen splits)');
eq(shape('Maria Souza', 'Maria Lima'), 'fx22', 'same first, different last');
eq(shape('Maria Souza', 'Maria de Souza Lima'), 'fh24', 'same first, the request last is one of the row tokens');
eq(shape('Maria Lima', 'Maria de Souza Lima'), 'e24', 'the exact key is first+last, so this row would have PASSED the gate');
eq(shape('Souza Lima Maria', 'Maria de Souza Lima'), 'c34', 'request tokens all inside the row');
eq(shape('Ana Souza', 'Rui Lima'), 'n22', 'nothing shared');
eq(shape('Souza, Maria', 'Maria Souza'), 'e22', 'a comma request is read as Last, First');
ok(!/[A-Z]/.test(shape('Maria Souza', 'Rui Lima')) && shape('Maria Souza', 'Rui Lima').length <= 4, 'the code carries no letters of any name');

/* the ladder block */
const s = bg.indexOf("              /* findbydob-1.0.0 (3.0.153): when every name shape answered no-results");
ok(s > 0, 'ladder block present');
const e = bg.indexOf("dobFindAltRows: Number(frd && frd.diag && frd.diag.findAltRows) || 0 }); } catch (eFrd) {} }", s); ok(e > s, 'ladder seam present');
const close = bg.indexOf('\n              }', e);
const block = bg.slice(s, close + '\n              }'.length).replace(/\r/g, '');
ok(bg.indexOf('findparticle-1.0.0 (3.0.151): a surname carrying') < s, 'the DOB shape comes after the particle shapes');
ok(bg.indexOf("String(msg.name || '').indexOf(',') < 0) {", bg.indexOf('COMPOUND-SURNAME RETRY')) < s, 'and outside the comma-less compound block, so a comma name earns it too');
ok(bg.indexOf('if (findRes && findRes.opened) {', s) - s < 2200, 'right before the opened branch');
async function run(findRes0, dob, answer) {
  const asked = [];
  let findRes = findRes0;
  const execOpen = async (opts) => { asked.push({ name: opts.args[0], dob: opts.args[1], mode: opts.args[4] }); return { r: [{ result: answer || { opened: false, reason: 'no-results' } }] }; };
  const fn = new Function('findRes', 'responseSent', 'senderTab', 'progress', 'openGuard', 'execOpen', 'tab', 'msg', 'findGuard', 'frozenMrn', 'mlsFindPatientOpenDriverFn', 'failOpenDeadline',
    'return (async () => {\n' + block + '\nreturn findRes;\n})();');
  const res = await fn(findRes, false, null, () => {}, { token: 't' }, execOpen, { id: 1 }, { name: 'Maria de Souza', dob: dob }, {}, '5551234', function () {}, () => {});
  return { asked, res };
}
(async () => {
  let r = await run({ opened: false, reason: 'no-results', diag: { findRetries: 4 } }, '1980-01-02', null);
  eq(r.asked.length, 1, 'one DOB attempt'); eq(r.asked[0].mode, 'dob', 'in dob mode'); eq(r.asked[0].dob, '1980-01-02', 'with the requested date of birth');
  eq(r.res.diag.findRetries, 5, 'counted as retry 5'); eq(r.res.diag.findByDob, 1, 'and flagged'); eq(r.res.diag.findByDobReason, 'no-results', 'the DOB search\'s own outcome travels');
  r = await run({ opened: false, reason: 'no-name-match', diag: {} }, '1980-01-02', { opened: true, via: 'findpatient', rowMrnMatched: true });
  eq(r.asked.length, 1, 'rows with no exact/MRN match also earn one DOB attempt'); eq(r.res.opened, true, 'and an opened answer is adopted');
  r = await run({ opened: false, reason: 'no-results', diag: {} }, '', null);
  eq(r.asked.length, 0, 'no date of birth, no DOB search');
  r = await run({ opened: true, via: 'findpatient' }, '1980-01-02', null);
  eq(r.asked.length, 0, 'an opened chart never triggers it');
  r = await run({ opened: false, reason: 'dob-mismatch' }, '1980-01-02', null);
  eq(r.asked.length, 0, 'a DOB mismatch is final');
  r = await run({ opened: false, reason: 'no-results', diag: {} }, '1980-01-02', { opened: false, reason: 'ambiguous' });
  eq(r.res.reason, 'ambiguous', 'two candidate rows by DOB stay refused as ambiguous, never guessed');
  console.log('PASS findbydob-30153-runtime: ' + checks + ' checks');
})().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
