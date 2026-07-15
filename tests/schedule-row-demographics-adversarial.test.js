'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function between(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert(start >= 0 && end > start, `missing source block ${startNeedle}`);
  return source.slice(start, end);
}

const workerHelpers = between('function mlsPlausibleDob(s) {', '/* ---- v1.51: schedule DATE navigation');
assert(!/DATE_RE|split\(\/\\r\?\\n\//.test(workerHelpers),
  'worker demographic normalization still scans arbitrary flat-frame dates');
const workerContext = { Date, String, RegExp, Object, Array };
vm.runInNewContext(`${workerHelpers}\nthis.api={attach:mlsAttachDobs,dob:mlsPlausibleDob,mrn:mlsPlausibleMrn};`, workerContext);

const leaked = [{ name: 'Taylor Exact', time: '8:00 AM', dob: '', mrn: '' }];
workerContext.api.attach(leaked, [
  'Taylor Exact 8:00 AM appointment date 07/15/2026 reason began 06/24/2026',
  'Neighbor Patient DOB: 03/04/1980 MRN: NEIGHBOR-900'
].join('\n'));
assert.strictEqual(leaked[0].dob, '', 'appointment/reason/neighbor date became this row\'s DOB');
assert.strictEqual(leaked[0].mrn, '', 'neighbor MRN became this row\'s MRN');

const normalized = [{ name: 'Known Exact', dob: '1970-01-02', mrn: 'MRN-101' }];
workerContext.api.attach(normalized, 'irrelevant 07/15/2026');
assert.strictEqual(normalized[0].dob, '01/02/1970');
assert.strictEqual(normalized[0].mrn, 'MRN-101');
assert.strictEqual(workerContext.api.dob('02/31/1970'), '', 'impossible DOB survived normalization');
assert.strictEqual(workerContext.api.mrn('07/15/2026'), '', 'a date-shaped value survived MRN normalization');

const rowProofSource = between('function _scheduleRowProofD(root){', 'function _mergeScheduleProofD(target,proof)');
const rowContext = { Date, String, RegExp, Object, Array };
vm.runInNewContext(`
  function cl(v){return String(v==null?'':v).replace(/\\s+/g,' ').trim();}
  function tx(el){try{return cl(el.textContent);}catch(e){return '';}}
  ${rowProofSource}
  this.proof=_scheduleRowProofD;
`, rowContext);

function node(text, attrs, children) {
  const map = Object.assign({}, attrs || {});
  return {
    textContent: String(text || ''),
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null; },
    querySelectorAll() { return Array.isArray(children) ? children : []; }
  };
}

let proof = rowContext.proof(node('8:00 AM Taylor Exact appointment 07/15/2026; symptoms since 06/24/2026; #998877'));
assert.deepStrictEqual(JSON.parse(JSON.stringify(proof)), { dob: '', mrn: '', dobConflict: false, mrnConflict: false },
  'unlabeled row dates/numbers were accepted as identity proof');

proof = rowContext.proof(node('8:00 AM Taylor Exact DOB: 01/02/1970 Medical Record Number: MRN-101'));
assert.strictEqual(proof.dob, '01/02/1970');
assert.strictEqual(proof.mrn, 'MRN-101');

proof = rowContext.proof(node('8:20 AM Attribute Patient', {
  'data-patient-dob': '1980-03-04',
  'data-patient-mrn': 'ATH-202'
}));
assert.strictEqual(proof.dob, '03/04/1980');
assert.strictEqual(proof.mrn, 'ATH-202');

proof = rowContext.proof(node('Duplicate Patient DOB: 01/02/1970 DOB: 03/04/1980'));
assert.strictEqual(proof.dob, '', 'conflicting explicit DOB values selected an arbitrary winner');
assert.strictEqual(proof.dobConflict, true);

const activeReader = between('async function mlsSchedDomInline(doc, CFG){', "if (/stm\\.esp|\\/coordinator\\/|messaging");
assert((activeReader.match(/_scheduleRowProofD\(/g) || []).length >= 6,
  'not every active schedule DOM lane propagates row-scoped demographics');
assert(/out\.appts=_legacyRowsFinalL\.map[\s\S]*dob:a\.dob\|\|''[\s\S]*mrn:a\.mrn\|\|''/.test(activeReader));
assert(/out\.appts=_finalRowsS\.map[\s\S]*dob:a\.dob\|\|''[\s\S]*mrn:a\.mrn\|\|''/.test(activeReader));

const providerStart = source.indexOf('var mlsProv = (function () {');
const providerEnd = source.indexOf('/* A schedule surface must be proven', providerStart);
assert(providerStart >= 0 && providerEnd > providerStart, 'could not isolate schedule merge helper');
const mlsProv = vm.runInNewContext(source.slice(providerStart, providerEnd) + '\nmlsProv;', Object.create(null));
const duplicates = mlsProv.merge({
  appts: [
    { time: '9:00 AM', name: 'Same Display', provider: 'Doctor_One_MD', dob: '01/02/1970', mrn: 'MRN-A' },
    { time: '9:00 AM', name: 'Same Display', provider: 'Doctor_One_MD', dob: '03/04/1980', mrn: 'MRN-B' }
  ],
  providers: ['Doctor_One_MD'], diag: { strategy: 'structure-id' }
}, {
  appts: [
    { time: '9:00 AM', name: 'Same Display', provider: 'Doctor_One_MD' }
  ],
  providers: ['Doctor_One_MD'], diag: { strategy: 'text' }
});
assert.strictEqual(duplicates.appts.length, 2, 'same-name/time/provider rows with different exact proof were collapsed');
assert.deepStrictEqual(Array.from(duplicates.appts, row => row.dob).sort(), ['01/02/1970', '03/04/1980']);

console.log('PASS row-scoped schedule DOB/MRN labels and attributes; arbitrary and neighboring dates fail closed');
