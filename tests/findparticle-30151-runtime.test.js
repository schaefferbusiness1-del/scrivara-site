'use strict';
/* MLS Assist 3.0.151 — findparticle-1.0.0: a requested name carrying a lowercase surname particle gets two more
 * honest Find shapes (particle-joined surname, bare last word) after the compound shapes found nothing; a name
 * without a particle gets none. Executes the real ladder block with a fake Find driver that records the shapes. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const s = bg.indexOf('                  /* findparticle-1.0.0 (3.0.151): a surname carrying a lowercase particle');
ok(s > 0, 'block present');
const e = bg.indexOf("try { findRes.diag = Object.assign({}, findRes.diag || {}, { findRetries: 3 + __ps }); } catch (eFrp) {}", s);
ok(e > s, 'block end located');
const forClose = bg.indexOf('\n                    }', e);
const ifClose = bg.indexOf('\n                  }', forClose + 1);
ok(forClose > e && ifClose > forClose, 'the loop and the if close after the retry line');
const block = bg.slice(s, ifClose + '\n                  }'.length).replace(/\r/g, '');
ok(block.includes("cTok.slice(__pIdx).join('') + ', ' + cTok.slice(0, __pIdx).join(' ')"), 'shape 1: the particle-joined surname');
ok(block.includes("cTok[cTok.length - 1] + ', ' + cTok[0]"), 'shape 2: the bare last word with the bare first word');
ok(block.includes("func: mlsFindPatientOpenDriverFn }, 42000)"), 'the same driver, same budget');
ok(bg.indexOf('compound3-1.0.0 (3.0.139): a FOUR-word name') < s, 'the particle shapes come after the compound shapes');

async function run(name, driverAnswers) {
  const asked = [];
  let findRes = { opened: false, reason: 'no-results', diag: { findRetries: 2 } };
  const cTok = name.split(' ');
  const execOpen = async (opts) => { const shape = opts.args[0]; asked.push(shape); const ans = driverAnswers[asked.length - 1] || { opened: false, reason: 'no-results' }; return { r: [{ result: ans }] }; };
  const fn = new Function('cTok', 'findRes', 'responseSent', 'senderTab', 'progress', 'openGuard', 'execOpen', 'tab', 'msg', 'findGuard', 'frozenMrn', 'mlsFindPatientOpenDriverFn', 'failOpenDeadline',
    'return (async () => {\n' + block + '\nreturn findRes;\n})();');
  const res = await fn(cTok, findRes, false, null, () => {}, { token: 't' }, execOpen, { id: 1 }, { dob: '1980-01-02' }, {}, '', function () {}, () => {});
  return { asked, res };
}
(async () => {
  let r = await run('Maria J de Souza', []);
  eq(r.asked.length, 2, 'two particle shapes are tried');
  eq(r.asked[0], 'deSouza, Maria J', 'the particle-joined surname first');
  eq(r.asked[1], 'Souza, Maria', 'then the bare last word with the bare first word');
  eq(r.res.diag.findRetries, 4, 'counted as retries 3 and 4');
  r = await run('Maria J de Souza', [{ opened: false, reason: 'no-results' }, { opened: true, via: 'findpatient' }]);
  eq(r.asked.length, 2, 'stops at the shape that opened'); eq(r.res.opened, true, 'and adopts it');
  r = await run('Maria J de Souza', [{ opened: false, reason: 'dob-mismatch' }]);
  eq(r.asked.length, 1, 'a DOB mismatch is a final answer, not a reason to try another shape'); eq(r.res.reason, 'dob-mismatch', 'adopted as the answer');
  r = await run('Maria Jane Souza', []);
  eq(r.asked.length, 0, 'no particle, no extra shapes');
  r = await run('De Souza Maria', []);
  eq(r.asked.length, 0, 'a capitalized De at the front is not a particle inside the name');
  r = await run('Anne van der Berg', []);
  eq(r.asked[0], 'vanderBerg, Anne', 'a two-word particle joins whole'); eq(r.asked[1], 'Berg, Anne', 'and the bare last word follows');
  console.log('PASS findparticle-30151-runtime: ' + checks + ' checks');
})().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
