'use strict';

// Synthetic records only. Exercise the installed source functions, including
// account/generation fences and both surviving import-chain copies.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
let checks = 0;
function eq(actual, expected, label) { assert.strictEqual(actual, expected, label); checks++; }
function ok(value, label) { assert.ok(value, label); checks++; }
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'); }
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, 'source boundaries missing');
  return source.slice(a, b);
}
function context(extra) {
  const c = { Date, Math, Object, Array, String, Number, Boolean, RegExp, JSON, Error,
    Promise, Set, Map, console: { log() {}, warn() {}, error() {} }, ...extra };
  c.window = c;
  return vm.createContext(c);
}
const base = { id: 'local-1', name: 'Synthetic Morgan Sample', dob: '', mrn: '' };
const row = (extra = {}) => ({ ...base, ...extra });
const dob = '1985-02-03';

function sweepHarness(shell) {
  const block = between(shell, '<!-- ===== mrn-1.0.0', '<!-- ===== end mrn-1.0.0');
  const code = block.match(/<script>([\s\S]*?)<\/script>/)[1];
  const h = { rows: [row()], writes: 0, gen: 1, account: 'alpha', timers: new Map(), listeners: {} };
  let id = 0;
  const c = context({
    setTimeout(fn) { h.timers.set(++id, fn); return id; },
    clearTimeout(n) { h.timers.delete(n); },
    uns(key) { return h.account + '::' + key; },
    getPatients() { return h.rows.slice(); },
    findPatient(key) { return h.rows.find(p => p.id === key); },
    upsertPatient(p) { const at = h.rows.findIndex(r => r.id === p.id); if (at < 0) h.rows.push(p); else h.rows[at] = p; h.writes++; },
    savePatients(rows) { h.rows = rows.slice(); h.writes++; },
    savePatient() {},
    __mlsPtsStore: { genRead() { return h.gen; } },
    addEventListener(type, fn) { h.listeners[type] = fn; }
  });
  h.drain = () => {
    let turns = 0;
    while (h.timers.size) {
      assert(turns++ < 30, 'backfill schedules an unbounded loop');
      const [key, fn] = h.timers.entries().next().value; h.timers.delete(key); fn();
    }
  };
  vm.runInContext(code, c);
  h.c = c; h.drain();
  h.sweep = () => { const report = c.__mlsMrnSweep('synthetic'); h.drain(); return report; };
  return h;
}

function testSweep(shell) {
  const h = sweepHarness(shell);
  eq(h.writes, 0, 'empty record does not invent identity');
  eq(h.sweep().skipped, 'no-change', 'unchanged generation is cached');
  h.c.upsertPatient(row({ athenaPatientId: '701001' }));
  eq(h.sweep().filled, 1, 'same-size upsert with alias invalidates cached miss');
  eq(h.rows[0].mrn, '701001', 'fresh alias fills MRN');
  eq(h.sweep().skipped, 'no-change', 'own fill writes do not create sweep loop');

  const bulk = sweepHarness(shell);
  bulk.c.savePatients([row({ athenaChartSummaryBlock: 'Synthetic Morgan Sample. DOB: 02/03/1985. MRN: 701002.' })]);
  eq(bulk.sweep().filled, 1, 'new chart text via bulk save invalidates cached miss');
  eq(bulk.rows[0].mrn, '701002', 'own chart MRN is backfilled');
  ok(bulk.rows[0].dob, 'own chart DOB is backfilled');

  const gen = sweepHarness(shell);
  gen.rows = [row({ athenaId: '701003' })]; gen.gen++;
  eq(gen.sweep().filled, 1, 'IDB generation invalidates without legacy blob changes');
  const event = sweepHarness(shell);
  event.rows = [row({ athenaId: '701004' })];
  event.listeners['mls:patient-record-updated'](); event.drain();
  eq(event.rows[0].mrn, '701004', 'record update signal invalidates cache');
  const account = sweepHarness(shell);
  account.account = 'beta'; account.rows = [row({ athenaId: '701005' })];
  eq(account.sweep().filled, 1, 'same-size account switch invalidates cache');
  const ambiguous = sweepHarness(shell);
  ambiguous.c.savePatients([row({ athenaChartSummaryBlock: 'Synthetic Morgan Sample MRN: 701006. Synthetic Morgan Sample MRN: 701007.' })]);
  eq(ambiguous.sweep().filled, 0, 'fresh generation does not bypass conflicting evidence refusal');
}

