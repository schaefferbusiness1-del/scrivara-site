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
 *   1. The visit leg had silent exits when the patient record did not resolve
 *      or the reader resolved nothing (cv.run resolves undefined when it is
 *      busy or cannot resolve a patient). A later contract clarified that the
 *      Full Notes preference governs every visit-body reader, including a
 *      single-patient pull. OFF must be reported as an intentional scope, not
 *      mislabeled as a failed read or enqueued into an impossible retry.
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
ok(/visitNotesSkipped: true, reason: 'visit-notes-off'/.test(connect),
  'the wrapper must preserve the intentional Full Notes OFF result instead of collapsing it to broad success');
ok(!/if \(!enabled\(\) \|\| !p \|\| !\(typeof window\._hasImportedHistory/.test(connect),
  'the old three-way silent early return must be gone');
ok(/var actionOk = r === true \|\| !!\(r && r\.ok === true\)/.test(shell),
  'the visible pull owner must keep an intentional chart-facts success green');
ok(/result && result\.visitNotesSkipped === true/.test(shell) && /result && result\.visitNotesSkipped === true/.test(twin),
  'both shipped shells must distinguish Full Notes OFF before the broad chart+prior-notes success claim');

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
  const readerCalls = [];
  const reader = opts.runForPatient || (() => Promise.resolve({ ok: true, visits: 0 }));
  const api = {
    runForPatient: function () {
      const args = Array.prototype.slice.call(arguments);
      readerCalls.push(args);
      return reader.apply(null, args);
    }
  };
  const factory = new Function('window', 'toast', 'enabled', 'api',
    block + '\n; return { spvVisitLeg: spvVisitLeg, spvVisitCount: spvVisitCount, spvEnqueue: spvEnqueue };');
  return { fns: factory(window, toast, enabled, api), toasts, enqueued, readerCalls, window };
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

  /* ---- 1. Full Notes OFF: chart facts succeed, no history failure/retry is
     invented, and the receipt tells the clinician how to request details. ---- */
  {
    const landed = patient([]);
    const h = harness({ enabled: false, patients: [landed], runForPatient: () => Promise.resolve({ ok: true, skipped: 'preference-off' }) });
    const r = await h.fns.spvVisitLeg(landed, TARGET);
    ok(r.ok === true && r.reason === 'visit-notes-off' && r.added === 0,
      'Full Notes OFF must be an intentional successful chart-facts scope');
    ok(h.readerCalls.length === 1 && h.readerCalls[0][2] && h.readerCalls[0][2].singlePull === true,
      'the single-patient visit leg must still ask the shared reader for an explicit scope receipt');
    ok(/Full visit notes are OFF/.test(r.message), 'the receipt must explain why prior details were not requested');
    ok(/Settings|Refresh full visit history/.test(r.message), 'the receipt must give a clear way to request full details');
    ok(r.queued === false && h.enqueued.length === 0, 'OFF must never enqueue a retry that cannot read visit bodies');
    ok(neverClaimsHistory(r), 'the OFF receipt must not use the retired broad "Athena history" claim');
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
    ok(/background retry started/.test(r.message), 'a started background retry must be visible to the doctor');
    ok(/still incomplete until MLS shows a completed receipt/.test(r.message), 'the retry message must not imply completion before a receipt exists');
    ok(neverClaimsHistory(r), 'a zero-visit pull must never claim saved history');
  }

  /* ---- 6. no backfill available: still honest, and does not promise a retry ---- */
  {
    const empty = patient([]);
    const h = harness({ patients: [empty], backfill: false, runForPatient: () => Promise.resolve({ ok: false, reason: 'x' }) });
    const r = await h.fns.spvVisitLeg(empty, TARGET);
    ok(r.queued === false, 'with no backfill loaded nothing may claim to be queued');
    ok(/still missing/.test(r.message), 'it must say the visit history is still missing');
    ok(!/background retry started/.test(r.message), 'it must not promise a retry that cannot happen');
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

  /* ---- 9. the field-read adapter must not turn chart-facts success into a
     false "prior visit notes pulled" claim when Full Notes is OFF. Execute the
     shipped adapter rather than checking message text alone. ---- */
  {
    const a = shell.indexOf('  function unifyFieldRead() {');
    const b = shell.indexOf('  /* --------------------------------------- PARK THE LINE', a);
    ok(a > 0 && b > a, 'the shipped field-read adapter must be extractable');
    const adapter = shell.slice(a, b);
    const said = [];
    const win = {
      __mlsChartField: { read: () => Promise.resolve({ ok: false, reason: 'legacy' }) },
      pullPatientChartViaAssist: () => Promise.resolve({ ok: true, chartSaved: true, visitNotesSkipped: true, reason: 'visit-notes-off' })
    };
    const install = new Function('window', 'isFn', 'safe', adapter + '\nreturn unifyFieldRead;')(
      win,
      f => typeof f === 'function',
      (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } }
    );
    ok(install() === true, 'the shipped field-read adapter must install');
    const adapted = await win.__mlsChartField.read({}, m => said.push(String(m)), null);
    ok(adapted.ok === true && adapted.visitNotesSkipped === true && adapted.reason === 'visit-notes-off',
      'Full Notes OFF must remain a successful chart-facts result with explicit visit-note scope');
    ok(said.some(m => /Full visit notes are OFF/.test(m)), 'the adapter must say why prior note bodies were not read');
    ok(!said.some(m => /prior visit notes pulled/.test(m)), 'the adapter must never claim prior notes were pulled when they were skipped');
  }

  console.log('PASS 1p single-pull visit accounting: ' + checks + ' checks — every branch of the single-pull visit leg now publishes a measured receipt, a zero-visit landing is never called saved history, the patient the b121 falling-edge watcher can never see is enqueued explicitly, and both shells stopped claiming "Athena history" for a chart-facts pull');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
