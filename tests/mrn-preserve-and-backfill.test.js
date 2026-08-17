'use strict';

/* mrn-1.0.0 — identity loss-prevention + local MRN/DOB backfill.
 *
 * Measured on the owner's real store 2026-08-16: 1,672 patients, 1,252 (75%)
 * with NO mrn and 43% with no dob. The unified write flow computes
 * identityBlocked = !patientId || !name || !dob || !mrn, so "Confirm & Send to
 * Athena" is gray for three of four charts. This suite does NOT touch that
 * gate; it proves the two data mechanisms that feed it.
 *
 * The block is delimited and self-contained: it patches the store's writers at
 * runtime rather than editing their bodies, so promotion to another lane is a
 * byte-copy. That is asserted here too (property 7).
 *
 * Every property that could pass vacuously is re-run against a deliberately
 * broken in-memory copy of the block (the files on disk are never touched), so
 * a green assertion means the guard is load-bearing rather than untested.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const TWINS = ['1p/index.html', '1pScribeFlow.html'];
const START = '<!-- ===== mrn-1.0.0';
const END = '<!-- ===== end mrn-1.0.0';

let passed = 0;
function ok(v, m) { assert.ok(v, m); passed++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); passed++; }

function blockOf(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const a = src.indexOf(START);
  assert(a >= 0, file + ': mrn-1.0.0 block is missing');
  const b = src.indexOf(END, a + START.length);
  assert(b > a, file + ': mrn-1.0.0 end marker is missing');
  assert.strictEqual(src.indexOf(START, a + START.length), -1, file + ': mrn-1.0.0 block appears more than once');
  return src.slice(a, b);
}

function scriptOf(block, file) {
  const m = block.match(/<script>([\s\S]*?)<\/script>/);
  assert(m, file + ': mrn-1.0.0 block carries no executable script');
  return m[1];
}

/* ---------------------------------------------------------------------- */
/* Property 7: both twins carry identical mrn-1.0.0 bytes.                 */
/* ---------------------------------------------------------------------- */
const blocks = TWINS.map(blockOf);
const digests = blocks.map((b) => crypto.createHash('sha256').update(b).digest('hex'));
eq(digests[0], digests[1], 'the twins carry DIFFERENT mrn-1.0.0 bytes — promotion would be ambiguous');
ok(blocks[0].length > 4000, 'mrn-1.0.0 block is implausibly small — extraction is probably wrong');

/* Lane neutrality. This is the EXACT refusal list that
   scripts/promote-1p-block-to-cloned.js applies (its P1_ONLY constant): a
   block naming anything /1p-only cannot be byte-copied into another lane, and
   the promoter refuses it. Asserting the same list here means the block stays
   promotable rather than discovering it at promotion time. */
const P1_ONLY = ['__MLS_P1_PREVIEW', '1p-feat_', '1p-mls-connect', "'/1p", '"/1p', 'p1-live-1.0.0', 'window.__MLS_P1'];
for (let i = 0; i < TWINS.length; i++) {
  for (const bad of P1_ONLY) {
    ok(blocks[i].indexOf(bad) < 0, TWINS[i] + ': mrn-1.0.0 must stay lane-neutral but mentions ' + bad);
  }
}

const SOURCE = scriptOf(blocks[0], TWINS[0]);

