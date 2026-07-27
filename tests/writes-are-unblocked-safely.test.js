'use strict';

/* WRITES ARE UNBLOCKED - SAFELY (b745, owner: "remove any blockers that
 * prevent me from writing. There should be no blockers."). The Opus write-gate
 * audit traced 42 gates; five were BUGS that refused legitimate writes. This
 * suite pins each fix AND the safety gates that stay. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const wf = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const eev = fs.readFileSync(path.join(root, 'feat_mls_exact_encounter_verify.js'), 'utf8');

/* ---- 1. a hand-typed note is real: writable AND savable ---- */
assert(/emrReadyText\(\)\{[\s\S]{0,700}?nb\.style\.display!=='none' \|\| String\(nb\.value\|\|''\)\.trim\(\)/.test(app),
  'emrReadyText reads the note box whenever it HAS text - visibility is not authorship');
assert(app.includes("if(!emrReadyText()){ try{ toast('Type or generate the note first"),
  'the review entry gates on note TEXT, not on how it came to exist');
assert(!/if\(!currentSoap\)\{ try\{ toast\('Generate the note first/.test(app),
  'the old generation-only refusal is gone');
const saveAt = app.indexOf('function saveCurrentNote(');
const save = app.slice(saveAt, saveAt + 900);
assert(saveAt > 0 && /nb && \(nb\.style\.display!=='none' \|\| String\(nb\.value\|\|''\)\.trim\(\)\)/.test(save),
  'saving honors typed text with the same predicate');

/* ---- 2. the exact-visit pre-gate only binds HISTORICAL writes ---- */
assert(/exactVisitBlocked = opts\.requireExpectedVisit === true &&/.test(wf),
  'only a historical write must pre-name its encounter; live writes let the probe discover and lock it');
assert(/if \(!suppliedAppointment\) \{[\s\S]{0,900}?athenaAppointmentIdFromImportIndex\(pidS, dayRows\[0\]\.id, suppliedDate\)/.test(wf),
  'a supplied date+provider context still resolves its appointment id from the day ledger (exactly-one or empty)');

/* ---- 3. walk-ins DEMOTE to unscheduled, never refuse generation ---- */
assert(connect.includes('is proceeding as an UNSCHEDULED visit - no schedule row is locked'),
  'the !S.appt lane demotes with a visible warning (the owner\'s standing ruling)');
assert(!connect.includes('MLS blocked \' + label + \' because no scheduled visit is locked'),
  'the hard generation refusal for unscheduled patients is gone');

/* ---- 4. the read-only verify affordance is alive again ---- */
assert(eev.includes("var MIN_EXTENSION_VERSION = '3.0.23';") && !/APPROVED_EXTENSION_BUILD_ID = '2\.9\.44/.test(eev),
  'the dead exact-build pin is gone; a minimum version is the bar');
assert(/\^\\d\+\(\?:\\\.\\d\+\)\{1,3\}\\\+core-sha256:\[0-9a-f\]\{64\}\$/.test(eev),
  'an UNSTAMPED dev build still cannot verify - the stamped-release shape is required');

/* ---- 5. the send floor is non-empty, not 30 chars ---- */
assert(connect.includes("if (noteText().trim().length < 1) { toast('Type or generate the note first"),
  'a short legitimate note is sendable');
assert(!/function requestSend\(a\) \{\n    if \(noteText\(\)\.trim\(\)\.length < 30\)/.test(connect),
  'the arbitrary 30-char floor is gone from every copy');

/* ---- THE SAFETY GATES THAT STAY, by name ---- */
assert(/_athenaGuardBoundEditor/.test(app), 'bound-editor wrong-chart guards stay');
assert(/An immutable local patient ID plus the exact Athena name, DOB, and MRN are required/.test(wf),
  'identity fail-closed stays');
assert(/MLS will not guess an encounter/.test(wf), 'historical writes still never guess an encounter');
assert(/validatedUnifiedProbe/.test(wf) && /one-use confirmation token/.test(wf),
  'the read-only probe + one-use token remain the arbiters of every write');
assert(/requireExactScheduledBinding/.test(connect), 'the cross-patient conflict block stays');

console.log('PASS writes are unblocked safely: typed notes real, live writes probe-bound, walk-ins demote, verify affordance alive, short notes sendable - and every wrong-chart gate still stands');
