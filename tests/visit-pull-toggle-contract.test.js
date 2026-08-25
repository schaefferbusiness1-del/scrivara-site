'use strict';

/* "Full visit notes" toggle contract:
   - OFF is schedule/booking-only: zero patient chart and visit-body reads.
   - ON performs the verified full historical visit walk.
   - unset is admitted through the first-run choice and low-level readers fail
     closed until that choice is settled. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const importer = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

const gate = importer.indexOf('var pullVisitBodies = safe(function () {');
assert(gate >= 0, 'importer must resolve the pullVisitBodies preference');
const block = importer.slice(gate, gate + 1600);
/* qol-2.0: the importer consults the ONE resolver; per-site flipping is
   execution-proven in qol-resolver-four-sites. */
assert(/__mlsVisitNotesPref/.test(block), 'the importer must consult the ONE resolver, never raw keys');
assert(/choice\.on === true && choice\.state !== "unset"/.test(block), 'only an explicit ON governs the batch');
assert(block.indexOf('_pullBodiesOverride') >= 0 && block.indexOf('_pullBodiesOverride') < block.indexOf('__mlsVisitNotesPref'),
  'the per-pull override is consulted BEFORE the resolver');
const offGuard = importer.indexOf('if (!visitNotesRequested) {', gate);
const firstChartRead = importer.indexOf('dnReadChart(target', gate);
assert(offGuard > gate && firstChartRead > offGuard, 'the OFF guard does not run before the first chart read');
const offBlock = importer.slice(offGuard, importer.indexOf('if (historyBatchRunning)', offGuard));
assert(/receipt\.reason = "visit-notes-off"/.test(offBlock), 'OFF has no explicit receipt reason');
assert(/receipt\.requested = 0/.test(offBlock) && /receipt\.processed = 0/.test(offBlock),
  'OFF still claims history work was requested or processed');
assert(/receipt\.todayNoteFailures = 0/.test(offBlock), 'OFF can still fabricate a note failure');
assert(/var includeHistory = visitNotesRequested === true && opts\.includeHistory !== false && !fullNotesOff/.test(importer),
  'the public day pull does not require an admitted Full Notes choice or narrow explicit OFF to schedule-only');

assert(connect.includes("id=\"mlsDsVisitBodies\""), 'day-pull card must expose the Full visit notes toggle');
assert(connect.includes('r.write(tgl.checked === true)'), 'toggle must persist through the ONE resolver (which owns the namespaced keys)');
assert(connect.includes("tgl.checked = (r && typeof r.read === 'function') ? r.read().on === true : false"),
  'toggle UI must paint the resolved tri-state and fail closed OFF when the resolver is unavailable');

assert(connect.includes("id = 'mlsDsPullBar'"), 'day pull must render a progress bar');
assert(connect.includes('(\\d+)\\s+of\\s+(\\d+)') || /\(\\d\+\)\\s\+of\\s\+\(\\d\+\)/.test(connect) || connect.includes('match(/(\\d+)\\s+of\\s+(\\d+)/)'), 'progress bar must parse X of N counts');

console.log('PASS visit-pull toggle: explicit ON/OFF choice, OFF guarded before every chart/body read with an honest zero-work receipt, and visible day-pull progress');
