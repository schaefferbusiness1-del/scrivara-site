'use strict';
/* dscope-1.0.0 control: A SAME-DAY SLICE NEVER EATS THE HISTORY.
 *
 * Codex red contract (ff0be547 scoped-visit-save) made executable here so
 * this branch's own gate enforces it: when the r4 receipt declares an
 * exact-day scope (onlyDate/scopeDate), saveVerifiedVisits persists through
 * ONE bulk call with reconcile:false, never invokes the destructive
 * full-history reconciliation, proves only THIS slice's rows (older verified
 * encounters stay byte-identical), refuses scope/target and per-row date
 * mismatches (no-substitution), and carries sameDayStatus onto the result.
 * A verified absence saves nothing and still reports 'absent'.
 *
 * Distinct fixture from Codex's contract (two older visits, a two-row slice,
 * refusal cases, and a mutation control) so the two suites cross-check
 * rather than duplicate. OLD BYTES FAIL BY NAME: reconcile ran, the census
 * threw visits-persistence-count-unproven, older rows died. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const start = source.indexOf('  function saveVerifiedVisits(target, r) {');
const end = source.indexOf('\n  async function runHistoryBatch', start);
assert.ok(start >= 0 && end > start, 'saveVerifiedVisits present');
const saveSource = source.slice(start, end).trim();
assert.ok(saveSource.includes('dscope'), 'the scoped-additive branch exists (dscope-1.0.0)');
assert.ok(saveSource.includes('reconcile: false, scopeDate: dscopeDate'), 'scoped persistence pins reconcile:false');

const DAY = '2026-08-25';
function visit(key, date, body) {
  return { encounterId: 'enc-' + key, sourceVisitKey: 'row:' + key, date, type: 'Office visit', raw: body || ('Body of ' + key + '. Assessment and plan documented.'), fullDetail: true };
}
function makeHarness(mutateReconcileOn) {
  const bulkCalls = [], reconcileCalls = [];
  const olderA = Object.assign(visit('older-a', '2026-03-01', 'Older A body, must survive byte-identical.'), { source: 'athena-schedule-history', identityVerified: true, identityBinding: 'pt-1', bodyComplete: true });
  const olderB = Object.assign(visit('older-b', '2026-05-15', 'Older B body, must survive byte-identical.'), { source: 'athena-schedule-history', identityVerified: true, identityBinding: 'pt-1', bodyComplete: true });
  const patient = { id: 'pt-1', name: 'Synthetic Two Rows', dob: '02/03/1955', mrn: 'SYN-2002', visits: [olderA, olderB] };
  const ctx = {
    console, Array, Date, JSON, Math, Number, Object, RegExp, String,
    isFn: v => typeof v === 'function',
    safe(fn, d) { try { return fn(); } catch (_) { return d; } },
    normMrn: v => String(v || '').replace(/[^a-z0-9]/gi, '').toUpperCase(),
    patientById: id => (String(id) === 'pt-1' ? patient : null)
  };
  ctx.rowMrn = v => ctx.normMrn(v && (v.mrn || v.athenaId));
  ctx.window = ctx;
  ctx._athenaHistoryProofMatches = (t, o) => t && t.patientId === 'pt-1' && o && o.chartName === patient.name && o.chartDob === patient.dob;
  ctx._patientHistoryCardCoverage = () => ({ complete: true, exactIdentityVerified: true, patientId: 'pt-1', cards: { problems: { populated: true }, meds: { populated: true }, allergies: { populated: true }, summary: { populated: true }, vitals: { populated: true }, history: { populated: true } } });
  function aliasesOf(v) { return [v.encounterId ? 'encounter|' + v.encounterId : '', v.sourceVisitKey ? 'source|' + v.sourceVisitKey : ''].filter(Boolean); }
  function store(raw, options) {
    const s = Object.assign({}, raw, { source: String(options && options.source || 'athena-schedule-history'), identityVerified: true, identityBinding: 'pt-1', bodyComplete: true, fullDetail: true });
    const inAl = aliasesOf(s);
    const at = patient.visits.findIndex(o => aliasesOf(o).some(a => inAl.includes(a)));
    if (at >= 0) patient.visits[at] = s; else patient.visits.push(s);
    return s;
  }
  ctx.__mlsVisitModel = {
    getVisits: () => patient.visits,
    addVisit: (_id, raw, options) => store(raw, options),
    saveVerifiedVisitBatch(id, rows, options) {
      bulkCalls.push({ n: rows.length, options: Object.assign({}, options) });
      rows.forEach(rw => store(rw, options));
      const doRec = mutateReconcileOn ? true : !!(options && options.reconcile);
      return { saved: rows.length, reconcile: doRec ? this.reconcileVerifiedAthenaVisits(id, rows) : null };
    },
    reconcileVerifiedAthenaVisits(_id, accepted) {
      reconcileCalls.push(accepted.length);
      const acc = accepted.map(aliasesOf);
      patient.visits = patient.visits.filter(o => !(/athena/i.test(String(o.source)) && o.identityVerified === true) || acc.some(c => aliasesOf(o).some(a => c.includes(a))));
      return { complete: true, removed: 0, retained: patient.visits.length };
    },
    organizePatientHistory: () => ({ ok: true })
  };
  ctx.__mlsCopyVisits = { _saveVisits(_p, _i, rows) { rows.forEach(rw => store(rw, { source: 'athena-copy' })); return rows.length; }, _visitIdentityAgrees: () => true };
  const fn = vm.runInNewContext('(' + saveSource + ')', ctx, { filename: 'scoped-save-additive', timeout: 2000 });
  return { patient, bulkCalls, reconcileCalls, fn, olderBodies: [olderA.raw, olderB.raw] };
}
function resp(visits, status, scope) {
  return { identity: { name: 'Synthetic Two Rows', dob: '02/03/1955', mrn: 'SYN-2002' }, visits, readerVersion: '2.9.22-visits-r4-two-stage',
    receipt: { complete: true, indexComplete: true, bodyComplete: true, fullDetail: true, stableKeysComplete: true, expected: visits.length, parsed: visits.length, administrativeRows: 0, onlyDate: scope || DAY, scopeDate: scope || DAY, sameDayStatus: status, authoritativeEmpty: visits.length === 0, noSubstitution: true, readerVersion: '2.9.22-visits-r4-two-stage' } };
}
const target = { patientId: 'pt-1', name: 'Synthetic Two Rows', dob: '02/03/1955', mrn: 'SYN-2002', scheduleDate: DAY };

let n = 0; const ok = m => { n++; console.log('ok ' + n + ' - ' + m); };

/* 1. two-row slice: one additive bulk call, zero reconcile, olders byte-identical */
{
  const h = makeHarness(false);
  const r = h.fn(target, resp([visit('slice-1', DAY), visit('slice-2', DAY)], 'saved'));
  assert.strictEqual(r.persistedVisits, 2, 'slice persisted count is the slice, not the universe');
  assert.strictEqual(r.scopedAdditive, true); assert.strictEqual(r.sameDayStatus, 'saved');
  assert.strictEqual(h.reconcileCalls.length, 0, 'destructive reconciliation ran on a scoped slice');
  assert.strictEqual(h.bulkCalls.length, 1, 'one bulk call'); assert.strictEqual(h.bulkCalls[0].options.reconcile, false, 'bulk requested reconcile');
  assert.strictEqual(h.patient.visits.length, 4, 'older rows died');
  assert.deepStrictEqual(h.patient.visits.slice(0, 2).map(v => v.raw), h.olderBodies, 'older bodies not byte-identical');
  ok('two-row slice additive, olders byte-identical');
}
/* 2. verified absence: zero saves, zero reconcile, status carried */
{
  const h = makeHarness(false);
  const r = h.fn(target, resp([], 'absent'));
  assert.strictEqual(r.persistedVisits, 0); assert.strictEqual(r.sameDayStatus, 'absent');
  assert.strictEqual(h.reconcileCalls.length, 0); assert.strictEqual(h.bulkCalls.length, 0, 'an absence must not issue an empty bulk write');
  assert.strictEqual(h.patient.visits.length, 2, 'absence deleted history');
  ok('verified absence saves nothing, reports absent, deletes nothing');
}
/* 3. no-substitution: a row dated off-scope refuses before any write */
{
  const h = makeHarness(false);
  assert.throws(() => h.fn(target, resp([visit('wrong-day', '2026-08-24')], 'saved')), /scoped-visit-date-mismatch/);
  assert.strictEqual(h.bulkCalls.length, 0, 'a refused slice wrote anyway');
  ok('off-scope row refuses before any write');
}
/* 4. frozen-target mismatch refuses */
{
  const h = makeHarness(false);
  assert.throws(() => h.fn(Object.assign({}, target, { scheduleDate: '2026-08-24' }), resp([visit('s', DAY)], 'saved')), /scoped-date-target-mismatch/);
  ok('scope vs frozen target mismatch refuses');
}
/* 5. MUTATION CONTROL: force the model to reconcile anyway - older rows die
      and case-1's invariants would all fail, proving the pins bite */
{
  const h = makeHarness(true);
  h.fn(target, resp([visit('slice-1', DAY)], 'saved'));
  assert.ok(h.reconcileCalls.length > 0 && h.patient.visits.length === 1,
    'mutation control failed to demonstrate the destructive path the pins guard against');
  ok('mutation control: forced reconcile visibly destroys history (the pins are load-bearing)');
}
/* 5b. dscope-1.0.1 (Codex blocker 4): a MISSING/invalid frozen target day
      refuses before any write - an exact-day slice may never proceed on
      an uncomparable target */
{
  const h = makeHarness(false);
  assert.throws(() => h.fn(Object.assign({}, target, { scheduleDate: '' }), resp([visit('s', DAY)], 'saved')), /scoped-frozen-day-missing/);
  assert.strictEqual(h.bulkCalls.length, 0, 'an uncomparable target wrote anyway');
  const h2 = makeHarness(false);
  assert.throws(() => h2.fn(Object.assign({}, target, { scheduleDate: 'garbage-day' }), resp([visit('s', DAY)], 'saved')), /scoped-frozen-day-missing/);
  assert.strictEqual(h2.bulkCalls.length, 0, 'an invalid target day wrote anyway');
  ok('empty/invalid frozen target day refuses before any write');
}
/* 5c. dscope-1.0.1: sameDayStatus passes a CLOSED validator - an alien
      receipt string never travels onto the result */
{
  const h = makeHarness(false);
  const r = h.fn(target, resp([visit('s', DAY)], 'totally-novel-status'));
  assert.strictEqual(r.sameDayStatus, 'saved', 'alien status with persisted rows must read saved (measured truth)');
  const h2 = makeHarness(false);
  const r2 = h2.fn(target, resp([], 'sneaky-absent-claim'));
  assert.strictEqual(r2.sameDayStatus, 'refused',
    'alien status with zero rows must read refused - absence is a proof, never a default');
  const h3 = makeHarness(false);
  const r3 = h3.fn(target, resp([], 'not-yet-available'));
  assert.strictEqual(r3.sameDayStatus, 'not-yet-available', 'the typed future classification survives the validator');
  assert.strictEqual(h3.bulkCalls.length, 0, 'a not-yet-available day wrote rows');
  ok('closed sameDayStatus vocabulary: alien strings coerce to measured truth, typed statuses survive');
}
/* 6. unscoped saves unchanged: full-history mode still reconciles + censuses */
{
  const h = makeHarness(false);
  const unscoped = resp([visit('full-1', '2026-03-01', 'Older A body, must survive byte-identical.')], 'saved');
  delete unscoped.receipt.onlyDate; delete unscoped.receipt.scopeDate; delete unscoped.receipt.sameDayStatus;
  unscoped.visits[0].encounterId = 'enc-older-a'; unscoped.visits[0].sourceVisitKey = 'row:older-a';
  const r = h.fn(target, unscoped);
  assert.ok(h.reconcileCalls.length >= 1, 'full-history mode must still reconcile');
  assert.strictEqual(r.scopedAdditive, false);
  ok('unscoped full-history save still reconciles (mode not softened)');
}

console.log('PASS scoped-save additive: slices persist once with reconcile OFF, absence saves nothing, no-substitution and frozen-target refusals hold (empty/invalid frozen day refuses too), sameDayStatus is closed-vocabulary, the mutation control bites, and full-history mode is unchanged (' + n + ' cases)');
