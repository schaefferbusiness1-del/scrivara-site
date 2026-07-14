'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const portal = read('patient-portal.html');
const booking = read('easy-book.html');
const staff = read('feat_mls_staff_hub.js');
const connect = read('mls-connect.js');

assert(portal.includes('Object.assign({}, j.patient || j'), 'patient history lists must be merged with identity data');
assert(portal.includes('j.booking_url'), 'patient booking must accept the server-issued practice calendar URL');
assert(portal.includes('while(ans && typeof ans === "object")'), 'record answers must never render as [object Object]');
assert(booking.includes('https://www.google.com/maps/search/?api=1&query='), 'Google booking button needs a working Maps fallback');
assert(!booking.includes("else { g.href='#'; }"), 'Google booking button must never be a dead # link');
assert(staff.includes("'/api/team/nurses'"), 'staff hub must provision nursing logins');
assert(staff.includes('Nursing workspace') && staff.includes('legal, payments, and Athena write actions are unavailable'), 'nursing UI must clearly state its restricted role');
assert(connect.includes('feat_mls_staff_hub.js?v=20260714sh2'), 'staff hub changes need a production cache-buster');

console.log('PASS patient portal, booking, and nursing account contracts');
