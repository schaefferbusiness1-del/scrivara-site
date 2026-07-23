'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const portal = read('patient-portal.html');
const calendarBooking = read('booking.html');
const topbar = read('feat_mls_topbar_unify.js');
const connect = read('mls-connect.js');
const stagingConnect = read('mls-connect.staging.js');
const app = read('ScribeFlow.html');

assert(portal.includes('Object.assign({}, j.patient || j'), 'patient history lists must be merged with identity data');
assert(portal.includes('id="bookingBtn" type="button"') && portal.includes('openReq("appointment")'), 'patient booking must open the authenticated appointment-request flow');
assert(!portal.includes('j.booking_url') && !portal.includes('easy-book.html'), 'patient portal must reject arbitrary or retired booking URLs');
assert(portal.includes('while(ans && typeof ans === "object")'), 'record answers must never render as [object Object]');
assert(calendarBooking.includes('j.practice') && calendarBooking.includes('googleBusinessBtn'), 'calendar-connected booking must show the same practice identity and Google link');
assert(connect.includes("location.origin+'/booking.html?token='"), 'shared booking links must use the real practice calendar token');
assert(app.includes("'googleBusinessUrl'") && app.includes('Please add your clinic or practice name'), 'Settings/onboarding must sync and require the practice identity');
assert(!connect.includes('feat_mls_staff_hub.js'), 'held staff-account provisioning is still reachable in production');
assert(topbar.includes('Staff prep & Athena month pull') && topbar.includes('function activateStaffPrepFromMenu()'), 'Staff Prep and its month pull must remain in the single Menu-owned workflow');
assert(!topbar.includes('openStaffPrep:') && topbar.includes('mls:menu-staff-prep-request'), 'topbar still publishes a direct Staff opener instead of a private Menu intent');
const topbarAsset = "/feat_mls_topbar_unify.js?v=20260722tb111";
assert(connect.includes(topbarAsset), 'production does not load the accepted topbar account/role bridge');
assert(stagingConnect.includes(topbarAsset), 'staging topbar cache key drifted from the accepted production bridge');

console.log('PASS patient portal request, authenticated calendar booking, and Menu-owned Staff Prep contracts');