/* ---------------------------------------------------------------------- */
/* Harness: a store shaped like the real one — getPatients() hands back a  */
/* sliced array whose ELEMENTS are shared references, which is exactly why */
/* the guard cannot rely on a previous-object comparison alone.            */
/* ---------------------------------------------------------------------- */
function build(source, rows) {
  const state = { rows: (rows || []).map((r) => Object.assign({}, r)), saves: 0, logs: [] };
  const timers = []; let seq = 0;

  const ctx = {
    Date, Math, Object, Array, String, Number, Boolean, RegExp, JSON, Error, isNaN, parseInt, parseFloat,
    setTimeout(f, ms) { const id = ++seq; timers.push({ id, f, at: Number(ms) || 0, seq }); return id; },
    clearTimeout(id) { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    console: { log(msg) { state.logs.push(String(msg)); } },
    uns: (k) => 'sf_u::doc@example.com::' + k,
    getPatients: () => state.rows.slice(),
    findPatient: (id) => state.rows.find((p) => String(p.id) === String(id)) || null,
    upsertPatient(p) {
      const i = state.rows.findIndex((x) => String(x.id) === String(p.id));
      p.updated = Date.now();
      if (i >= 0) state.rows[i] = p; else { p.created = Date.now(); state.rows.unshift(p); }
      state.saves++;
    },
    savePatients(arr) { state.rows = arr.slice(); state.saves++; },
    /* The patient editor exists BEFORE the block installs, exactly as the
       shell's top-level declaration does, so the wrapper has something to
       wrap. The body is supplied per-test through state.editorImpl. */
    savePatient() { if (typeof state.editorImpl === 'function') return state.editorImpl(); },
    addEventListener() {}, removeEventListener() {}
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'mrn-1.0.0' });

  state.drain = function (maxSteps) {
    let n = 0; const cap = maxSteps || 5000;
    while (timers.length && n++ < cap) {
      timers.sort((a, b) => (a.at - b.at) || (a.seq - b.seq));
      const t = timers.shift();
      try { t.f(); } catch (e) { /* a broken copy may throw; the assertion decides */ }
    }
  };
  state.ctx = ctx;
  return state;
}

/* A copy of the block with one behaviour deliberately removed, used to prove
   the matching assertion is load-bearing. If a literal ever stops matching the
   shipped source this fails loudly rather than testing nothing. */
function broken(kind) {
  if (kind === 'adopt-conflict') {
    const from = 'next[f] = stored;\n      var box =';
    const to = 'next[f] = incoming;\n      var box =';
    assert(SOURCE.includes(from), 'red-test anchor missing: the conflict branch no longer keeps the stored value');
    return SOURCE.replace(from, to);
  }
  if (kind === 'no-preserve') {
    const from = 'next[f] = stored; res.filled.push(f); continue;';
    const to = 'res.filled.push(f); continue;';
    assert(SOURCE.includes(from), 'red-test anchor missing: the preserve-if-empty branch');
    return SOURCE.replace(from, to);
  }
  if (kind === 'no-name-proof') {
    const from = 'if (!nameNear(text, m.index - WIN, m.index + WIN, key, tokens)) continue;';
    assert(SOURCE.split(from).length - 1 === 2, 'red-test anchor missing: the name-proximity proof');
    return SOURCE.split(from).join('');
  }
  throw new Error('unknown broken kind ' + kind);
}

const STORED = { id: 'p1', name: 'Jane Doe', mrn: 'MRN-123456', dob: '01/02/1980' };

/* ---------------------------------------------------------------------- */
/* Property 1: an incoming partial record with mrn:'' keeps the stored mrn. */
/* This is root cause (2): mrn/dob were not among the protected fields.    */
/* ---------------------------------------------------------------------- */
function propertyPreserve(source, label) {
  const s = build(source, [STORED]);
  s.ctx.upsertPatient({ id: 'p1', name: 'Jane Doe', mrn: '', dob: '', visits: [{ date: '2026-08-01' }] });
  const row = s.ctx.findPatient('p1');
  eq(row.mrn, 'MRN-123456', label + ': an incoming empty mrn erased the stored one');
  eq(row.dob, '01/02/1980', label + ': an incoming empty dob erased the stored one');
  eq(row.visits.length, 1, label + ": the caller's own new content must still land");
  return row;
}
propertyPreserve(SOURCE, 'shipped');
assert.throws(() => propertyPreserve(broken('no-preserve'), 'broken'), /erased the stored one/,
  'the preserve-if-empty assertion is vacuous — a build without the carry-forward still passed it');
passed++;

/* undefined and null are the same defect as '' and must be covered too. */
{
  const s = build(SOURCE, [STORED]);
  s.ctx.upsertPatient({ id: 'p1', name: 'Jane Doe', mrn: undefined, dob: null });
  const row = s.ctx.findPatient('p1');
  eq(row.mrn, 'MRN-123456', 'an incoming undefined mrn erased the stored one');
  eq(row.dob, '01/02/1980', 'an incoming null dob erased the stored one');
}

