'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const calendar = fs.readFileSync(path.join(root, 'feat_mls_calpro.js'), 'utf8');
const production = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const staging = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');

assert(connect.includes("avsQuick.id = 'ez3flAvs'"), 'the visible After-visit summary chip needs a stable context hook');
assert(connect.includes("setLaneDisabled(avsQuick, !avsPatient)"), 'After-visit summary must be disabled without an active patient');
assert(connect.includes("After-visit summary unavailable — open a patient first"), 'disabled After-visit summary needs a plain accessible reason');
assert(connect.includes("After-visit summary — open a patient"), 'disabled After-visit summary needs a visible reason');
assert(connect.indexOf("setLaneDisabled(avsQuick, !avsPatient)") < connect.indexOf("avsQuick.id = 'ez3flAvs'"), 'patient-context synchronization must exist before the chip mount path');
assert(connect.includes("var ab = $('mlsavsBtn'); if (ab) { ab.click(); }"), 'patient-selected After-visit summary must retain its real handler');

assert(calendar.includes('id="cpFrom"') && calendar.includes('aria-label="Range start date"'), 'calendar range start needs an exact accessible name');
assert(calendar.includes('id="cpTo"') && calendar.includes('aria-label="Range end date"'), 'calendar range end needs an exact accessible name');
assert(connect.includes('feat_mls_calpro.js?v=20260722cal14b'), 'the current calendar owner cache key must load the accessible controls');
assert(production.includes("s.src='mls-connect.js?v='"), 'production must load the current render owner');
assert(staging.includes("s.src='mls-connect.staging.js?v='+window.__MLS_AV"), 'staging must load its explicitly isolated staging bundle with the deterministic release token');
assert(!staging.includes("s.src='mls-connect.js?v='+window.__MLS_AV"), 'staging must not silently load the production render owner too');

console.log('PASS no-patient AVS context and calendar range accessible names are explicit');
