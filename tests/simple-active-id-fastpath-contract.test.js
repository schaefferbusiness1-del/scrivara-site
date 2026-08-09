'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_simple_exact.js'), 'utf8');
assert(source.includes('var VERSION = "simx-1.4.2"'), 'Simple Visit fast-path version is missing');
const helperStart = source.indexOf('function realActive()');
const helperEnd = source.indexOf('function initials(', helperStart);
const syncStart = source.indexOf('function sync()');
const syncEnd = source.indexOf('function scheduleSync()', syncStart);
assert(helperStart >= 0 && helperEnd > helperStart && syncStart >= 0 && syncEnd > syncStart,
  'Simple Visit active-patient helpers are missing');
const sync = source.slice(syncStart, syncEnd);
assert(sync.includes('var activeId = realActiveId();') && !sync.includes('var ra = realActive()'),
  'ordinary Visit input reconciliation still reads the full active-patient record');

let rosterReads = 0;
const context = {
  window: {
    getActivePtId() { return 'p-1'; },
    activePatient() { rosterReads++; return { id: 'p-1', name: 'Synthetic Patient' }; }
  }
};
vm.createContext(context);
vm.runInContext(source.slice(helperStart, helperEnd) + '\nthis.realActiveId=realActiveId;', context);
for (let i = 0; i < 1000; i++) assert.strictEqual(context.realActiveId(), 'p-1');
assert.strictEqual(rosterReads, 0, '1,000 stable input reconciliations decoded the roster');
delete context.window.getActivePtId;
assert.strictEqual(context.realActiveId(), 'p-1', 'older-host active-patient fallback was lost');
assert.strictEqual(rosterReads, 1, 'older-host fallback performed duplicate roster reads');

console.log('PASS Simple Visit active-id fast path: 1,000 stable input checks perform zero roster reads with legacy fallback preserved');