/* ---------------------------------------------------------------------- */
/* Property 2: a DIFFERENT non-empty mrn is never silently adopted. The    */
/* stored value is kept and the disagreement is recorded. A wrong-MRN      */
/* write is the wrong-chart failure this codebase has already paid for.    */
/* ---------------------------------------------------------------------- */
function propertyConflict(source, label) {
  const s = build(source, [STORED]);
  /* A DIFFERENT patient entirely, arriving under the same local id. */
  s.ctx.upsertPatient({ id: 'p1', name: 'John Smith', mrn: 'MRN-999999', dob: '11/12/1975' });
  const row = s.ctx.findPatient('p1');
  eq(row.mrn, 'MRN-123456', label + ': a different incoming MRN replaced the stored one (wrong-chart write)');
  eq(row.dob, '01/02/1980', label + ': a different incoming DOB replaced the stored one');
  ok(row.identityConflict && row.identityConflict.mrn, label + ': the MRN disagreement was not recorded');
  eq(row.identityConflict.mrn.stored, 'MRN-123456', label + ': conflict marker lost the stored value');
  eq(row.identityConflict.mrn.incoming, 'MRN-999999', label + ': conflict marker lost the incoming value');
  ok(row.identityConflict.dob, label + ': the DOB disagreement was not recorded');
  /* Nothing merged: the identity is wholly the stored one, never a blend. */
  ok(!/999999/.test(String(row.mrn)), label + ': stored and incoming MRN were merged');
  return row;
}
propertyConflict(SOURCE, 'shipped');
assert.throws(() => propertyConflict(broken('adopt-conflict'), 'broken'), /wrong-chart write/,
  'the conflict assertion is vacuous — a build that adopts the incoming MRN still passed it');
passed++;

/* The conflict is counted, PHI-free, for diagnostics. */
{
  const s = build(SOURCE, [STORED]);
  s.ctx.upsertPatient({ id: 'p1', name: 'Jane Doe', mrn: 'MRN-999999' });
  const log = s.ctx.window.__mlsMrnConflictLog || [];
  eq(log.length, 1, 'the identity conflict was not counted');
  eq(log[0].fields.join(','), 'mrn', 'the conflict log named the wrong field');
  ok(!('incoming' in log[0]) && !('stored' in log[0]), 'the conflict COUNT line must not carry identity values');
}

/* The one legitimate way to change a stored identity: a deliberate human edit
   through the patient editor. Without this, a typo correction is impossible. */
{
  const s = build(SOURCE, [STORED]);
  /* The editor mutates the record and calls the single-row writer
     synchronously, exactly as savePatient() does. Note it hands the writer the
     STORED object itself — the aliasing case, where a previous-vs-incoming
     comparison sees nothing and only the identity index can testify. */
  s.editorImpl = function () {
    const p = s.ctx.findPatient('p1');
    p.mrn = 'MRN-777'; p.dob = '03/04/1981';
    s.ctx.upsertPatient(p);
  };
  ok(s.ctx.window.savePatient.__mrnWrapped, 'the patient editor was never wrapped, so a deliberate identity edit stays blocked');
  s.ctx.window.savePatient();
  const row = s.ctx.findPatient('p1');
  eq(row.mrn, 'MRN-777', 'a deliberate human edit could not correct the MRN');
  eq(row.dob, '03/04/1981', 'a deliberate human edit could not correct the DOB');
  ok(!row.identityConflict || !row.identityConflict.mrn, 'a deliberate edit must not be filed as a conflict');
  /* The override flag must never persist onto the stored record. */
  ok(!('__mlsIdentityEdit' in row) || row.__mlsIdentityEdit === undefined,
    'the deliberate-edit flag persisted into the store as a standing override');
}

/* ALIASING. getPatients() hands back a sliced array whose ELEMENTS are shared
   references, so a caller that mutates the stored row in place makes previous
   and incoming THE SAME OBJECT and a field comparison sees nothing at all.
   This is the case the identity index exists for. */
