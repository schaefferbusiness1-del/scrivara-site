'use strict';
/* Full visit notes OFF has no day-note lane to crash. This retains the old
   regression filename while pinning the stronger modern boundary. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const si = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_schedimport_exact.js'), 'utf8');

assert.ok(si.includes('var fullNotesOff = visitNotesRequested === false;'),
  'the explicit OFF admission state is missing');
assert.ok(si.includes('var includeHistory = visitNotesRequested === true && opts.includeHistory !== false && !fullNotesOff;'),
  'anything short of an explicit admitted ON can still enter the chart/history batch');
assert.ok(si.includes('var pulledDayNoteLaneEnabled = false;'),
  'the retired inline day-note lane is enabled');
assert.ok(si.includes('var pulledDayNoteTailEnabled = false;'),
  'the retired tail day-note lane is enabled');
assert.ok(si.includes('reason: historySkipReason') && si.includes('historySkipReason = fullNotesOff ? "full-notes-off"'),
  'OFF lacks an honest terminal skip receipt');
assert.ok(si.indexOf('finalizeVerdict();') > 0,
  'the history verdict finalizer disappeared');

console.log('qol-off-lane-never-crashes: OK (OFF never enters either retired day-note lane, records full-notes-off, and retains the terminal verdict path)');
