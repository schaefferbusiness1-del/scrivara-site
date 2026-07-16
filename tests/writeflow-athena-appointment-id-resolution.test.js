'use strict';

/* wf2-1.7.0: the calendar row's `id` is the BACKEND appointment row id, not
 * Athena's appointment id (live 2026-07-16: Adam Schaeffer backend 3794 vs
 * Athena 52585118). Both are numeric, so the backend id passed every shape
 * gate and would only fail at the live probe as context-mismatch — a
 * guaranteed first-click failure. The unified manifest's exact-visit context
 * must prefer the REAL Athena appointment id resolved from the day's
 * schedule-import index, and must keep the prior value when the index has no
 * exactly-one match (fail-closed at the probe, never a guess).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');
assert(src.includes("var VERSION = 'wf2-1.7.0'"), 'writeflow version must be wf2-1.7.0');

function makeContext(indexRows, calAppts) {
  const store = new Map();
  if (indexRows) store.set('acct:schedImportIndexV1::2026-07-16', JSON.stringify({ v: 1, rows: indexRows }));
  const localStorage = {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const elementStub = () => ({
    style: {}, dataset: {}, setAttribute: () => {}, getAttribute: () => null, removeAttribute: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, appendChild: () => {}, remove: () => {},
    querySelector: () => null, querySelectorAll: () => [], classList: { add: () => {}, remove: () => {}, contains: () => false },
    textContent: '', innerHTML: ''
  });
  const document = {
    readyState: 'complete',
    addEventListener: () => {}, removeEventListener: () => {},
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null,
    createElement: elementStub,
    body: elementStub(), head: elementStub(), documentElement: elementStub()
  };
  const window = {
    _calAppts: calAppts,
    uns: n => `acct:${n}`,
    addEventListener: () => {}, removeEventListener: () => {},
    document, localStorage,
    location: { origin: 'https://mlsscribe.com' },
    postMessage: () => {}
  };
  window.window = window;
  return vm.createContext({
    window, document, localStorage,
    setInterval: () => 1, clearInterval: () => {},
    setTimeout: () => 1, clearTimeout: () => {},
    MutationObserver: function () { return { observe: () => {}, disconnect: () => {} }; },
    console
  });
}

const ADAM_ROW = {
  id: '3794', patient_external_id: 'mr85n5sdkd6o', name: 'Adam J Schaeffer', dob: '03/24/2006',
  provider: 'Matthew Schaeffer, MD', appt_date: '2026-07-16', day_local: '2026-07-16',
  start_at: '2026-07-16T19:30:00.000Z', status: 'booked'
};
const PATIENT = { id: 'mr85n5sdkd6o', name: 'Adam J Schaeffer', dob: '03/24/2006', mrn: '7833832' };
const NOTE_OPTS = { patient: PATIENT, sections: [{ key: 'note', text: 'Reviewed test note body.' }] };

function manifestFor(indexRows, calAppts) {
  const ctx = makeContext(indexRows, calAppts);
  vm.runInContext(src, ctx, { filename: 'feat_mls_writeflow.js' });
  const wf = ctx.window.__mlsWriteFlow;
  assert(wf && wf.installed, 'writeflow failed to install in the VM');
  return wf.buildUnifiedManifest(NOTE_OPTS);
}

// 1. Exactly-one index match: the manifest visit carries the REAL Athena id.
{
  const manifest = manifestFor({
    'appointment-id:52585118': { state: 'done', patientId: 'mr85n5sdkd6o', backendAppointmentId: '3794', appt_date: '2026-07-16' },
    'appointment-id:52585119': { state: 'done', patientId: 'p_other', backendAppointmentId: '3795', appt_date: '2026-07-16' }
  }, [ADAM_ROW]);
  assert.strictEqual(manifest.visit.appointmentId, '52585118', 'exact-visit context must carry the Athena appointment id, not the backend row id');
  assert.strictEqual(manifest.visit.visitDate, '7/16/2026');
  const note = manifest.rows.find(r => r.id === 'write-note');
  assert(note && note.capability === 'ready', 'write-note must be ready with full identity + resolved visit');
}

// 2. No index (or no match): prior behavior preserved — backend row id stays,
//    and the live probe remains the fail-closed arbiter.
{
  const manifest = manifestFor(null, [ADAM_ROW]);
  assert.strictEqual(manifest.visit.appointmentId, '3794', 'without an index match the prior calendar-row id must be preserved');
}

// 3. Ambiguity fails closed to prior behavior: two index entries claiming the
//    same backend row + patient + day never produce a guessed id.
{
  const manifest = manifestFor({
    'appointment-id:52585118': { state: 'done', patientId: 'mr85n5sdkd6o', backendAppointmentId: '3794', appt_date: '2026-07-16' },
    'appointment-id:52585120': { state: 'done', patientId: 'mr85n5sdkd6o', backendAppointmentId: '3794', appt_date: '2026-07-16' }
  }, [ADAM_ROW]);
  assert.strictEqual(manifest.visit.appointmentId, '3794', 'ambiguous index entries must not pick an arbitrary Athena id');
}

// 4. A supplied explicit context always wins over the index.
{
  const ctx = makeContext({
    'appointment-id:52585118': { state: 'done', patientId: 'mr85n5sdkd6o', backendAppointmentId: '3794', appt_date: '2026-07-16' }
  }, [ADAM_ROW]);
  vm.runInContext(src, ctx, { filename: 'feat_mls_writeflow.js' });
  const manifest = ctx.window.__mlsWriteFlow.buildUnifiedManifest(Object.assign({}, NOTE_OPTS, {
    expectedContext: { visitDate: '2026-07-16', provider: 'Matthew Schaeffer, MD', appointmentId: '99999999' }
  }));
  assert.strictEqual(manifest.visit.appointmentId, '99999999', 'an explicitly supplied appointment id must never be overridden');
}

console.log('PASS unified manifest resolves the real Athena appointment id from the day import index; no-match/ambiguous/supplied paths preserved');
