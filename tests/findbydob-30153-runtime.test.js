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
ok(ct.includes("['legFind', 'legSched', 'legOrder', 'findByDobReason' /* findbydob-1.0.0 (3.0.153) */]"), 'content.js carries the DOB-search outcome code');
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

/* the ladder block */
const s = bg.indexOf("              /* findbydob-1.0.0 (3.0.153): when every name shape answered no-results");
ok(s > 0, 'ladder block present');
const e = bg.indexOf("findByDobReason: String((frd && frd.reason) || '') }); } catch (eFrd) {} }", s);
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