function propertyAliased(source, label) {
  const s = build(source, [STORED]);
  /* Warm the index the way a normal boot does — any guarded write seeds it. */
  s.ctx.upsertPatient({ id: 'p1', name: 'Jane Doe', mrn: 'MRN-123456', dob: '01/02/1980' });
  /* A machine caller mutates the STORED object and blanks the identity. */
  const live = s.ctx.findPatient('p1');
  live.mrn = ''; live.dob = '';
  s.ctx.upsertPatient(live);
  const row = s.ctx.findPatient('p1');
  eq(row.mrn, 'MRN-123456', label + ': an in-place clobber erased the stored mrn (aliased write)');
  eq(row.dob, '01/02/1980', label + ': an in-place clobber erased the stored dob (aliased write)');
  return row;
}
propertyAliased(SOURCE, 'shipped');
{
  /* Removing the index consultation must break exactly this property. */
  const from = 'if (!stored && idx && idx[f]) stored = String(idx[f] || \'\').trim();';
  assert(SOURCE.includes(from), 'red-test anchor missing: the identity-index consultation');
  const brokenIdx = SOURCE.replace(from, '');
  assert.throws(() => propertyAliased(brokenIdx, 'broken'), /aliased write/,
    'the aliasing assertion is vacuous — a build that never consults the identity index still passed it');
  passed++;
}

/* The bulk roster path — the one the server hydrate takes, replacing whole
   rows without ever reaching the single-row writer. */
{
  const s = build(SOURCE, [STORED]);
  /* The mirror is newer but carries no identity: it must not erase one. */
  s.ctx.savePatients([{ id: 'p1', name: 'Jane Doe', mrn: '', dob: '', updated: Date.now() + 1000 }]);
  const row = s.ctx.findPatient('p1');
  eq(row.mrn, 'MRN-123456', 'a bulk roster write with an empty mrn erased the stored one (the hydrate path)');
  eq(row.dob, '01/02/1980', 'a bulk roster write with an empty dob erased the stored one');
}
{
  const s = build(SOURCE, [STORED]);
  s.ctx.savePatients([{ id: 'p1', name: 'Jane Doe', mrn: 'MRN-999999', dob: '01/02/1980' }]);
  const row = s.ctx.findPatient('p1');
  eq(row.mrn, 'MRN-123456', 'a bulk roster write adopted a DIFFERENT mrn (wrong-chart write via the mirror)');
  ok(row.identityConflict && row.identityConflict.mrn, 'the bulk-path disagreement was not recorded');
}
/* Consume: the server is an independent record. When the local field is EMPTY
   a server-provided value is adopted rather than refused. */
{
  const s = build(SOURCE, [{ id: 'p1', name: 'Jane Doe', mrn: '', dob: '' }]);
  const res = s.ctx.window.__mlsMrnPreserveIdentity(
    { id: 'p1', name: 'Jane Doe', mrn: '', dob: '' },
    { id: 'p1', name: 'Jane Doe', mrn: 'MRN-555', dob: '05/06/1982' }, {});
  eq(res.filled.sort().join(','), 'dob,mrn', 'a server row with mrn/dob did not fill an empty local identity');
}
/* The same consume, driven through the REAL bulk wrapper the way hydration
   drives it: the server copy is strictly newer, so the hydrate adopts it
   wholesale, and the identity it carries must survive into the store. */
{
  const s = build(SOURCE, [{ id: 'p1', name: 'Jane Doe', mrn: '', dob: '', updated: 1000 }]);
  s.ctx.savePatients([{ id: 'p1', name: 'Jane Doe', mrn: 'MRN-555', dob: '05/06/1982', updated: 2000 }]);
  const row = s.ctx.findPatient('p1');
  eq(row.mrn, 'MRN-555', 'a newer server row did not deliver its mrn into an empty local field');
  eq(row.dob, '05/06/1982', 'a newer server row did not deliver its dob into an empty local field');
}

