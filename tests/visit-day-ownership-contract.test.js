'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const frontsync = fs.readFileSync(path.join(root, 'feat_task3_frontsync.js'), 'utf8');

assert(!connect.includes("className = 'ez3fl-daychip'"), 'Visit still creates a second manual day owner');
assert(!connect.includes("className = 'ez3fl-daypop'"), 'Visit still creates the retired day popover');
assert(!connect.includes('Viewing today'), 'Visit still renders the redundant Viewing today control');
assert(!connect.includes('goStaffRange(') && !connect.includes('_pendingRange'), 'retired Visit-to-Staff day bridge can still resurrect hidden day state');

const homeSigs = [...connect.matchAll(/function homeSig\(\)\s*\{([\s\S]*?)\n\s*\}/g)].map(match => match[1]);
assert(homeSigs.length >= 3, 'expected Easy Visit engines were not found');
homeSigs.forEach((source, index) => {
  assert(source.includes("return todayLocal() + '|'"), `Easy Visit home signature ${index + 1} does not invalidate on account-day rollover`);
});

const dateStart = frontsync.indexOf('function viewingDate()');
const dateEnd = frontsync.indexOf('function canonicalList', dateStart);
assert(dateStart >= 0 && dateEnd > dateStart, 'Visit patient-selector date owner is missing');
const viewingDate = frontsync.slice(dateStart, dateEnd);
assert(viewingDate.includes('return todayKey();'), 'Visit patient selector is not account-local-current-day owned');
assert(!viewingDate.includes('.mlsnu-date') && !viewingDate.includes('.as-date'), 'Assistant date inputs can still change Visit day');
assert(!viewingDate.includes('input[type="date"]'), 'an unrelated visible date input can still change Visit day');

console.log('PASS Visit has one automatic account-local day owner with rollover invalidation and Calendar/Assistant isolation');
