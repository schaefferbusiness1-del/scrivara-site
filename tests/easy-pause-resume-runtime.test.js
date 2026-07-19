'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');
const doctorStart = source.indexOf('  function renderDoctor() {');
const stopEnd = source.indexOf('\n  /* ---- send-to-Athena', doctorStart);
assert(doctorStart >= 0 && stopEnd > doctorStart, 'canonical visit workflow missing');
const workflow = source.slice(doctorStart, stopEnd);

assert(workflow.includes('id="ez3Stop"'), 'recording state has no canonical Stop control');
assert(workflow.includes('id="ez3Rec2"'), 'stopped state has no canonical Resume control');
assert(workflow.includes("on('ez3Stop', stopRecordingOnly)"), 'Stop is not wired to the canonical stop owner');
assert(workflow.includes("on('ez3Rec2', function () { if (!requireExactScheduledBinding(S.appt, 'recording')) return;"),
  'Resume does not preserve exact scheduled-patient binding');
assert(workflow.includes('function stopRecordingOnly()') && workflow.includes('c.click();'),
  'Stop does not proxy the real recorder');
assert(workflow.includes("S.phase = 'stopped'") && workflow.includes('Everything captured is saved below'),
  'successful stop does not preserve transcript/resume state');

console.log('PASS Easy pause/resume: canonical exact-patient controls preserve the combined transcript');