/* SCHEDULE-BORN PATIENTS. A patient created from an Athena schedule row has no
   mrn at all — the MRN lives in the chart, not the row. The chart read that
   later observes it does `if(!p.mrn && observed.chartMrn) p.mrn = ...` and
   upserts; this guard must NOT stand in the way of that fill, on either the
   distinct-object or the aliased path. */
{
  const s = build(SOURCE, [{ id: 'sch1', name: 'Jane Doe', dob: '01/02/1980', source: 'athena-schedule' }]);
  /* Distinct object, as a chart-save clone would be. */
  s.ctx.upsertPatient({ id: 'sch1', name: 'Jane Doe', dob: '01/02/1980', source: 'athena-schedule', mrn: 'CHART-4321' });
  eq(s.ctx.findPatient('sch1').mrn, 'CHART-4321', 'the guard blocked the existing chart-read MRN backfill');

  /* Aliased, as an in-place `p.mrn = observed.chartMrn` would be. */
  const s2 = build(SOURCE, [{ id: 'sch2', name: 'John Roe', dob: '02/03/1981', source: 'athena-schedule' }]);
  const live = s2.ctx.findPatient('sch2');
  live.mrn = 'CHART-8765';
  s2.ctx.upsertPatient(live);
  eq(s2.ctx.findPatient('sch2').mrn, 'CHART-8765', 'the guard blocked an in-place chart-read MRN backfill');
  ok(!s2.ctx.findPatient('sch2').identityConflict, 'filling an empty MRN was wrongly filed as a conflict');
}

/* ---------------------------------------------------------------------- */
/* Property 3: backfill fills from this patient's OWN chart snapshot, when */
/* the value sits beside this patient's OWN name.                         */
/* ---------------------------------------------------------------------- */
const s0 = build(SOURCE, []);
const backfill = s0.ctx.window.mrnBackfillFromLocal;
ok(typeof backfill === 'function', 'mrnBackfillFromLocal was not exposed');

{
  const got = backfill({
    id: 'p2', name: 'Jane Doe', mrn: '', dob: '',
    athenaChartSnapshot: { summary: 'Patient: Jane Doe  MRN: 123456  DOB: 01/02/1980\nAssessment: stable.' }
  });
  eq(got.mrn, '123456', 'backfill did not read the MRN out of the chart snapshot');
  eq(got.dob, '01/02/1980', 'backfill did not read the DOB out of the chart snapshot');
  eq(got.confidence, 'name-verified', 'a text-derived fill must be marked name-verified');
  eq(got.source, 'athenaChartSnapshot', 'backfill reported the wrong source');
}
/* The same value from the summary block and from a visit body. */
{
  eq(backfill({ id: 'p3', name: 'Jane Doe', athenaChartSummaryBlock: 'Jane Doe — Medical Record Number: A-9087' }).mrn,
    'A-9087', 'backfill did not read a Medical Record Number label from the summary block');
  eq(backfill({ id: 'p4', name: 'Jane Doe', visits: [{ raw: 'Office visit for Jane Doe, Patient ID 4455661.' }] }).mrn,
    '4455661', 'backfill did not read a Patient ID label out of a visit body');
}
/* An Athena id already on the record under another field name is the same
   identity restated — the highest-confidence source, no text proof needed. */
{
  const got = backfill({ id: 'p5', name: 'Jane Doe', mrn: '', athenaId: 'E77321' });
  eq(got.mrn, 'E77321', 'backfill ignored an Athena id already stored under athenaId');
  eq(got.confidence, 'exact', 'a field-restated identity must be marked exact');
  eq(got.source, 'field:athenaId', 'backfill reported the wrong source for a field-restated identity');
}
/* A bare date beside an MRN label must never become an MRN. */
{
  const got = backfill({ id: 'p6', name: 'Jane Doe', athenaChartSummaryBlock: 'Jane Doe MRN: 01/02/1980' });
  ok(!got.mrn, 'a bare date was accepted as an MRN');
}

