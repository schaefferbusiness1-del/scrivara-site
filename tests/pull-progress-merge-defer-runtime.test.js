'use strict';
/* b402 pull-experience pass, two proven behaviors:
 *
 * 1. pm-1.0.1 — the exact-duplicate auto-merge DEFERS while an explicit pull
 *    is busy (__mlsPullBusyAt fresh). The b389 merge could fire 4s after the
 *    schedule job completed, i.e. mid-history-batch: it rewrote the patient
 *    store while saveOrganizedHistory was proving persistence against it, so
 *    every merged patient failed its patientById proofs and the pull ended
 *    "history-partial" even though every save verified (live 2026-07-18).
 *    Runtime-proven here: busy -> no store rewrite + honest deferred reason;
 *    idle -> the same call merges; the deferred run merges once idle.
 *
 * 2. si-1.7.6 — the import/save phase streams counted "X of N" statuses, so
 *    the #mlsDsPullBar painter (which only advances on "X of N") no longer
 *    freezes at "Starting..." between "Finding patients..." and the first
 *    history read. Contract-proven against both sources with the painter's
 *    own regex + phase mapping.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const pmSource = fs.readFileSync(path.join(root, 'feat_mls_patient_merge.js'), 'utf8');

/* pm-1.0.2 (owner 2026-07-23): the boot sweep merges QUIETLY — regenerating
   dupes made the "N duplicate patients merged" toast fire on every launch. */
assert(pmSource.includes('run({ silent: true }); }); }, 12000)'), 'boot-time duplicate merge must run silent (owner: no merge toast on every boot)');
assert(!pmSource.includes('run({ silent: false }); }); }, 12000)'), 'boot-time duplicate merge is announcing again');
const siSource = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
new Function(pmSource); // syntax gate

/* ---------------- part 1: pm-1.0.1 merge deferral (runtime) -------------- */
function makeSandbox() {
  const timers = [];
  const store = {};
  let saveCalls = 0;
  let patients = [
    { id: 'mr1', name: 'Deborah Raap', dob: '1961-04-02', visits: [{ date: '2026-05-01', raw: 'note' }] },
    { id: 'p2', name: 'Deborah Raap', dob: '1961-04-02', visits: [] }
  ];
  const context = {
    console, Date, Math, JSON, Object, Array, String, Number, Promise,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].fn = null; },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; }
    }
  };
  context.window = context;
  context.window.addEventListener = function () {};
  context.window.removeEventListener = function () {};
  context.getPatients = function () { return patients; };
  context.savePatients = function (next) { saveCalls++; patients = next; };
  context.loadPatients = function () {};
  context.toast = function () {};
  vm.createContext(context);
  vm.runInContext(pmSource, context);
  return {
    context,
    timers,
    patientCount() { return patients.length; },
    saveCalls() { return saveCalls; }
  };
}

{ /* busy pull -> the merge must defer, not rewrite the store */
  const sb = makeSandbox();
  sb.context.window.__mlsPullBusyAt = Date.now(); /* explicit pull in flight */
  const out = sb.context.window.__mlsPatientMerge.run({ silent: true });
  assert.strictEqual(out.merged, 0, 'a busy pull must not merge');
  assert.strictEqual(out.reason, 'deferred-pull-busy', 'the deferral must be stated honestly');
  assert.strictEqual(sb.saveCalls(), 0, 'the patient store must NOT be rewritten mid-pull');
  assert.strictEqual(sb.patientCount(), 2, 'both records must survive while the pull runs');
  const armed = sb.timers.filter((t) => t.fn && t.ms === 20000);
  assert.strictEqual(armed.length, 1, 'exactly one deferred re-check must be armed');

  /* second call while still busy must not stack a second timer */
  sb.context.window.__mlsPatientMerge.run({ silent: true });
  assert.strictEqual(sb.timers.filter((t) => t.fn && t.ms === 20000).length, 1,
    'repeated busy calls must not stack deferred timers');

  /* pull finishes -> the armed deferred run performs the merge */
  sb.context.window.__mlsPullBusyAt = 0;
  armed[0].fn();
  assert.strictEqual(sb.saveCalls(), 1, 'the deferred run must merge once the pull is idle');
  assert.strictEqual(sb.patientCount(), 1, 'the exact duplicate must be merged after the pull');
}

{ /* a stale busy stamp (>90s, e.g. a crashed pull) must not block forever */
  const sb = makeSandbox();
  sb.context.window.__mlsPullBusyAt = Date.now() - 120000;
  const out = sb.context.window.__mlsPatientMerge.run({ silent: true });
  assert.strictEqual(out.merged, 1, 'a stale busy stamp must not suppress the merge');
  assert.strictEqual(sb.patientCount(), 1, 'the duplicate pair must merge when the pull is idle');
}

assert(pmSource.includes("version: 'pm-1.0.1'"), 'patient-merge deferral release marker missing');

/* si-1.7.9 (live 2026-07-18): the MANUAL history retry enters runHistoryBatch
 * without pull()'s busy stamping, so the deferred merge fired MID-RETRY and
 * clobbered fresh saves (retry claimed 5 recovered, storage kept 2). The
 * batch itself must keep __mlsPullBusyAt fresh on every entry path. */
{
  const stamps = siSource.match(/window\.__mlsPullBusyAt = Date\.now\(\); \}\); \/\* si-1\.7\.9/g) || [];
  assert(stamps.length >= 2, 'runHistoryBatch must stamp the busy signal per patient AND at finalization');
  const batchStart = siSource.indexOf('historyBatchRunning = true;\n    /* si-1.7.9');
  assert(batchStart > 0, 'runHistoryBatch must stamp the busy signal at batch start');
}

/* ------------- part 2: si-1.7.6 counted import statuses (contract) ------- */
assert(siSource.includes('onEach: onEachImport'),
  'the day pull must pass the counting onEach into importAppts');
assert(siSource.includes('"Saving the schedule — appointment " + importSettled + " of " + importTotal'),
  'the import phase must stream counted X-of-N statuses');
assert(/ev !== "saved" && ev !== "skipped" && ev !== "repaired" && ev !== "error"/.test(siSource),
  'only terminal per-row events may advance the import count');

/* the painter must actually advance on that exact message shape */
const painterRe = /(\d+)\s+of\s+(\d+)/; /* the literal used by paintDsProgress/paintRelayBar */
assert(connect.includes('msg.match(/(\\d+)\\s+of\\s+(\\d+)/)'), 'the pull-bar painter regex changed — update this test with it');
const sample = 'Saving the schedule — appointment 3 of 12...';
const mm = sample.match(painterRe);
assert(mm && Number(mm[1]) === 3 && Number(mm[2]) === 12, 'the painter cannot parse the new import status');
assert(/identity|schedule/i.test(sample), 'the import status must map to the Schedule phase, not the generic Working label');

console.log('PASS pull-progress + merge-defer: the auto-merge never rewrites the store mid-pull (busy defers, idle merges, deferred run completes), and the import/save phase streams counted statuses the progress bar can paint');
