/* deselect-releases-the-visit
 *
 * OWNER, 2026-07-29: "also this deslect button doesnt work."
 *
 * The chip was never the problem. dd-1.0.0 capture-delegates #ptDeselectChip
 * (because the patients pane re-renders under the click), and deselectPatient()
 * really does run: setActivePtId('') plus three re-renders plus a toast.
 * What it could not do was release the VISIT ENGINE. setActivePtId dispatches
 * 'mls:active-patient-changed', and the live Easy engine had NO listener for
 * that event — so S.appt and S.locked survived and the visit room kept
 * rendering the patient the app had just let go of. From the doctor's chair the
 * button did nothing.
 *
 * Same source-of-truth family as the b793 chart-link defect: two surfaces, one
 * of them never told.
 *
 * This suite pins the listener AND its guard rails, because the guards are the
 * part that must never regress: b791 fixed real data loss caused by a refused
 * switch running a visit reset anyway.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'latin1');

/* The listener must exist in the LIVE engine (first of the two copies). */
const first = src.indexOf("window.addEventListener('mls:active-patient-changed', function (evD)");
assert(first > 0, 'the live visit engine no longer listens for mls:active-patient-changed - Deselect cannot release it');

const live = src.indexOf("document.addEventListener('click', ez3Click, true);");
assert(live > 0, 'could not locate the live engine click wiring');
assert(first < live, 'the listener must be inside the LIVE engine copy, before its click wiring');

const block = src.slice(first, live);

/* 1. Keep a non-empty transition only when that patient owns this visit.
      A Recent/Profile A->B switch must release A's stale appointment, while
      calStartVisit's matching activation must keep its just-installed row. */
assert(/if \(nextId && visitBindingOwnsPatient\(nextId\)\) return;/.test(block),
  'the listener must keep a non-empty switch only when the new patient owns the visit binding');
assert(!/if \(nextId\) return;/.test(block),
  'a blanket non-empty return resurrects the live mixed-patient Start visit bug');

const ownerStart = src.indexOf('function visitBindingOwnsPatient(nextId)');
assert(ownerStart > 0 && ownerStart < first,
  'the live engine needs an explicit patient-to-visit ownership check before its lifecycle listener');
const ownerBlock = src.slice(ownerStart, first);
assert(/a\._pt && a\._patientId/.test(ownerBlock) && /a\.patient_external_id/.test(ownerBlock),
  'ownership must preserve both a search-picked patient row and an exact linked appointment activation');
assert(/patientById\(nextId\)/.test(ownerBlock) && /nameMatch\(a\.name, p\.name\)/.test(ownerBlock),
  'ownership needs the active local patient identity when an appointment has no exact external id');
assert(/ad && pd && ad !== pd/.test(ownerBlock),
  'same-name patients must not share a visit when both DOBs disagree');
assert(/S\.locked && S\.locked\.name/.test(ownerBlock) && /S\.locked\.dob/.test(ownerBlock),
  'an inconsistent Easy lock must not preserve an otherwise matching appointment');

assert(/hasOwnProperty\.call\(detail, 'patientId'\)/.test(block) && /window\.getActivePtId\(\)/.test(block),
  'events without identity detail must fall back to the canonical active patient instead of impersonating Deselect');

/* 2. Never mid-recording. This is the b791 lesson: a refusal must not reset. */
assert(/if \(isRecording\(\)\) \{/.test(block),
  'the listener must refuse while recording is active');
const recIdx = block.indexOf('isRecording()');
const clearIdx = block.indexOf('S.appt = null');
assert(recIdx > 0 && clearIdx > recIdx,
  'the recording guard must come BEFORE anything is cleared - a refused release must never reset the visit');
assert(/Recording is still running/.test(block),
  'a refused release must SAY why, not fail silently');

/* 3. It releases the engine's binding and returns home. */
assert(/S\.appt = null; S\.locked = null;/.test(block),
  'the release must drop both the row binding and the lock');
assert(/S\.screen = 'home'/.test(block),
  'after releasing the patient the engine must land on the home screen');

/* 4. It must NEVER touch note text — clearing a note is not deselecting. */
assert(!/noteBox|currentSoap|transcript|newVisit\(/.test(block),
  'the release must not touch note or transcript content - it clears the binding only');

/* 5. The chip itself is still capture-delegated (the re-render window). */
assert(src.indexOf("closest('#ptDeselectChip')") > 0,
  'dd-1.0.0 capture delegation for the Deselect chip is gone');

console.log('PASS patient lifecycle releases the visit: empty or mismatched non-empty transitions drop stale S.appt/S.locked, matching activations keep their row, recording refuses before any clear, and note/transcript text is never touched');
