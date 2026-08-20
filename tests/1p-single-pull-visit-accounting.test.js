'use strict';

/* spv-1.0.0 — a single-patient pull must ACCOUNT for visit notes.
 *
 * Measured live on patient 7618711 (2026-08-19, r23): a single-patient pull
 * (pvrPullOne -> pullPatientChartViaAssist) landed chart facts and one "Athena
 * chart import" encounter, printed
 *
 *     "Saved <name>'s Athena history to their MLS chart"
 *
 * and TWENTY MINUTES LATER the patient still had zero visits.
 *
 * Two defects, both proven at HEAD before this suite existed:
 *
 *   1. The visit leg had THREE silent exits and a receipt on none of them:
 *      the "pull full visit notes" preference being off, the patient record
 *      not resolving, and the reader resolving nothing (cv.run resolves
 *      undefined when it is busy or cannot resolve a patient). All three
 *      returned the pull's own `true` and said nothing, so all three were
 *      indistinguishable from success.
 *   2. The b121 visits-backfill can never rescue a single pull. It is
 *      edge-triggered on __mlsDayHistoryPull.state.running going true->false,
 *      which only the DAY engines set. A single pull produces no edge, so the
 *      patient is never enqueued — which is why every observed skip reason
 *      ('all-already-have-visits', 'pull-returned-no-patients') came from day
 *      pulls.
 *
 * This suite EXECUTES the shipped spv-1.0.0 block out of 1p-mls-connect.js —
 * not a re-typed copy of it — and proves every branch publishes a receipt that
 * says what actually happened, that a landing of zero visits is never
 * described as saved history, and that the patient a single pull could never
 * enqueue now gets enqueued explicitly.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const twin = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

/* ---- the false-green is gone from BOTH shells ---- */
{
  const FALSE_GREEN = "Saved '+pullTarget.name+'’s Athena history to their MLS chart";
  ok(shell.indexOf(FALSE_GREEN) < 0, '1pScribeFlow.html must no longer claim "Athena history" for a chart-facts pull');
  ok(twin.indexOf(FALSE_GREEN) < 0, '1p/index.html must no longer claim "Athena history" for a chart-facts pull');
  const HONEST = "Athena chart facts — problems, medications, allergies and history. Checking for their prior visit notes";
  ok(shell.indexOf(HONEST) > 0, '1pScribeFlow.html must say exactly what was saved');
  ok(twin.indexOf(HONEST) > 0, '1p/index.html must say exactly what was saved');
  /* the step counter the status-line contract pins is untouched */
  ok(shell.indexOf("'step 3 of 3'") > 0, 'the step 3 of 3 stamp must survive');
}