function resolverHarness(shell, rows) {
  const source = between(shell, 'function _calDobKey(v)', 'function calStartVisit(id){');
  const c = context({ getPatients: () => rows, findPatient: id => rows.find(p => String(p.id) === String(id)) });
  vm.runInContext(source, c);
  return a => c._calResolveLocalPatient(a);
}
function testResolver(shell) {
  const resolve = resolverHarness(shell, [row({ mrn: '701101' })]);
  eq(resolve({ name: 'Sample, Synthetic Morgan', mrn: '701101' }), 'local-1', 'same MRN with comma name needs no DOB');
  eq(resolve({ name: 'Synthetic Sample', mrn: '701101' }), 'local-1', 'same MRN without middle name needs no DOB');
  eq(resolve({ name: 'Sample, Synthetic Morgan', athenaPatientId: '701101' }), 'local-1', 'incoming Athena patient alias is recognized');
  eq(resolverHarness(shell, [row({ athenaPatientId: '701101' })])({ name: 'Synthetic Sample', mrn: '701101' }), 'local-1', 'stored Athena alias is recognized');
  eq(resolve({ name: 'Synthetic Sample' }), null, 'name alone cannot become canonical target');
  eq(resolve({ name: 'Synthetic Sample', mrn: '701102' }), null, 'conflicting MRN refuses');
  const withDob = resolverHarness(shell, [row({ mrn: '701101', dob })]);
  eq(withDob({ name: 'Synthetic Sample', mrn: '701101', dob: '1986-02-03' }), null, 'conflicting DOB refuses despite same MRN');
  eq(withDob({ name: 'Synthetic Sample', dob: '02/03/1985' }), 'local-1', 'name plus DOB remains sufficient');
  eq(withDob({ name: 'Synthetic Sample', dob, mrn: '701102' }), null, 'name plus DOB cannot override MRN conflict');
  eq(resolverHarness(shell, [row({ mrn: 'A701101' })])({ name: 'Synthetic Sample', mrn: 'B701101' }), null, 'alphanumeric MRNs cannot collide by stripping letters');
  eq(resolverHarness(shell, [row({ dob, athenaPatientId: '701101' }), row({ id: 'local-2', dob, athenaPatientId: '701102' })])({ name: 'Synthetic Sample', dob }), null, 'duplicate survivor refuses differing Athena aliases');
}

