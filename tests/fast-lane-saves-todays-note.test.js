'use strict';

/* Full Notes scope regression: the date-scoped reader remains available for an
 * explicitly ON catch-up, but OFF is schedule-only and cannot use onlyDate or
 * singlePull as a permission bypass. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
const fv = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');
const mc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

/* ---- 1. the date-key normalizer, EXECUTED ---- */
{
  const s = bg.indexOf('function mlsVisitDateKeyForHint');
  assert(s > 0, 'date-key helper missing');
  const fn = bg.slice(s, bg.indexOf('function freezeVisitHint', s));
  const ctx = vm.createContext({});
  vm.runInContext(fn + '\nthis.k = mlsVisitDateKeyForHint;', ctx);
  assert.strictEqual(ctx.k('2026-07-28'), '2026-07-28', 'ISO passes through');
  assert.strictEqual(ctx.k('7/28/2026'), '2026-07-28', 'M/D/YYYY normalizes');
  assert.strictEqual(ctx.k('07/28/26'), '2026-07-28', 'MM/DD/YY normalizes');
  assert.strictEqual(ctx.k('Office visit 07/28/2026 note'), '2026-07-28', 'date inside row text still keys');
  assert.strictEqual(ctx.k(''), '', 'empty stays empty');
  assert.strictEqual(ctx.k('no date here'), '', 'dateless rows key to empty (never match a requested day)');
}

/* ---- 2. reader arithmetic: skipped day rows leave the exact-count gate closed ---- */
assert(bg.includes("onlyDate: mlsVisitDateKeyForHint(hint.onlyDate)"), 'freezeVisitHint must carry onlyDate');
assert(bg.includes('dateSkippedRows = []'), 'reader must track day-scoped skips');
assert(bg.includes('frozenHint.onlyDate && mlsVisitDateKeyForHint(snap.date) !== frozenHint.onlyDate'), 'the skip branch keys on the frozen hint');
assert(bg.includes('total - administrativeRows.length - dateSkippedRows.length'), 'completeness arithmetic must exclude the deliberately skipped rows');
assert(bg.includes('dateSkippedRows: dateSkippedRows.length'), 'the receipt must say exactly what was scoped out');
assert(bg.includes('(outside the requested day - body not read)'), 'skips are narrated, never silent');

/* ---- 3. vp gate: every reader option honors the preference, EXECUTED ---- */
{
  const s = mc.indexOf('api.runForPatient = function (p, onStatus, runOpts) {');
  const e = mc.indexOf('function ensureSettings', s);
  assert(s > 0 && e > s, 'runForPatient block missing');
  const block = mc.slice(s, e);
  const calls = [];
  let isOn = false;
  const ctx = vm.createContext({
    api: { running: false, current: null },
    enabled: () => isOn,
    window: { __mlsCopyVisits: { run: (cb, p, opts) => { calls.push(opts || null); return Promise.resolve(3); } } },
    Promise, Error
  });
  vm.runInContext(block, ctx);
  return Promise.resolve()
    .then(() => ctx.api.runForPatient({ id: 'p1', name: 'Zz' }, null))
    .then(r => assert.strictEqual(r && r.skipped, 'preference-off', 'full read stays gated by the preference'))
    .then(() => { ctx.api.running = false; ctx.api.current = null; })
    .then(() => ctx.api.runForPatient({ id: 'p1', name: 'Zz' }, null, { onlyDate: '2026-07-28' }))
    .then(r => assert.strictEqual(r && r.skipped, 'preference-off', 'onlyDate bypassed Full Notes OFF'))
    .then(() => ctx.api.runForPatient({ id: 'p1', name: 'Zz' }, null, { singlePull: true }))
    .then(r => {
      assert.strictEqual(r && r.skipped, 'preference-off', 'singlePull bypassed Full Notes OFF');
      assert.strictEqual(calls.length, 0, 'OFF invoked the visit reader');
      isOn = true;
    })
    .then(() => ctx.api.runForPatient({ id: 'p1', name: 'Zz' }, null, { onlyDate: '2026-07-28' }))
    .then(r => {
      assert(r && r.ok === true, 'an explicitly ON date-scoped catch-up did not run');
      assert.strictEqual(calls.length, 1, 'cv.run invoked exactly once');
      assert(calls[0] && calls[0].onlyDate === '2026-07-28', 'onlyDate forwarded to cv.run');
      part4();
      console.log('fast-lane-saves-todays-note: PASS');
    })
    .catch(err => { console.error(err); process.exit(1); });
}

function part4() {
  /* ---- 4. date capability remains, but every OFF auto-lane is fused ---- */
  assert(fv.includes("onlyDate: String(runOpts.onlyDate || '')"), 'cv payload must carry onlyDate');
  assert(fv.includes('function run(onStatus, patientOverride, runOpts)'), 'cv.run accepts opts');
  assert(si.includes('var pulledDayNoteLaneEnabled = false;'), 'the inline OFF body lane is not fused off');
  assert(si.includes('var pulledDayNoteTailEnabled = false;'), 'the OFF tail body lane is not fused off');
  assert(si.includes('if (receipt.visitNotesRequested !== true) return 0;'),
    'an OFF receipt can still arm deferred note-body work');
  const skipIdx = si.indexOf('one.visitsSkipped = true');
  const win = si.slice(skipIdx - 300, skipIdx + 300);
  assert(!/parsedVisits|visitCount|persistedVisits/.test(win), 'the skip path must still never fabricate visit evidence');
}