/* ---------------------------------------------------------------------- */
/* Property 4: two disagreeing candidates REFUSE rather than guess.        */
/* ---------------------------------------------------------------------- */
{
  const got = backfill({
    id: 'p7', name: 'Jane Doe', mrn: '',
    athenaChartSummaryBlock: 'Jane Doe MRN: 123456\nJane Doe MRN: 654321'
  });
  ok(!got.mrn, 'backfill guessed between two disagreeing MRNs instead of refusing');
  ok(/^ambiguous-mrn:2/.test(got.reason), 'the refusal reason was not recorded as ambiguous, got: ' + got.reason);
}
/* The same value twice is NOT ambiguity — it is corroboration. */
{
  const got = backfill({ id: 'p8', name: 'Jane Doe', athenaChartSummaryBlock: 'Jane Doe MRN: 123456\nJane Doe MRN: 123456' });
  eq(got.mrn, '123456', 'the same MRN seen twice was wrongly treated as a conflict');
}

/* ---------------------------------------------------------------------- */
/* Property 5: never fill from a snapshot that names a DIFFERENT patient.  */
/* ---------------------------------------------------------------------- */
function propertyForeignName(source, label) {
  const bf = build(source, []).ctx.window.mrnBackfillFromLocal;
  const got = bf({
    id: 'p9', name: 'Jane Doe', mrn: '', dob: '',
    athenaChartSnapshot: { summary: 'Patient: John Smith  MRN: 777888  DOB: 11/12/1975' }
  });
  ok(!got.mrn, label + ": backfill took an MRN from a snapshot naming a DIFFERENT patient");
  ok(!got.dob, label + ': backfill took a DOB from a snapshot naming a different patient');
  return got;
}
propertyForeignName(SOURCE, 'shipped');
assert.throws(() => propertyForeignName(broken('no-name-proof'), 'broken'), /DIFFERENT patient/,
  'the name-proximity assertion is vacuous — a build with no name proof still passed it');
passed++;

/* A patient with no name cannot verify anything, so it must refuse. */
{
  const got = backfill({ id: 'p10', name: '', athenaChartSummaryBlock: 'MRN: 123456' });
  ok(!got.mrn, 'backfill filled a record that has no name to verify against');
  eq(got.reason, 'no-name-to-verify', 'the nameless refusal reason was not recorded');
}
/* An already-complete record is left entirely alone. */
{
  const got = backfill(Object.assign({}, STORED, { athenaChartSummaryBlock: 'Jane Doe MRN: 999999' }));
  ok(!got.mrn && !got.dob, 'backfill proposed a change to an already-complete record');
  eq(got.reason, 'already-complete', 'the already-complete reason was not recorded');
}

/* ---------------------------------------------------------------------- */
/* Property 6: the sweep is idempotent — a second run changes nothing.     */
/* ---------------------------------------------------------------------- */
{
  const s = build(SOURCE, [
    { id: 'a1', name: 'Jane Doe', mrn: '', dob: '', athenaChartSummaryBlock: 'Jane Doe MRN: 123456 DOB: 01/02/1980' },
    { id: 'a2', name: 'John Smith', mrn: '', dob: '', athenaChartSummaryBlock: 'John Smith MRN: 111 and MRN: 222' },
    { id: 'a3', name: 'Ann Lee', mrn: 'KEEP-1', dob: '07/08/1990' },
    { id: 'a4', name: 'Bob Ray', mrn: '', dob: '', athenaChartSummaryBlock: 'Someone Else MRN: 999999' }
  ]);
  let first = null;
  s.ctx.window.__mlsMrnSweep('test-1', (r) => { first = r; });
  s.drain();
  ok(first, 'the sweep never reported');
  eq(first.filled, 1, 'the sweep filled the wrong number of rows, got ' + JSON.stringify(first));
  eq(first.ambiguous, 1, 'the sweep did not count the ambiguous row');
  eq(s.ctx.findPatient('a1').mrn, '123456', 'the sweep did not write the derived MRN back through the store');
  eq(s.ctx.findPatient('a1').dob, '01/02/1980', 'the sweep did not write the derived DOB back');
  eq(s.ctx.findPatient('a2').mrn, '', 'the sweep wrote an ambiguous MRN');
  eq(s.ctx.findPatient('a3').mrn, 'KEEP-1', 'the sweep disturbed a complete record');
  eq(s.ctx.findPatient('a4').mrn, '', "the sweep wrote another patient's MRN");

  /* The receipt makes the fill auditable and reversible. */
  const fill = s.ctx.findPatient('a1').identityFill;
  ok(fill && fill.mrn, 'no identityFill receipt was written');
  eq(fill.mrn.value, '123456', 'the receipt lost the filled value');
  eq(fill.mrn.source, 'athenaChartSummaryBlock', 'the receipt lost the source');
  eq(fill.mrn.by, 'mrn-1.0.0', 'the receipt is not attributed to this version');

  /* The PHI-free diagnostics line. */
  const line = s.logs.find((l) => l.indexOf('[mrn-1.0.0]') === 0);
  ok(line, 'the sweep printed no diagnostics line');
  ok(/^\[mrn-1\.0\.0\] filled \d+ of \d+ candidates, \d+ ambiguous$/.test(line), 'diagnostics line has the wrong shape: ' + line);
  for (const leak of ['Jane', 'Doe', '123456', 'a1']) ok(line.indexOf(leak) < 0, 'the diagnostics line leaked ' + leak);

  /* Second run: nothing left to do. */
  const savesBefore = s.saves;
  const snapshot = JSON.stringify(s.rows.map((r) => [r.id, r.mrn, r.dob]));
  let second = null;
  s.ctx.window.__mlsMrnSweep('test-2', (r) => { second = r; });
  s.drain();
  ok(second, 'the second sweep never reported');
  eq(second.filled, 0, 'the second sweep filled something — it is not idempotent');
  eq(s.saves, savesBefore, 'the second sweep wrote to the store despite having nothing to fill');
  eq(JSON.stringify(s.rows.map((r) => [r.id, r.mrn, r.dob])), snapshot, 'the second sweep changed stored identity');
}