function importHarness(source) {
  const c = context({ api: { backfill: { runs: 0, conflicts: 0, patientDobs: 0, apptDobs: 0 } },
    SCHED: { appts: [] }, _calAppts: [], getPatients: () => c.rows.slice(), rows: [], calls: [],
    __mlsMaintenancePersist: { capture: () => ({ key: 'synthetic' }), enqueue(rows, dirty, opts) { c.calls.push({ rows, dirty, opts }); } }
  });
  vm.runInContext(source, c);
  return c;
}
function testImport(source) {
  const c = importHarness(source);
  c.SCHED.appts = [row({ mrn: '701201', dob: '02/03/1985' }), row({ mrn: '701201', dob })];
  c.rows = [row({ mrn: '701201' }), row({ id: 'other', mrn: '701202' }), row({ id: 'name-only' })];
  c._calAppts = [row({ athenaPatientId: '701201' }), row({ mrn: '701202' }), row({ patient_external_id: 'local-1' })];
  c.backfillFromStash();
  eq(c.calls.length, 1, 'same MRN admits one scoped persistence batch');
  eq(c.calls[0].dirty.length, 1, 'same-name different/missing MRN remains untouched');
  eq(c.calls[0].dirty[0].dob, dob, 'equivalent date formats are one identity');
  eq(c.rows[0].dob, '', 'roster object is cloned before persistence');
  eq(c._calAppts[0].dob, dob, 'same-MRN appointment receives DOB');
  eq(c._calAppts[1].dob, '', 'different MRN appointment refuses');
  eq(c._calAppts[2].dob, '', 'bare external local-ID match is not proof');
  eq(c.calls[0].opts.mirror, false, 'maintenance mirror contract retained');
  eq(JSON.stringify(c.calls[0].opts.fields), '["dob","updated"]', 'only intended fields are queued');
  eq(c.calls[0].opts.scope.key, 'synthetic', 'captured scope retained');
  const conflict = importHarness(source);
  conflict.SCHED.appts = [row({ mrn: '701201', dob }), row({ mrn: '701201', dob: '1986-02-03' })];
  conflict.rows = [row({ mrn: '701201' })]; conflict.backfillFromStash();
  eq(conflict.calls.length, 0, 'same MRN with conflicting source DOBs refuses');
  const alias = importHarness(source);
  alias.SCHED.appts = [row({ mrn: '701201', dob })];
  alias.rows = [row({ mrn: '701201', athenaId: '701202' }), row({ mrn: '701201', dob: '1980-01-01' })];
  alias.backfillFromStash();
  eq(alias.calls.length, 0, 'conflicting aliases and nonempty DOBs are not overwritten');
  eq(alias.dobValueKey('02/30/1985'), '', 'invalid date cannot be copied');
  eq(alias.dobMrnKey({ athena_id: '701201' }), '701201', 'schedule snake-case Athena alias is recognized');
}

