/* 1p-day-pull-facts-capture (si-facts-1.0)
 *
 * Owner 2026-08-19: "very important that history is also saved just like that
 * when doing a day pull." The organize pass already lands problems/history
 * from pulled encounter text; MEDICATIONS live on the chart banner and never
 * ride encounter bodies — measured: every day-pulled patient had an empty
 * meds card while the capture reply carried the list. si-facts-1.0 runs ONE
 * bounded capture per patient while that chart is still open.
 *
 * Statics: the helper exists once, the call site is AWAITED inside the
 * per-patient loop before visitsComplete is stamped (so the walk can never
 * navigate away underneath it), the name guard and only-if-empty guards are
 * present, and the verdict rides the ledger row. Functional: the merge
 * semantics run for real in a VM — meds append-missing, a mismatched name
 * adds nothing, empty problems/allergies fill, populated ones are never
 * overwritten. Twins note: this block lives in 1p-feat_mls_schedimport_exact
 * (a lane fork), so the cloned derive carries it; production is untouched.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let checks = 0;
function ok(c, m) { checks++; assert.ok(c, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }

const root = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const CLONED = fs.readFileSync(path.join(root, 'cloned-feat_mls_schedimport_exact.js'), 'utf8');

/* ---- statics ---- */
eq(SRC.split('function siCaptureFacts(').length - 1, 1, 'siCaptureFacts exists exactly once');
ok(SRC.indexOf("one.factsCapture = await siCaptureFacts(target.patientId, 8000)") > 0,
  'the call site is AWAITED and records its verdict on the ledger row');
const callAt = SRC.indexOf('one.factsCapture = await siCaptureFacts');
const completeAt = SRC.indexOf('one.visitsComplete = true', callAt);
ok(callAt > 0 && completeAt > callAt && completeAt - callAt < 400,
  'the capture completes BEFORE visitsComplete is stamped, in the same block');
ok(/if \(inter < 2\) return 'name-mismatch';/.test(SRC), 'two-token name guard present');
ok(/if \(!String\(p\.problems \|\| ''\)\.trim\(\)/.test(SRC), 'problems fill only when empty');
ok(/if \(!String\(p\.allergies \|\| ''\)\.trim\(\)/.test(SRC), 'allergies fill only when empty');
ok(SRC.indexOf("settle((e.data.resp && e.data.resp.ok === true && e.data.resp.captured) || null)") > 0,
  'only an ok capture with a captured payload is accepted');
ok(CLONED.indexOf('function siCaptureFacts(') > 0, 'the cloned derive carries the block');

/* ---- functional: run the helper in a VM with a stubbed bridge ---- */
function runCase(captured, patient) {
  const start = SRC.indexOf('  function siCaptureFacts(');
  const end = SRC.indexOf('  function saveVerifiedVisits(', start);
  const body = SRC.slice(start, end);
  const upserts = [];
  const listeners = [];
  const sandbox = {
    window: {
      addEventListener(t, fn) { if (t === 'message') listeners.push(fn); },
      removeEventListener() {},
      postMessage() {
        setTimeout(() => {
          for (const fn of listeners.slice()) fn({ data: { source: 'mls-ext', type: 'mlsAppCaptureResult', resp: captured ? { ok: true, captured } : { ok: false } } });
        }, 5);
      },
      upsertPatient(p) { upserts.push(JSON.parse(JSON.stringify(p))); }
    },
    patientById() { return patient; },
    isFn(f) { return typeof f === 'function'; },
    setTimeout, clearTimeout, Promise, Array, String, JSON, Date, Object
  };
  vm.createContext(sandbox);
  vm.runInContext(body + '\nglobalThis.__run = siCaptureFacts("p1", 2000);', sandbox);
  return sandbox.__run.then((verdict) => ({ verdict, patient, upserts }));
}

(async () => {
  /* meds append-missing onto an existing list; existing lines never doubled */
  let r = await runCase(
    { name: 'Alicia James', medications: ['albuterol 2.5 mg', 'meloxicam 15 mg'], problems: ['x'], allergies: ['NKDA'] },
    { id: 'p1', name: 'Alicia James', meds: 'albuterol 2.5 mg', problems: 'existing problem', allergies: '' });
  eq(r.verdict, 'saved', 'a real capture saves');
  ok(r.patient.meds.indexOf('meloxicam 15 mg') > 0, 'missing med appended');
  eq(r.patient.meds.split('albuterol').length - 1, 1, 'existing med never doubled');
  eq(r.patient.problems, 'existing problem', 'populated problems never overwritten');
  eq(r.patient.allergies, 'NKDA', 'empty allergies filled');
  eq(r.upserts.length, 1, 'exactly one store write');

  /* a different patient's banner adds NOTHING */
  r = await runCase(
    { name: 'Rosemary Monterosso', medications: ['warfarin 5 mg'] },
    { id: 'p1', name: 'Alicia James', meds: '', problems: '', allergies: '' });
  eq(r.verdict, 'name-mismatch', 'a mismatched capture is refused');
  eq(r.patient.meds, '', 'no med lands from a mismatched chart');
  eq(r.upserts.length, 0, 'no store write on mismatch');

  /* a failed capture is honest and harmless */
  r = await runCase(null, { id: 'p1', name: 'Alicia James', meds: '', problems: '', allergies: '' });
  eq(r.verdict, 'no-capture', 'a failed capture reports itself');
  eq(r.upserts.length, 0, 'no store write on a failed capture');

  console.log(`PASS 1p-day-pull-facts-capture — ${checks} checks`);
})().catch((e) => { console.error('FAIL 1p-day-pull-facts-capture:', e.message); process.exit(1); });