/* The dry run is read-only: it reports what WOULD happen and writes nothing. */
{
  const s = build(SOURCE, [
    { id: 'd1', name: 'Jane Doe', mrn: '', dob: '', athenaChartSummaryBlock: 'Jane Doe MRN: 123456' },
    { id: 'd2', name: 'Ann Lee', mrn: 'KEEP-1', dob: '07/08/1990' }
  ]);
  const before = JSON.stringify(s.rows);
  const out = s.ctx.window.__mlsMrnDryRun();
  eq(out.total, 2, 'dry run miscounted the roster');
  eq(out.missingMrn, 1, 'dry run miscounted the missing MRNs');
  eq(out.wouldFillMrn, 1, 'dry run miscounted what it would fill');
  eq(out.bySource.athenaChartSummaryBlock, 1, 'dry run did not attribute the fill to a source');
  eq(s.saves, 0, 'the dry run wrote to the store');
  eq(JSON.stringify(s.rows), before, 'the dry run mutated the roster');
}

/* The block must never key its index to the unresolved-account namespaces the
   store itself hard-refuses. */
{
  const s = build(SOURCE, [STORED]);
  s.ctx.uns = (k) => 'sf_u::undefined::' + k;
  s.ctx.upsertPatient({ id: 'p1', name: 'Jane Doe', mrn: '', dob: '' });
  /* The stored row still testifies directly, so identity survives; what must
     NOT happen is an index entry under the stranded namespace. */
  eq(s.ctx.findPatient('p1').mrn, 'MRN-123456', 'identity was lost under the unresolved-account namespace');
}

/* The install must be idempotent: wrapping twice would double every guard and
   eventually eat the chain. */
{
  const s = build(SOURCE, [STORED]);
  const first = s.ctx.window.upsertPatient;
  vm.runInContext(SOURCE, s.ctx, { filename: 'mrn-1.0.0-again' });
  eq(s.ctx.window.upsertPatient, first, 'the block wrapped the store writer twice');
  ok(first.__mrnOriginal, 'the original store writer is not reachable from the wrapper');
}

console.log('PASS mrn-1.0.0: ' + passed + ' assertions — identity preserved against empty/partial writes on both the single-row and bulk roster paths, a different MRN never merges (conflict recorded), backfill is name-verified, refuses ambiguity, ignores foreign names, is idempotent, and both twins carry identical block bytes');