function packHarness(source) {
  const h = { rows: [], appts: [], gen: 1, account: 'alpha', reads: 0, listeners: {}, deferred: [], nodes: [] };
  const c = context({
    setTimeout: fn => { h.deferred.push(fn); return h.deferred.length; }, clearTimeout() {},
    getPatients() { h.reads++; return h.rows; }, _calAppts: () => h.appts,
    savePatients(rows) { h.rows = rows; }, loadCalendar() {},
    uns: key => h.account + '::' + key,
    localStorage: { getItem() { return null; } },
    __mlsPtsStore: { genRead: () => h.gen },
    __mlsBgSleep: () => Promise.resolve(), __mlsDeferAsset: fn => h.deferred.push(fn),
    document: { readyState: 'complete', querySelectorAll() { return [{ querySelectorAll(selector) { return selector === '[data-k]' ? h.nodes : []; } }]; }, addEventListener() {}, removeEventListener() {} },
    addEventListener(type, fn) { h.listeners[type] = fn; }, removeEventListener() {}
  });
  vm.runInContext(source, c); c.__mlsDobEverywhere.persist = false; h.c = c;
  h.drain = async () => { for (let i = 0; i < 150; i++) { while (h.deferred.length) h.deferred.shift()(); await Promise.resolve(); } };
  return h;
}
async function testPack(source) {
  const h = packHarness(source);
  h.rows = [row({ mrn: '701301', dob })];
  h.appts = [row({ mrn: '701301' }), row({ id: 'other', mrn: '701302' }), row({ id: 'name-only' }), row({ id: 'external', patient_external_id: 'local-1' })];
  await h.drain();
  eq(h.appts[0].dob, dob, 'async calendar DOB join requires same MRN');
  for (const a of h.appts.slice(1)) eq(a.dob, '', 'async calendar join refuses weak identity');
  const before = h.reads; h.c.loadCalendar(); await h.drain();
  eq(h.reads, before, 'unchanged roster reuses generation cache');
  h.appts = [row({ mrn: '701303' })]; h.rows = [row({ mrn: '701303', dob: '1984-04-05' })]; h.gen++;
  h.c.loadCalendar(); await h.drain();
  eq(h.appts[0].dob, '1984-04-05', 'IDB generation invalidates null-localStorage cache');
  h.appts = [row({ mrn: '701304' })]; h.c.savePatients([row({ mrn: '701304', dob })]); await h.drain();
  eq(h.appts[0].dob, dob, 'legacy save epoch invalidates unchanged storage');
  h.appts = [row({ mrn: '701305' })]; h.rows = [row({ mrn: '701305', dob })]; h.listeners['mls:patient-record-updated'](); await h.drain();
  eq(h.appts[0].dob, dob, 'record-updated hook refreshes DOB index');
  h.account = 'beta'; h.appts = [row({ mrn: '701306' })]; h.rows = [row({ mrn: '701306', dob })]; h.c.loadCalendar(); await h.drain();
  eq(h.appts[0].dob, dob, 'account switch does not retain old index');

  const conflict = packHarness(source);
  conflict.rows = [row({ mrn: '701301', dob }), row({ id: 'other', mrn: '701301', dob: '1986-02-03' })];
  conflict.appts = [row({ mrn: '701301' })]; await conflict.drain();
  eq(conflict.appts[0].dob, '', 'store DOB conflict refuses calendar join');
  const sync = packHarness(source);
  sync.rows = [row({ mrn: '701301', dob }), row({ id: 'equivalent', mrn: '701301', dob: '02/03/1985' })];
  sync.appts = [row({ mrn: '701301' }), row({ mrn: '701302' }), row()];
  eq(sync.c.__mlsDobEverywhere.apply(), 1, 'manual join uses same identity policy');
  eq(sync.appts[0].dob, dob, 'equivalent dates do not make false conflict');
  sync.appts = [row({ mrn: '701301', name: '' })];
  eq(sync.c.__mlsDobEverywhere.apply(), 1, 'same explicit MRN is sufficient even when appointment name is absent');

  const dom = packHarness(source);
  dom.rows = [row({ mrn: '701301', dob })];
  dom.appts = [row({ id: 'appt-a', mrn: '701301', appt_date: '2026-09-10', start_local: '10:00' }), row({ id: 'appt-b', mrn: '701302', appt_date: '2026-09-10', start_local: '10:00' })];
  function node(key) { const n = { key, span: { textContent: '—' }, getAttribute: () => n.key, setAttribute: (attr, v) => { n.key = v; }, closest: () => ({ querySelector: () => n.span }) }; return n; }
  dom.nodes = [node('appt-a||Synthetic Morgan Sample||2026-09-10|10:00'), node('appt-b||Synthetic Morgan Sample||2026-09-10|10:00'), node('|Synthetic Morgan Sample||2026-09-10|10:00')];
  await dom.drain();
  ok(dom.nodes[0].key.includes(dob), 'exact appointment key is repainted');
  eq(dom.nodes[1].span.textContent, '—', 'same-name other appointment is not relabeled');
  eq(dom.nodes[2].span.textContent, '—', 'ambiguous legacy key is not relabeled');

  // A generation change during a cooperative scan must discard the plan.
  const stale = packHarness(source);
  stale.rows = [row({ mrn: '701301', dob })]; stale.appts = [row({ mrn: '701301' })];
  let bumped = false;
  stale.c.__mlsBgSleep = () => { if (!bumped) { bumped = true; stale.gen++; stale.rows = []; } return Promise.resolve(); };
  await stale.drain();
  eq(stale.appts[0].dob, '', 'stale cooperative scan never applies old identity');
}

(async () => {
  for (const file of ['1pScribeFlow.html', '1p/index.html']) { const shell = read(file); testSweep(shell); testResolver(shell); }
  const connect = read('1p-mls-connect.js');
  const starts = [...connect.matchAll(/  function dobMrnKey\(row\)/g)].map(m => m.index);
  eq(starts.length, 2, 'both import-chain copies are exercised');
  for (const start of starts) testImport(connect.slice(start, connect.indexOf('  api.backfillNow =', start)));
  const pack = read('1p-feat_mls_b121_pack.js');
  const module = between(pack, ";(function () {\n  'use strict';\n  if (window.__mlsDobEverywhere) return;", '/* ========================================================================= * MODULE 9');
  await testPack(module);
  console.log('PASS identity-enrichment-current-generation-runtime: ' + checks + ' synthetic assertions');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
