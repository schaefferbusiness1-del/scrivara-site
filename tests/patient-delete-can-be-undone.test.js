'use strict';

/* ptundo-1.0.0 (2026-08-28) — a mis-click destroyed uploaded documents forever.
 *
 * The delete control is a hover-revealed trash on a patient-list row, one confirm
 * away, and the patient's uploaded DOCUMENTS - labs, scans, prior records - live
 * on the patient object, so they are destroyed with it. There was no undo of any
 * kind: not a toast action, not a trash, not a restore.
 *
 * These are executed properties:
 *   1. undo restores the EXACT record, id and documents included
 *   2. it restores through savePatients, NOT upsertPatient - upsertPatient is
 *      wrapped by the F5 dedup gate whose CREATE path could fold the record into a
 *      same-name chart and hand it a different id. An undo must put back exactly
 *      what was removed.
 *   3. it re-binds exactly the notes that were unassigned, and no others
 *   4. it queues BOTH the patient and the notes for server sync, or the restore is
 *      local-only and dies at the next hydration - the same defect class as the
 *      delete it is undoing
 *   5. with nothing to undo it refuses instead of throwing
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html'), 'ScribeFlow.html', path.join('cloned', 'index.html')];

function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing ' + name);
  const j = src.indexOf('{', i);
  let d = 0, e = -1;
  for (let k = j; k < src.length; k++) {
    const c = src[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) { e = k + 1; break; } }
  }
  assert.ok(e > 0, 'unbalanced ' + name);
  return src.slice(i, e);
}

let lanes = 0;
for (const shell of SHELLS) {
  const file = path.join(root, shell);
  if (!fs.existsSync(file)) continue;
  lanes++;
  const src = fs.readFileSync(file, 'latin1');

  function run(snap, patients, notes) {
    const saved = { patients: null, notes: null };
    const synced = { patients: [], notes: [] };
    let retried = 0, upsertCalls = 0;
    const fn = new Function(
      'getPatients', 'savePatients', 'getNotes', 'saveNotes', 'backendMode', 'bkToken',
      '_pendingSyncAdd', '_pendingBackupAdd', '_retryPendingBackups',
      'renderPatients', 'renderProfile', 'renderPatientBar', 'toast', '_hidePatientUndo',
      'upsertPatient', 'snap',
      'var _mlsLastPtDelete=snap;\n' + lift(src, 'undoLastPatientDelete') +
      '\nreturn undoLastPatientDelete;'
    )(
      () => patients, a => { saved.patients = a; },
      () => notes, a => { saved.notes = a; },
      () => true, () => 'tok',
      id => synced.patients.push(id),
      id => synced.notes.push(id),
      () => { retried++; },
      () => {}, () => {}, () => {}, () => {}, () => {},
      () => { upsertCalls++; },
      snap
    );
    const rv = fn();
    return { rv, saved, synced, retried, upsertCalls };
  }

  /* ---- 1 + 2 + 4. a real undo ---- */
  {
    const doc = { id: 'd1', name: 'labs.pdf' };
    const snap = {
      patient: { id: 'pt-1', name: 'Jane Roe', dob: '1970-01-01', docs: [doc], problems: 'X' },
      noteIds: ['n1', 'n2'], at: Date.now()
    };
    const notes = [
      { id: 'n1', patientId: '' }, { id: 'n2', patientId: '' }, { id: 'n3', patientId: 'other' }
    ];
    const r = run(snap, [{ id: 'someone-else' }], notes);

    eq(r.rv, true, shell + ': undoLastPatientDelete reported failure on a valid snapshot');
    ok(r.saved.patients, shell + ': undo never wrote the patient list back');
    const back = r.saved.patients.filter(p => p && p.id === 'pt-1')[0];
    ok(back, shell + ': the deleted patient was NOT restored');
    eq(back.id, 'pt-1', shell + ': the restored record has a different id than the one deleted');
    ok(back.docs && back.docs.length === 1 && back.docs[0].id === 'd1',
      shell + ': the patient\'s uploaded DOCUMENTS were not restored - those are destroyed with the ' +
      'record and are the reason an undo exists');
    eq(back.problems, 'X', shell + ': the restored chart lost its clinical text');
    eq(r.upsertCalls, 0,
      shell + ': undo restored via upsertPatient - that is wrapped by the F5 dedup gate, whose ' +
      'CREATE path can fold the record into a same-name chart and give it a different id');
    ok(r.saved.patients.filter(p => p && p.id === 'someone-else').length === 1,
      shell + ': undo dropped an unrelated patient from the list');
    ok(r.synced.patients.indexOf('pt-1') >= 0,
      shell + ': the restored patient was not queued for server sync - the restore would be ' +
      'local-only and die at the next hydration, exactly like the delete bug it undoes');

    /* ---- 3. notes: exactly the ones unassigned, and no others ---- */
    eq(notes[0].patientId, 'pt-1', shell + ': an unassigned note was not re-bound on undo');
    eq(notes[1].patientId, 'pt-1', shell + ': a second unassigned note was not re-bound');
    eq(notes[2].patientId, 'other', shell + ': undo re-bound a note belonging to ANOTHER patient');
    assert.deepStrictEqual(r.synced.notes.slice().sort(), ['n1', 'n2'],
      shell + ': the re-bound notes were not queued for server sync');
    ok(r.retried > 0, shell + ': the note sync flush was never kicked');
  }

  /* ---- 5. nothing to undo ---- */
  for (const empty of [null, {}, { patient: null }, { patient: {} }]) {
    const r = run(empty, [], []);
    eq(r.rv, false, shell + ': undo claimed success with no usable snapshot');
    eq(r.saved.patients, null, shell + ': undo wrote the patient list with nothing to restore');
  }

  /* the snapshot must be dropped with the bar, so a stale undo cannot resurrect
     a patient the doctor deleted long ago and has moved on from */
  const offer = lift(src, '_offerPatientUndo');
  ok(/setTimeout\(/.test(offer) && /_hidePatientUndo\(\)/.test(offer),
    shell + ': the undo offer never expires - a stale snapshot could resurrect a patient later');
  const hide = lift(src, '_hidePatientUndo');
  ok(/_mlsLastPtDelete\s*=\s*null/.test(hide),
    shell + ': hiding the undo bar does not clear the snapshot, so undo stays armed invisibly');
}

ok(lanes > 0, 'no shells found - this suite tested nothing');
console.log('PASS patient-delete-can-be-undone: ' + checks + ' checks across ' + lanes +
  ' shell(s) - undo restores the exact record with its documents, bypasses the dedup wrapper, ' +
  're-binds only the notes it unassigned, queues both for server sync, and expires');
