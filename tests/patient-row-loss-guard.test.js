'use strict';

/* Owner report 2026-07-24: "6 saves not confirmed. Bernard P Brooks,
 * Christopher Fink, Lindsey Bray, Luz Maria Lemus, and 2 more were not found
 * in the saved store after saving."
 *
 * Live probe of the owner's store (b524, 1481 patients) found EVERY named
 * patient present — Bernard P Brooks p_sched_ibuwu5, Christopher Fink
 * p_sched_157yjhf, Lindsey Bray p_sched_1b2vbd, Luz Maria Lemus
 * p_sched_1fmgvk0 — all source 'athena-schedule'. So the saves DID land: a
 * write removed them before the verifier looked, and a later pass re-created
 * them.
 *
 * Root cause: savePatients(arr) is a WHOLESALE replacement. Any bulk writer
 * that materialized its array before a fresh upsert (render/sweep/organize
 * paths all do) writes every row created since straight back out of
 * existence. upsertPatient keys by exact id, so the row cannot be "folded" —
 * it is simply deleted, then re-created by the next pass.
 *
 * The guard: a write may only remove rows the caller could plausibly have
 * seen. Rows written within the recent window are carried forward unless the
 * caller explicitly authorizes removals ({allowRemovals:true} — purge and
 * delete-patient). Fails SAFE: a carried row is removed again by the next
 * authorized pass, but a lost chart is unrecoverable.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function extractBlock(src, startMarker, endMarker, label) {
  const start = src.indexOf(startMarker);
  assert(start >= 0, label + ': start marker not found: ' + startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert(end > start, label + ': end marker not found: ' + endMarker);
  return src.slice(start, end);
}

function buildStore(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const block = extractBlock(src,
    'function _mlsPtsDecode(raw){',
    '/* Remove every patient MLS imported from Athena',
    file + ' store layer');

  const mem = Object.create(null);
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem(k, v) { mem[k] = String(v); },
    removeItem(k) { delete mem[k]; },
    key(i) { return Object.keys(mem)[i] || null; },
    get length() { return Object.keys(mem).length; }
  };
  const win = {};
  const ctx = vm.createContext({
    window: win, console, Date, JSON, Math, Object, Array, String, Number, isFinite,
    setTimeout, clearTimeout,
    localStorage,
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    __mlsLZ: { compressToUTF16: s => s, decompressFromUTF16: s => s },
    __mlsActivePtSeedKey: () => 'acct::activePtSeed',
    uns: k => 'acct::' + k,
    toast() {},
    backendMode: () => false,
    bkToken: () => '',
    syncPatientToServer() {},
    CustomEvent: function () {},
    Event: function () {}
  });
  ctx.globalThis = ctx;
  vm.runInContext(
    block + '\nwindow.savePatients=savePatients;window.getPatients=getPatients;' +
    'this.api={getPatients:getPatients,savePatients:savePatients,upsertPatient:upsertPatient,win:window};',
    ctx, { filename: file + ':store' });
  return ctx.api;
}

function names(list) { return list.map(p => p.name).sort(); }

/* 1. THE LIVE FAILURE — a stale bulk write must not delete a just-saved row. */
function staleBulkWriteKeepsFreshRows(api) {
  api.savePatients([{ id: 'p_old', name: 'Existing Patient', updated: Date.now() - 600000 }]);

  // A render/sweep path materializes the roster here...
  const staleSnapshot = api.getPatients();
  assert.deepStrictEqual(names(staleSnapshot), ['Existing Patient']);

  // ...then the pull saves four schedule rows (exactly the owner's four).
  [['p_sched_ibuwu5', 'Bernard P Brooks'], ['p_sched_157yjhf', 'Christopher Fink'],
   ['p_sched_1b2vbd', 'Lindsey Bray'], ['p_sched_1fmgvk0', 'Luz Maria Lemus']]
    .forEach(([id, name]) => api.upsertPatient({ id, name, source: 'athena-schedule' }));
  assert.strictEqual(api.getPatients().length, 5, 'all four schedule rows must save');

  // ...and only now does the stale writer flush its pre-pull array.
  api.savePatients(staleSnapshot);

  const after = api.getPatients();
  assert.deepStrictEqual(names(after),
    ['Bernard P Brooks', 'Christopher Fink', 'Existing Patient', 'Lindsey Bray', 'Luz Maria Lemus'],
    'a bulk write materialized BEFORE these saves must never delete them (owner 2026-07-24: "6 saves not confirmed")');

  const log = api.win.__mlsPtsRowGuardLog || [];
  assert(log.length >= 1, 'a carried-forward row must be logged so the loss is observable');
  const flat = JSON.stringify(log);
  ['Bernard', 'Brooks', 'Fink', 'Bray', 'Lemus'].forEach(n =>
    assert(flat.indexOf(n) < 0, 'the row-guard log must stay PHI-free (no patient names): ' + n));
}

/* 2. Deliberate removals still work — purge and delete-patient opt in. */
function authorizedRemovalStillRemoves(api) {
  api.savePatients([{ id: 'p_keep', name: 'Keep Me' }, { id: 'p_drop', name: 'Drop Me' }]);
  const remaining = api.getPatients().filter(p => p.id !== 'p_drop');
  api.savePatients(remaining, undefined, { allowRemovals: true });
  assert.deepStrictEqual(names(api.getPatients()), ['Keep Me'],
    'an explicitly authorized removal (delete patient / purge) must still remove the row');
}

/* 3. Settled rows stay removable without the flag — dedupe/merge sweeps that
      drop an older duplicate keep working unchanged. */
function settledRowsRemainRemovable(api) {
  const old = Date.now() - 600000;
  api.savePatients([{ id: 'p_a', name: 'Alpha', updated: old }, { id: 'p_dupe', name: 'Dupe', updated: old }]);
  api.savePatients([{ id: 'p_a', name: 'Alpha', updated: old }]);
  assert.deepStrictEqual(names(api.getPatients()), ['Alpha'],
    'a row the writer could plausibly have seen (settled) must stay removable without the flag');
}

/* 4. The guard never duplicates: a carried row must not double up when the
      same write repeats (idempotent under retry). */
function carryForwardNeverDuplicates(api) {
  api.savePatients([]);
  const stale = api.getPatients();
  api.upsertPatient({ id: 'p_fresh', name: 'Fresh Row' });
  api.savePatients(stale);
  api.savePatients(stale);
  const ids = api.getPatients().map(p => p.id);
  assert.deepStrictEqual(ids, ['p_fresh'], 'repeated stale writes must not duplicate the carried row');
}

const liveApi = buildStore('ScribeFlow.html');
staleBulkWriteKeepsFreshRows(liveApi);
authorizedRemovalStillRemoves(buildStore('ScribeFlow.html'));
settledRowsRemainRemovable(buildStore('ScribeFlow.html'));
carryForwardNeverDuplicates(buildStore('ScribeFlow.html'));

/* 5. The staging shell is an inert dev snapshot — it must keep refusing to
      overwrite the production packed key (it has no batch/row-guard layer). */
const staging = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
const stagingSave = extractBlock(staging, 'function savePatients(arr){', '\nfunction getActivePtId', 'staging save');
assert(/MLSZ1\|/.test(stagingSave) && /return;/.test(stagingSave),
  'the staging snapshot must keep refusing to overwrite the production packed patient key');

console.log('PASS patient row-loss guard: stale bulk writes cannot delete fresh saves, authorized removals still remove, settled rows stay removable, carry-forward is idempotent, staging stays inert');
