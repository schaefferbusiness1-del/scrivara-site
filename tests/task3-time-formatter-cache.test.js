'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'feat_task3_frontsync.js'), 'utf8');
const start = source.indexOf('var _t3TzFormatters = {}');
const end = source.indexOf('function todayKey()', start);
assert(start >= 0 && end > start, 'Task 3 timezone formatter cache is missing');

let timezone = 'America/New_York';
let constructors = 0;
const NativeDateTimeFormat = Intl.DateTimeFormat;
const context = {
  window: { _acctTz() { return timezone; } },
  localStorage: { getItem() { return ''; } },
  Intl: {
    DateTimeFormat: function DateTimeFormat(locale, options) {
      constructors++;
      return new NativeDateTimeFormat(locale, options);
    }
  },
  Date,
  isNaN,
  parseInt,
  safe(fn, fallback) { try { return fn(); } catch (error) { return fallback; } },
  isFn(value) { return typeof value === 'function'; },
  pad(value) { return (value < 10 ? '0' : '') + value; },
  acctTz() { return timezone; }
};
vm.createContext(context);
vm.runInContext(source.slice(start, end) + '\nthis.tzDateKey=tzDateKey;this.tzHHMM=tzHHMM;', context);

for (let i = 0; i < 3000; i++) {
  assert.strictEqual(context.tzHHMM('2026-07-27T13:15:00Z'), '09:15');
}
assert.strictEqual(constructors, 1, '3,000 appointment times constructed more than one formatter for one timezone');

for (let i = 0; i < 100; i++) {
  assert(/^\d{2}\/\d{2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(context.tzDateKey(new Date('2026-07-27T13:15:00Z'))));
}
assert.strictEqual(constructors, 2, 'date normalization did not reuse one formatter for one timezone');

timezone = 'America/Chicago';
assert.strictEqual(context.tzHHMM('2026-07-27T13:15:00Z'), '08:15');
assert.strictEqual(constructors, 3, 'timezone change did not create exactly one new time formatter');
context.tzHHMM('2026-07-27T14:15:00Z');
assert.strictEqual(constructors, 3, 'hot formatter cache missed after a timezone change');

console.log('PASS Task 3 timezone cache: 3,001 hot appointment formats use two constructors, not 3,001');
