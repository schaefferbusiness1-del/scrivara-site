'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '1p-mls-connect.js'), 'utf8');

/* Execute the freshness classifier from shipped bytes. Fixtures are synthetic
   and contain no real identity or clinical content. */
const freshnessStart = source.indexOf('var _noteTranscriptProof =');
const freshnessEnd = source.indexOf('function laneHintDefault(', freshnessStart);
assert(freshnessStart >= 0 && freshnessEnd > freshnessStart, 'note/transcript freshness classifier missing');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(source.slice(freshnessStart, freshnessEnd), ctx, { filename: 'paused-note-freshness.js' });

const NOTE = 'Synthetic saved note';
const TX = 'Synthetic restored transcript';
assert.strictEqual(ctx.noteTranscriptOutdated(TX, NOTE, 'patient-a', 'note:record-a'), false,
  'restoring a matching note/transcript state was called stale');
assert.strictEqual(ctx.noteTranscriptOutdated(TX, NOTE, 'patient-a', 'note:record-a'), false,
  'an unchanged paused visit was called stale');
assert.strictEqual(ctx.noteTranscriptOutdated(TX + ' added visit text', NOTE, 'patient-a', 'note:record-a'), true,
  'visit text appended after the note was not detected');
assert.strictEqual(ctx.noteTranscriptOutdated(TX + ' added visit text', 'Background-formatted synthetic note', 'patient-a', 'note:record-a'), true,
  'a background note formatting change laundered known stale visit text');
ctx._noteManualEditPending = true;
assert.strictEqual(ctx.noteTranscriptOutdated(TX + ' added visit text', 'Manually updated synthetic note', 'patient-a', 'note:record-a'), false,
  'an explicit manual note edit did not establish a fresh baseline');
assert.strictEqual(ctx.noteTranscriptOutdated(TX + ' added visit text plus more', 'Manually updated synthetic note', 'patient-a', 'note:record-a'), true,
  'visit text after the manual note edit was not detected');
ctx._noteGenerationAccepted = true;
assert.strictEqual(ctx.noteTranscriptOutdated(TX + ' added visit text plus more', 'Generated synthetic note', 'patient-a', 'note:record-a'), false,
  'a successful generation receipt did not establish a fresh baseline');
/* Same patient, different saved History record: record identity, not changed
   note bytes, proves this is a valid restore and establishes a new baseline. */
assert.strictEqual(ctx.noteTranscriptOutdated('Second restored transcript', 'Second saved note', 'patient-a', 'note:record-b'), false,
  'opening a second saved record for the same patient inherited stale state from the first record');
assert.strictEqual(ctx.noteTranscriptOutdated('Second restored transcript plus words', 'Second saved note', 'patient-a', 'note:record-b'), true,
  'the second saved record did not acquire its own transcript baseline');
assert.strictEqual(ctx.noteTranscriptOutdated('Second restored transcript plus words', 'Background format of second note', 'patient-a', 'note:record-b'), true,
  'background formatting of the same saved record cleared its stale transcript');
assert.strictEqual(ctx.noteTranscriptOutdated('Different synthetic transcript', NOTE, 'patient-b', 'note:record-c'), false,
  'switching patients inherited the prior patient freshness verdict');
assert.strictEqual(ctx.noteTranscriptOutdated('Different synthetic transcript plus words', NOTE, 'patient-b', 'note:record-c'), true,
  'the second patient did not acquire its own stale verdict');
assert.strictEqual(ctx.noteTranscriptOutdated('Different synthetic transcript plus words', NOTE, '', ''), true,
  'a transient blank patient repaint erased the mounted visit stale verdict');

/* Integration pins: paused recording stays reachable with an existing stale
   note, Generate is offered explicitly, and advisory dimming is backed by the
   click gate before the canonical review action. */
assert(source.includes("var rbResumable = !!(text.trim() && _recSessionSeen);"),
  'Resume recording depends on note presence/freshness instead of the prior recording session and preserved transcript');
assert(source.includes("setLaneHidden(gb, live || !text.trim() || (!!noteText.trim() && !noteTranscriptStale));"),
  'Generate is not offered when new visit text makes an existing note stale');
assert(source.includes("noteTranscriptStale ? '\\u2728 Update note with new visit text'"),
  'the regeneration action does not explain why the old note needs updating');
assert(source.includes("var NOTE_TRANSCRIPT_STALE_WHY = 'New visit text was added after this note was created. Update the note before reviewing.';"),
  'the stale-note explanation assumes the transcript came only from dictation');
assert(source.includes('<label for="ez3flTranscript">Visit transcript or doctor dictation</label><span>Record the visit, dictate your post-visit summary, or type/paste notes here.</span>') &&
       source.includes('id="ez3flTranscript" placeholder="Record the visit, dictate your post-visit summary, or type/paste notes here."'),
  'the flow-lane transcript does not explain its conversation, dictation, and typed/pasted input options');
assert(source.includes('<label for="ez3Transcript">Visit transcript or doctor dictation</label>') &&
       source.includes("S.phase === 'rec' ? '🔴 Recording now' : 'Record the visit, dictate your post-visit summary, or type/paste notes here.'") &&
       source.includes('id="ez3Transcript" placeholder="Record the visit, dictate your post-visit summary, or type/paste notes here."'),
  'the Easy transcript does not explain its conversation, dictation, and typed/pasted input options');
assert(source.includes('var rvBlocked = rvRun || !noteText.trim() || rvRefusal || noteTranscriptStale;'),
  'Review still appears available for a note that predates the latest visit text');
const reviewGate = source.slice(source.indexOf('function openReviewStep()'), source.indexOf('function setLaneHidden('));
assert(reviewGate.includes('noteTranscriptOutdated(genTranscriptText(), note.value, reviewPatientId, noteRecordIdentity())') &&
       reviewGate.includes('flowToast(NOTE_TRANSCRIPT_STALE_WHY'),
  'the Review click does not enforce the visible stale-note verdict');
assert(source.includes("ev.type === 'input' && ev.isTrusted === true && (t.id === 'noteBox' || t.id === 'ez3flNote')"),
  'background note changes can masquerade as explicit manual note edits');

console.log('PASS paused note transcript freshness: Resume remains visible, appended visit text requires explicit note update, Review refuses stale notes, and patient switches reset the baseline');
