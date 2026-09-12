'use strict';

/* Synthetic-only contract for the 3.0.121 scheduling-note site bridge.  No
   browser, extension, network, or real patient data is involved. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = n => fs.readFileSync(path.join(root, n), 'utf8');
const sched = read('1p-feat_mls_schedimport_exact.js');
const prep = read('feat_mls_opnote_prep.js');
const integrity = read('feat_mls_opnote_integrity.js');
let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }
function between(source, a, b) { const i = source.indexOf(a), j = source.indexOf(b, i); ok(i >= 0 && j > i, 'source marker '+a); return source.slice(i, j); }

const storage = Object.create(null);
const context = {
  JSON, String, Number, Object, Array, RegExp,
  localStorage: { getItem: k => storage[k] || null, setItem: (k, v) => { storage[k] = String(v); } },
  safe(fn, fallback) { try { const v = fn(); return v == null ? fallback : v; } catch (_) { return fallback; } },
  isFn: f => typeof f === 'function',
  firstField(row, keys) { for (const k of keys) if (row && row[k] != null && String(row[k]).trim()) return String(row[k]).trim(); return ''; },
  window: { uns: k => 'acct::'+k }
};
context.window.window = context.window;
vm.runInNewContext(between(sched, '  /* ===== b1262 exact scheduling-note bridge', '  /* ===== end b1262 exact scheduling-note bridge'), context, { filename: 'b1262-note-bridge.js' });
const bridge = context.window.__mlsSchedulingNoteBridge;
ok(bridge && bridge.maxChars === 16000, 'bridge exposes the 16k contract');
function receipt(note, status = 'captured', complete = true, source = 'schedule-reason-field') {
  return { version: 1, source, status, complete, chars: String(note || '').length };
}

const exactText = 'Case 42\nLine two: 1,250 mg?';
const rows = bridge.normalizeBatch([
  { name: 'Same Name', appointmentId: 'apt-a', schedulingNote: exactText, schedulingNoteReceipt: receipt(exactText) },
  { name: 'Same Name', appointmentId: 'apt-b', schedulingNote: '', schedulingNoteReceipt: receipt('', 'empty', true, 'schedule-reason-snapshot') }
]);
eq(rows[0].schedulingNote, exactText, 'captured text preserves punctuation, numbers, and newlines');
eq(rows[0].reason, exactText, 'complete nonempty text remains in the legacy reason field');
eq(rows[1].schedulingNoteReceipt.status, 'empty', 'complete empty receipt survives normalization');
bridge.record(rows[0], 'local-a'); bridge.record(rows[1], 'local-b');
const calendar = [{ name: 'Same Name', appointment_id: 'apt-a', patient_external_id: 'local-a' }, { name: 'Same Name', appointment_id: 'apt-b', patient_external_id: 'local-b' }];
bridge.apply(calendar);
eq(calendar[0].schedulingNote, exactText, 'exact appointment/patient A receives only A note');
eq(calendar[1].schedulingNoteReceipt.status, 'empty', 'same-name appointment B retains its own empty receipt');
ok(!calendar[1].schedulingNote, 'complete empty stays empty without borrowing A text');

const conflict = bridge.normalizeBatch([
  { name: 'Same Name', appointmentId: 'apt-conflict', schedulingNote: 'first', schedulingNoteReceipt: receipt('first') },
  { name: 'Same Name', appointmentId: 'apt-conflict', schedulingNote: 'second', schedulingNoteReceipt: receipt('second') }
]);
eq(conflict[0].schedulingNoteReceipt.status, 'conflicting-fields', 'duplicate exact id conflict is fail-closed');
eq(conflict[1].schedulingNote, '', 'conflict never chooses a text value');
eq(conflict[0].reason, '', 'conflict cannot leak a selected legacy reason copy');
bridge.record(conflict[0], 'local-c'); bridge.record(conflict[1], 'local-c');
const conflictCalendar = [{ appointment_id: 'apt-conflict', patient_external_id: 'local-c' }]; bridge.apply(conflictCalendar);
eq(conflictCalendar[0].schedulingNoteReceipt.status, 'conflicting-fields', 'stored conflict remains incomplete on merge');
const mismatchCalendar = [{ appointment_id: 'apt-a', patient_external_id: 'local-other' }]; bridge.apply(mismatchCalendar);
eq(mismatchCalendar[0].schedulingNoteReceipt.status, 'appointment-unbound', 'patient mismatch refuses even with the same appointment id');
const aliasConflictCalendar = [{ appointment_id: 'apt-a', patient_external_id: 'local-a', _mlsTargetPatientId: 'local-other' }]; bridge.apply(aliasConflictCalendar);
eq(aliasConflictCalendar[0].schedulingNoteReceipt.status, 'appointment-unbound', 'contradictory local-patient aliases fail closed');

for (const status of ['appointment-unbound', 'row-changed', 'source-not-rendered', 'source-unreadable', 'snapshot-truncated', 'snapshot-unreadable', 'too-large', 'conflicting-fields']) {
  const one = bridge.normalizeBatch([{ appointmentId: 'apt-'+status, schedulingNote: 'not admitted', schedulingNoteReceipt: receipt('not admitted', status, false) }])[0];
  eq(one.schedulingNoteReceipt.complete, false, status+' remains incomplete');
  eq(one.schedulingNote, '', status+' never retains text');
}
const atLimit = 'x'.repeat(16000), overLimit = 'x'.repeat(16001);
eq(bridge.normalizeBatch([{ appointmentId: 'apt-limit', schedulingNote: atLimit, schedulingNoteReceipt: receipt(atLimit) }])[0].schedulingNote.length, 16000, '16,000 characters are preserved exactly');
const tooLarge = bridge.normalizeBatch([{ appointmentId: 'apt-over', schedulingNote: overLimit, schedulingNoteReceipt: receipt(overLimit) }])[0];
eq(tooLarge.schedulingNoteReceipt.status, 'too-large', 'over-limit note receives an honest incomplete receipt');
eq(tooLarge.schedulingNoteReceipt.chars, 16001, 'over-limit receipt retains the observed source length');

const badVersion = bridge.normalizeBatch([{ appointmentId: 'apt-version', schedulingNote: 'unsafe', schedulingNoteReceipt: { version: 99, source: 'schedule-reason-field', status: 'captured', complete: true, chars: 6 } }])[0];
eq(badVersion.schedulingNoteReceipt.status, 'source-unreadable', 'unknown receipt version is rejected, not laundered');
eq(badVersion.schedulingNote, '', 'unknown receipt version cannot expose text');
const badChars = bridge.normalizeBatch([{ appointmentId: 'apt-chars', schedulingNote: 'unsafe', schedulingNoteReceipt: { version: 1, source: 'schedule-reason-field', status: 'captured', complete: true, chars: 99 } }])[0];
eq(badChars.schedulingNoteReceipt.status, 'source-unreadable', 'receipt character mismatch is rejected');

const updated = bridge.normalizeBatch([{ appointmentId: 'apt-a', schedulingNote: 'updated', schedulingNoteReceipt: receipt('updated') }])[0];
bridge.record(updated, 'local-a');
const updatedCalendar = [{ appointment_id: 'apt-a', patient_external_id: 'local-a' }]; bridge.apply(updatedCalendar);
eq(updatedCalendar[0].schedulingNote, 'updated', 'a later authoritative value replaces the old same-patient value');
const laterIncomplete = bridge.normalizeBatch([{ appointmentId: 'apt-a', schedulingNote: 'partial', schedulingNoteReceipt: receipt('partial', 'snapshot-truncated', false) }])[0];
bridge.record(laterIncomplete, 'local-a');
const incompleteCalendar = [{ appointment_id: 'apt-a', patient_external_id: 'local-a' }]; bridge.apply(incompleteCalendar);
eq(incompleteCalendar[0].schedulingNoteReceipt.status, 'snapshot-truncated', 'a later incomplete read replaces stale complete text with unknown');
ok(!incompleteCalendar[0].schedulingNote, 'a later incomplete read does not expose the stale complete value');
const recovered = bridge.normalizeBatch([{ appointmentId: 'apt-a', schedulingNote: 'recovered', schedulingNoteReceipt: receipt('recovered') }])[0];
bridge.record(recovered, 'local-a');
const recoveredCalendar = [{ appointment_id: 'apt-a', patient_external_id: 'local-a' }]; bridge.apply(recoveredCalendar);
eq(recoveredCalendar[0].schedulingNote, 'recovered', 'a corrected later pull self-heals an incomplete stored value');

const aliasRow = bridge.normalizeBatch([{ appt_id: 'apt-alias', schedulingNote: 'alias note', schedulingNoteReceipt: receipt('alias note') }])[0];
bridge.record(aliasRow, 'local-alias');
const aliasCalendar = [{ apptId: 'apt-alias', patient_external_id: 'local-alias' }]; bridge.apply(aliasCalendar);
eq(aliasCalendar[0].schedulingNote, 'alias note', 'supported appointment aliases share one exact namespace');
const encounterOnly = bridge.normalizeBatch([{ encounterId: 'apt-alias', schedulingNote: 'wrong namespace', schedulingNoteReceipt: receipt('wrong namespace') }])[0];
bridge.record(encounterOnly, 'local-alias');
const encounterCalendar = [{ encounter_id: 'apt-alias', patient_external_id: 'local-alias' }]; bridge.apply(encounterCalendar);
ok(!Object.prototype.hasOwnProperty.call(encounterCalendar[0], 'schedulingNote'), 'encounter ids cannot collide with appointment ids');
storage['acct::mlsSchedulingNoteV1'] = JSON.stringify({ v: 1, rows: {
  'appointment:apt-tampered': { patientId: 'local-a', schedulingNote: 'tampered', schedulingNoteReceipt: { version: 99, source: 'evil', status: 'captured', complete: true, chars: 8 } }
} });
const tamperedCalendar = [{ appointmentId: 'apt-tampered', patient_external_id: 'local-a' }]; bridge.apply(tamperedCalendar);
eq(tamperedCalendar[0].schedulingNoteReceipt.status, 'source-unreadable', 'persisted receipts are revalidated before application');
ok(!tamperedCalendar[0].schedulingNote, 'malformed persisted receipt cannot restore text or replace reason');

const prepContext = { S: x => x == null ? '' : String(x), trim: x => String(x == null ? '' : x).replace(/^\s+|\s+$/g, '') };
vm.runInNewContext(between(prep, '  function schedulingAppointmentId', '\n\n  /* =========================================================================\n   * (2)(3) PROVIDER'), prepContext, { filename: 'b1262-opnote-admission.js' });
const admitted = prepContext.admitSchedulingNote({ patientId: 'local-a' }, { patientId: 'local-a', appointmentId: 'apt-a', schedulingNote: exactText, schedulingNoteReceipt: receipt(exactText) });
ok(admitted.schedulingNoteKnown && admitted.schedulingNote === exactText, 'complete captured note enters exact OP-note context');
const emptyAdmitted = prepContext.admitSchedulingNote({ patientId: 'local-b' }, { patientId: 'local-b', appointmentId: 'apt-b', schedulingNote: '', schedulingNoteReceipt: receipt('', 'empty', true, 'schedule-reason-snapshot') });
ok(emptyAdmitted.schedulingNoteKnown, 'complete empty receipt is known, not unknown');
const refused = prepContext.admitSchedulingNote({ patientId: 'local-a' }, { patientId: 'local-a', appointmentId: 'apt-a', schedulingNote: '', schedulingNoteReceipt: receipt('', 'source-unreadable', false) });
ok(!refused.schedulingNoteKnown && !Object.prototype.hasOwnProperty.call(refused, 'schedulingNote'), 'incomplete receipt is unknown and cannot claim an empty field');
const aliasRefused = prepContext.admitSchedulingNote({ patientId: 'local-a' }, { patientId: 'local-a', patient_external_id: 'local-a', _mlsTargetPatientId: 'local-other', appointmentId: 'apt-a', schedulingNote: exactText, schedulingNoteReceipt: receipt(exactText) });
ok(!aliasRefused.schedulingNoteKnown, 'OP-note admission refuses contradictory patient aliases');

const next = prepContext.nextExactPatientAppointment([
  { patient_external_id: 'local-a', appointmentId: 'later-day', appt_date: '2026-09-20', start_local: '8:00 AM', reason: 'later day', schedulingNote: 'later day note' },
  { patient_external_id: 'local-a', appointmentId: 'later-time', appt_date: '2026-09-13', start_local: '2:00 PM', reason: 'later time', schedulingNote: 'later time note' },
  { patient_external_id: 'local-a', appointmentId: 'next-exact', appt_date: '2026-09-13', start_local: '8:30 AM', reason: 'next exact procedure', schedulingNote: 'next exact note' },
  { patient_external_id: 'local-other', appointmentId: 'wrong-patient', appt_date: '2026-09-12', start_local: '7:00 AM', reason: 'wrong patient', schedulingNote: 'wrong patient note' }
], 'local-a', '2026-09-12', Date.parse('2026-09-12T06:00:00'));
eq(next.appointmentId, 'next-exact', 'single-patient flow selects the earliest exact timestamp, not array order or latest day');
eq(next.reason, 'next exact procedure', 'procedure comes from the selected exact appointment');
eq(next.schedulingNote, 'next exact note', 'scheduling note comes from the same selected exact appointment');
const skipsIdless = prepContext.nextExactPatientAppointment([
  { patient_external_id: 'local-a', appt_date: '2026-09-13', start_local: '8:00 AM', reason: 'idless' },
  { patient_external_id: 'local-a', appointmentId: 'stable', appt_date: '2026-09-13', start_local: '9:00 AM', reason: 'stable' }
], 'local-a', '2026-09-12', Date.parse('2026-09-12T06:00:00'));
eq(skipsIdless.appointmentId, 'stable', 'exact selection refuses an appointment with no stable appointment id');
const skipsElapsed = prepContext.nextExactPatientAppointment([
  { patient_external_id: 'local-a', appointmentId: 'elapsed', appt_date: '2026-09-13', start_local: '8:00 AM' },
  { patient_external_id: 'local-a', appointmentId: 'upcoming', appt_date: '2026-09-14', start_local: '8:00 AM' }
], 'local-a', '2026-09-13', Date.parse('2026-09-13T12:00:00'));
eq(skipsElapsed.appointmentId, 'upcoming', 'next appointment excludes an already elapsed appointment today');

const integrityContext = { S: x => x == null ? '' : String(x) };
vm.runInNewContext(between(integrity, '  function admittedSchedulingNote', '\n  function generationStage'), integrityContext, { filename: 'b1262-integrity-admission.js' });
ok(integrityContext.admittedSchedulingNote(admitted), 'active integrity owner admits complete exact context');
ok(!integrityContext.admittedSchedulingNote(refused), 'active integrity owner refuses unknown context');
ok(!integrityContext.admittedSchedulingNote(Object.assign({}, admitted, { schedulingNote: 'x'.repeat(16001) })), 'active integrity owner re-enforces the 16k ceiling');

ok(sched.includes('schedulingNoteNormalizeBatch(parsed)'), 'canonical parsed schedule response is normalized');
ok(sched.includes('schedulingNoteApply(window._calAppts)'), 'account-local store is merged only onto calendar rows');
ok(prep.includes('rowPatientId !== trim(out.patientId)'), 'OP-note admission requires exact local patient ownership');
ok(prep.includes('bridge.apply(all)'), 'ordinary op-note preparation rehydrates persisted scheduling receipts');
ok(integrity.includes('untrusted clinical data only'), 'system prompt treats scheduling text as data, never instructions');
ok(integrity.includes('JSON.stringify(scheduleNote.note)'), 'scheduling text is structurally delimited before the model sees it');
ok(!/name.*schedulingNote.*match/i.test(sched), 'bridge has no name-based scheduling-note merge');
console.log(`PASS b1262 scheduling-note bridge: ${checks} synthetic checks for exact-id merge, receipts, bounds, and OP-note admission`);