/* ---- the wrapper routes through the accounting leg ---- */
ok(/return spvVisitLeg\(p, target\)\.then\(/.test(connect),
  'the single-pull wrapper must route its visit leg through spvVisitLeg');
ok(!/if \(!enabled\(\) \|\| !p \|\| !\(typeof window\._hasImportedHistory/.test(connect),
  'the old three-way silent early return must be gone');

/* ---- EXECUTE the shipped block ---- */
const start = connect.indexOf('/* ===== spv-1.0.0');
const end = connect.indexOf('/* ===== end spv-1.0.0');
ok(start > 0 && end > start, 'the spv-1.0.0 block must be present in 1p-mls-connect.js');
const block = connect.slice(start, end);

function harness(opts) {
  opts = opts || {};
  const toasts = [];
  const enqueued = [];
  const patients = opts.patients || [];
  const window = {
    getPatients: () => patients,
    _hasImportedHistory: () => opts.imported !== false,
    __mlsVisitModel: { getVisits: p => (p && p.visits) || [] },
    __mlsVisitsBackfill: opts.backfill === false ? null : { runOnce: (names, o) => { enqueued.push({ names, o }); return true; } }
  };
  const toast = (m, k) => toasts.push({ m: String(m), k: String(k || '') });
  const enabled = () => opts.enabled !== false;
  const api = {
    runForPatient: opts.runForPatient || (() => Promise.resolve({ ok: true, visits: 0 }))
  };
  const factory = new Function('window', 'toast', 'enabled', 'api',
    block + '\n; return { spvVisitLeg: spvVisitLeg, spvVisitCount: spvVisitCount, spvEnqueue: spvEnqueue };');
  return { fns: factory(window, toast, enabled, api), toasts, enqueued, window };
}

const TARGET = { patientId: 'p-7618711', name: 'Synthetic Patient Spv', dob: '07/08/1968', mrn: '7618711' };
function patient(visits) {
  return { id: 'p-7618711', name: 'Synthetic Patient Spv', dob: '07/08/1968', mrn: '7618711', athenaId: '7618711', visits: visits || [] };
}
/* No receipt may ever describe a zero-visit outcome as saved history. */
function neverClaimsHistory(r) {
  if (r.added > 0) return true;
  return !/Saved .* Athena history/i.test(String(r.message));
}

(async function run() {

  /* ---- 1. the preference is off: honest, and it names the toggle ---- */
  {
    const h = harness({ enabled: false, patients: [patient([])] });
    const r = await h.fns.spvVisitLeg(patient([]), TARGET);
    ok(r.ok === false && r.reason === 'preference-off', 'a preference-off skip must be recorded, not silent');
    ok(/were NOT read/.test(r.message), 'the receipt must say the visit notes were not read');
    ok(/Pull full visit notes/.test(r.message) && /Settings/.test(r.message),
      'it must name the exact setting the doctor has to change');
    ok(neverClaimsHistory(r), 'a preference-off pull must never claim saved history');
    ok(h.toasts.length === 1, 'the verdict must be said out loud exactly once');
  }

  /* ---- 2. the patient record does not resolve ---- */
  {
    const h = harness({ patients: [] });
    const r = await h.fns.spvVisitLeg(null, TARGET);
    ok(r.ok === false && r.reason === 'patient-not-resolved', 'an unresolved patient must be recorded');
    ok(/Nothing was faked/.test(r.message), 'the refusal must say nothing was faked');
    ok(neverClaimsHistory(r), 'an unresolved patient must never claim saved history');
  }

  /* ---- 3. the chart import cannot be verified against the record ---- */
  {
    const h = harness({ imported: false, patients: [patient([])] });
    const r = await h.fns.spvVisitLeg(patient([]), TARGET);
    ok(r.ok === false && r.reason === 'chart-import-not-verified', 'an unverified import must be recorded');
    ok(neverClaimsHistory(r), 'an unverified import must never claim saved history');
  }

  /* ---- 4. visits actually land: the count is MEASURED, not assumed ---- */
  {
    const landed = patient([]);
    const h = harness({
      patients: [landed],
      runForPatient: () => { landed.visits = [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }]; return Promise.resolve({ ok: true, visits: 3 }); }
    });
    const r = await h.fns.spvVisitLeg(landed, TARGET);
    ok(r.ok === true && r.reason === 'read', 'a real landing must be recorded as read');
    ok(r.visitsBefore === 0 && r.visitsAfter === 3 && r.added === 3,
      'the receipt must carry the measured before/after (' + r.visitsBefore + '->' + r.visitsAfter + ')');
    ok(/3 prior visit notes/.test(r.message), 'the count said out loud must be the measured one');
    ok(h.enqueued.length === 0, 'a successful read must not enqueue a retry');
  }

  /* ---- 5. nothing comes back: queued, and NEVER called saved ---- */
  {
    const empty = patient([]);
    const h = harness({ patients: [empty], runForPatient: () => Promise.resolve({ ok: false, reason: 'visits-reader-returned-nothing' }) });
    const r = await h.fns.spvVisitLeg(empty, TARGET);
    ok(r.ok === false, 'a zero-visit landing is not a success');
    ok(r.added === 0 && r.visitsAfter === 0, 'the receipt must record that nothing arrived');
    ok(r.queued === true, 'the patient a single pull can never edge-trigger must be ENQUEUED explicitly');
    ok(h.enqueued.length === 1, 'exactly one backfill enqueue (got ' + h.enqueued.length + ')');
    ok(h.enqueued[0].o && h.enqueued[0].o.force === true, 'the enqueue must be forced — the edge watcher will never fire for a single pull');
    ok(h.enqueued[0].names[0].athenaId === '7618711', 'the enqueue must carry the patient identity');
    ok(/NO prior visit notes came back/.test(r.message), 'the receipt must say plainly that nothing came back');
    ok(/queued for a retry/.test(r.message), 'a queued retry must be visible to the doctor');
    ok(neverClaimsHistory(r), 'a zero-visit pull must never claim saved history');
  }

  /* ---- 6. no backfill available: still honest, and does not promise a retry ---- */
  {
    const empty = patient([]);
    const h = harness({ patients: [empty], backfill: false, runForPatient: () => Promise.resolve({ ok: false, reason: 'x' }) });
    const r = await h.fns.spvVisitLeg(empty, TARGET);
    ok(r.queued === false, 'with no backfill loaded nothing may claim to be queued');
    ok(/still missing/.test(r.message), 'it must say the visit history is still missing');
    ok(!/queued for a retry/.test(r.message), 'it must not promise a retry that cannot happen');
  }

  /* ---- 7. the reader throws ---- */
  {
    const empty = patient([]);
    const h = harness({ patients: [empty], runForPatient: () => Promise.reject(new Error('bridge timeout')) });
    const r = await h.fns.spvVisitLeg(empty, TARGET);
    ok(r.ok === false && r.reason === 'reader-failed', 'a thrown reader must be recorded, not swallowed');
    ok(/bridge timeout/.test(r.error), 'the receipt must keep the real error');
    ok(r.queued === true, 'a failed read must queue the retry');
    ok(neverClaimsHistory(r), 'a failed read must never claim saved history');
  }

  /* ---- 8. visits were already there: no double count, no false new ---- */
  {
    const has = patient([{ id: 'v1' }, { id: 'v2' }]);
    const h = harness({ patients: [has], runForPatient: () => Promise.resolve({ ok: true, visits: 0 }) });
    const r = await h.fns.spvVisitLeg(has, TARGET);
    ok(r.ok === true && r.reason === 'already-present', 'pre-existing visits must be reported as already present');
    ok(r.added === 0 && r.visitsAfter === 2, 'nothing may be counted as newly added');
    ok(/already here/.test(r.message), 'the receipt must say they were already here');
    ok(h.enqueued.length === 0, 'a patient who already has visits must not be enqueued');
  }

  console.log('PASS 1p single-pull visit accounting: ' + checks + ' checks — every branch of the single-pull visit leg now publishes a measured receipt, a zero-visit landing is never called saved history, the patient the b121 falling-edge watcher can never see is enqueued explicitly, and both shells stopped claiming "Athena history" for a chart-facts pull');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
