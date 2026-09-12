'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'latin1');
const begin = source.indexOf("    if (op === 'axRead') {");
const end = source.indexOf("    if (op === 'surfaceProbe') {", begin);
assert(begin > 0 && end > begin);
const code = source.slice(begin, end);
function read(options = {}) {
  const location = { pathname: options.actualPath || '/1/2/ax/encounter/101/summary' };
  let bodyReads = 0;
  const document = {
    visibilityState: 'visible', querySelectorAll: () => [],
    body: { get innerText() {
      bodyReads++;
      if (options.recycle) location.pathname = '/1/2/ax/encounter/909/summary';
      return options.body || 'Encounter date: 09/10/2026\nHistory and examination. Assessment and plan: synthetic complete note.';
    } }
  };
  const context = {op:'axRead', cfg:{}, idx:options.expectedPath === undefined ? '/1/2/ax/encounter/101/summary' : options.expectedPath, document, location};
  return { result:vm.runInNewContext('(function(){'+code+'})()', context), bodyReads };
}
const healthy = read();
assert.strictEqual(healthy.result.ok, true, 'healthy exact encounter body must read');
assert.strictEqual(healthy.result.headerDate, '09/10/2026');
const stale = read({actualPath:'/1/2/ax/encounter/100/summary'});
assert.strictEqual(stale.result.ok, false, 'stale same-patient encounter body was accepted for another requested encounter');
assert.strictEqual(stale.bodyReads, 0, 'mismatched encounter route must refuse before body capture');
for (const expectedPath of ['', '/1/2/ax/briefing/101', 'https://foreign.invalid/1/2/ax/encounter/101/summary']) {
  assert.strictEqual(read({expectedPath}).result.ok, false, 'unbound/foreign read must refuse');
}
assert.strictEqual(read({recycle:true}).result.ok, false, 'route recycled during body capture must refuse');
const dobFirst = read({body:'Patient Synthetic Person\nDOB: 01/02/1960\nEncounter date: 09/10/2026\nHistory, examination, assessment and plan.'});
assert.strictEqual(dobFirst.result.headerDate, '09/10/2026', 'DOB must not masquerade as encounter date');
const unknown = read({body:'Patient Synthetic Person\nDOB: 01/02/1960\nHistory, examination, assessment and plan.'});
assert.strictEqual(unknown.result.headerDate, '', 'a patient DOB cannot prove an out-of-scope encounter');
const conflicting = read({body:'Encounter date: 09/10/2026\nDate of service: 09/11/2026\nHistory, examination, assessment and plan.'});
assert.strictEqual(conflicting.result.headerDate, '', 'conflicting date fields cannot prove a scoped exclusion');
console.log('PASS AX encounter binding: exact route, pre/post capture recycle refusal, explicit encounter dates, DOB exclusion and conflicting-date unknown');
