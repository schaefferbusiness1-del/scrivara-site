'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');
const doctorStart = source.indexOf('  function renderDoctor() {');
const doctorEnd = source.indexOf('\n  function syncTx() {', doctorStart);
assert(doctorStart >= 0 && doctorEnd > doctorStart, 'canonical doctor renderer missing');
const doctor = source.slice(doctorStart, doctorEnd);

assert.strictEqual((doctor.match(/id="ez3Transcript"/g) || []).length, 1,
  'canonical doctor room must render exactly one editable transcript');
assert(!doctor.includes('ez3flTranscript'), 'doctor renderer still references the retired satellite transcript');
assert(doctor.includes("var txTop = $('ez3Transcript'), txReal = $('transcript');"),
  'canonical transcript is not synchronized to the real visit transcript');
assert(doctor.includes('txTop.oninput = function ()'), 'typed/pasted transcript edits are not preserved by the stable transcript node');
assert(doctor.includes('wireVisitQuickTools()'), 'quick tools are not wired in the same synchronous render');

console.log('PASS Easy transcript continuity: one canonical editable transcript with synchronous tools');
