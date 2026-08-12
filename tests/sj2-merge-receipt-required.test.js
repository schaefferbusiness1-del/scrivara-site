'use strict';
/* sj-2.0 GUARD: A DUPE-COLLAPSE SELF-HEAL MUST EMIT A RECEIPT NAMING WHAT IT
   MERGED. Pre-registered 2026-08-11 and carried in the authoritative design
   (tests/live-e2e-artifacts/2026-08-11-sj2-patients-idb-design.md), whose six
   standing criteria include "the merge-receipt naming", and whose folded
   residual orders: "sj-2.0's first-act baseline capture must include the 7
   survivors' FIELD TOTALS by name". Provenance: 8 of 8 vanished rows in the
   2026-08-11 investigation were dupe-collapse merges of schedule stubs into
   real charts - the self-heal was RIGHT but SILENT, and only Render's
   independent copy could name them after the fact. A merge that leaves no
   receipt is indistinguishable from a silent row loss (PRESENCE IS NOT
   PROVENANCE).

   THE ONE COLLAPSE SITE: mls-connect.js F5 (installF5), the name+dob dedup
   wrap of upsertPatient - api.dedupStats.merged++ is its only counter, a
   COUNT with no NAMES. This suite executes the REAL F5 slice in vm and
   demands, at the merged++ site, a bounded PHI-lean receipt log
   (window.__mlsPtsMergeReceipts): {at, key:'name+dob', survivorId,
   absorbedId, visitsAdded, offered:{field flags}} - ids and booleans only,
   never names/DOBs/clinical text.

   FAILING-WHEN-VIOLATED, EXECUTED: section 2 runs the CURRENT repo bytes
   with the receipt edit applied IN MEMORY (the contract the phase-2 patcher
   must satisfy) - proving the assertions bind. Section 4 runs the repo bytes
   AS SHIPPED and requires the receipt: on today's silent code that section
   is RED. Register this suite ONLY at the commit whose patcher adds the
   receipt emission (EXISTING IS NOT RUNNING; a red suite must never ride
   the gate).

   REGISTRATION TIMING: with the phase-2 receipt edit (see NOTES.md for the
   drafted find/replace), not with the primitive splice. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');
const mc = fs.readFileSync(path.join(ROOT, 'mls-connect.js'), 'latin1');
function occurrences(hay, needle) { let n = 0, i = 0; for (;;) { i = hay.indexOf(needle, i); if (i < 0) return n; n++; i += needle.length; } }

/* ---- extraction: the F5 dedup block (SUFFIX .. the F6 recording guard) ---- */
const F5_START = 'var SUFFIX = /^(jr|sr|ii|iii|iv|v)$/;';
const F5_END = 'var RG = { on: false';
assert.strictEqual(occurrences(mc, F5_START), 1, 'F5 start anchor: occurrence==1');
assert.strictEqual(occurrences(mc, F5_END), 1, 'F5 end anchor: occurrence==1');
const SLICE = mc.slice(mc.indexOf(F5_START), mc.indexOf(F5_END));

/* ---- source pins: exactly ONE collapse site, and the receipt lives AT it ---- */
assert.strictEqual(occurrences(mc, 'api.dedupStats.merged++;'), 1,
  'exactly ONE dupe-collapse site (F5 merged++). A second collapse site must inherit the receipt requirement.');
assert.ok(SLICE.indexOf('api.dedupStats.merged++;') >= 0, 'the collapse site is inside the extracted F5 slice');

/* ---- the drafted receipt edit (the contract the phase-2 patcher satisfies;
   also this suite's in-memory non-vacuity instrument). Anchor verified
   occurrence==1 against 2026-08-11 bytes. ---- */
const MR_FIND = '                    unionVisits(cand, p.visits);   /* F13e: never orphan pulled visits */\n' +
  '                    p.id = cand.id;\n' +
  '                    api.dedupStats.merged++;\n';
const MR_REPLACE = '                    var __mrAdded = unionVisits(cand, p.visits);   /* F13e: never orphan pulled visits */\n' +
  '                    var __mrAbsorbed = String(p.id);\n' +
  '                    p.id = cand.id;\n' +
  '                    api.dedupStats.merged++;\n' +
  '                    /* sj-2.0 merge receipt (pre-registered 2026-08-11; design\n' +
  '                       criterion "the merge-receipt naming"): a dupe-collapse\n' +
  '                       self-heal must NAME what it merged - the 8 silent stub\n' +
  '                       merges were RIGHT but invisible. PHI-lean: ids + field\n' +
  '                       flags only, newest 60 kept. */\n' +
  '                    try {\n' +
  '                      var __mrLog = window.__mlsPtsMergeReceipts = window.__mlsPtsMergeReceipts || [];\n' +
  '                      __mrLog.push({ at: Date.now(), key: \'name+dob\', survivorId: String(cand.id), absorbedId: __mrAbsorbed, visitsAdded: __mrAdded, offered: { problems: !!p.problems, meds: !!p.meds, allergies: !!p.allergies, dob: !!p.dob, reason: !!p.reason, summary: !!String(p.summary || \'\').trim() } });\n' +
  '                      if (__mrLog.length > 60) __mrLog.splice(0, __mrLog.length - 60);\n' +
  '                    } catch (eMr) {}\n';

function applyReceiptEdit(src) {
  /* the patch-daynote-foldin engine discipline: judge already-applied on the
     REPLACE text first, then demand occurrence==1 on the find */
  if (occurrences(src, MR_REPLACE) === 1) return { src, already: true };
  assert.strictEqual(occurrences(src, MR_FIND), 1,
    'merge-receipt splice anchor: occurrence==1 (F5 merge tail bytes moved - re-anchor the edit)');
  const at = src.indexOf(MR_FIND);
  return { src: src.slice(0, at) + MR_REPLACE + src.slice(at + MR_FIND.length), already: false };
}

/* ---- harness: run the REAL F5 slice, install the wrap, drive merges ---- */
function boot(slice) {
  const upsertCalls = [];
  const arr = [
    { id: 'real-1', name: 'Adam Kirwin', dob: '01/02/1980', problems: 'HTN', visits: [{ date: '2026-07-01', type: 'Office' }] },
    { id: 'real-2', name: 'Beth Optic', dob: '03/04/1970', visits: [] },
  ];
  const win = {
    upsertPatient: function (p) { upsertCalls.push(p); const i = arr.findIndex(x => x && x.id === p.id); if (i >= 0) arr[i] = p; else arr.unshift(p); },
    getPatients: () => arr,
  };
  const ctx = {
    window: win,
    console, JSON, Math, Date, Array, Object, String, Number, Promise, RegExp, Error,
    isFn: f => typeof f === 'function',
    safe: (f, fb) => { try { return f(); } catch (e) { return fb; } },
    isPlaceholderName: () => false,
    api: { dedupStats: { merged: 0, kept: 0 } },
    orig: {},
  };
  ctx.self = ctx.window; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(slice, ctx, { filename: 'mls-connect:F5' });
  assert.strictEqual(typeof ctx.installF5, 'function', 'F5 installer extracted');
  ctx.installF5();
  assert.ok(ctx.window.upsertPatient.__prf, 'the dedup wrap installed');
  return { ctx, arr, upsertCalls, win };
}
const STUB = () => ({ id: 'sched-stub-9', name: 'Kirwin, Adam', dob: '01/02/1980', meds: 'ASA 81', visits: [{ date: '2026-07-07', type: 'Follow up' }] });

/* ---- 1: the merge itself still works (fixture sanity; F5 semantics) ---- */
{
  const h = boot(SLICE);
  h.win.upsertPatient(STUB());
  assert.strictEqual(h.ctx.api.dedupStats.merged, 1, 'the name-variant stub merged into the real chart');
  assert.strictEqual(h.arr.length, 2, 'no new row created');
  assert.strictEqual(h.arr[0].id, 'real-1', 'the existing record won the identity');
  assert.strictEqual(h.arr[0].meds, 'ASA 81', 'clinical context absorbed');
  assert.strictEqual(h.arr[0].visits.length, 2, 'the stub visit was unioned in');
}

/* ---- 2: NON-VACUITY, EXECUTED - with the drafted receipt edit applied in
   memory, the SAME merge emits exactly the receipt this guard demands ---- */
{
  const patched = applyReceiptEdit(SLICE);
  const h = boot(patched.src);
  h.win.upsertPatient(STUB());
  const log = h.win.__mlsPtsMergeReceipts;
  assert.ok(Array.isArray(log) && log.length === 1, 'patched slice: exactly one receipt for one merge');
  const r = log[0];
  assert.strictEqual(r.survivorId, 'real-1', 'receipt names the survivor');
  assert.strictEqual(r.absorbedId, 'sched-stub-9', 'receipt names the absorbed stub');
  assert.strictEqual(r.key, 'name+dob', 'receipt names the collapse key');
  assert.strictEqual(r.visitsAdded, 1, 'receipt counts the absorbed visits');
  /* per-flag compare: r.offered is a vm-realm object, so a host-side
     deepStrictEqual would fail on Object prototypes, not content */
  const wantOffered = { problems: false, meds: true, allergies: false, dob: true, reason: false, summary: false };
  for (const k of Object.keys(wantOffered)) {
    assert.strictEqual(r.offered[k], wantOffered[k], 'receipt flags which fields the absorbed record offered (' + k + ')');
  }
  assert.strictEqual(Object.keys(r.offered).length, 6, 'offered carries exactly the six field flags');
  assert.ok(r.at > 0, 'receipt is timestamped');
  const bytes = JSON.stringify(Object.assign({}, r, { at: 0 })); /* at excluded: an epoch can contain any digit run */
  assert.ok(bytes.indexOf('Kirwin') < 0 && bytes.indexOf('1980') < 0 && bytes.indexOf('ASA') < 0,
    'the receipt is PHI-LEAN: no names, no DOBs, no clinical text');
}

/* ---- 3: NO receipt on a NON-merge (same name, different DOB keeps separate;
   a receipt that fires on kept-separate pairs would be noise wearing a
   receipt's face) ---- */
{
  const patched = applyReceiptEdit(SLICE);
  const h = boot(patched.src);
  h.win.upsertPatient({ id: 'other-7', name: 'Kirwin, Adam', dob: '09/09/1999', visits: [] });
  assert.strictEqual(h.ctx.api.dedupStats.kept, 1, 'same name, different person: kept separate');
  assert.strictEqual(h.ctx.api.dedupStats.merged, 0, 'no merge happened');
  assert.ok(!h.win.__mlsPtsMergeReceipts || h.win.__mlsPtsMergeReceipts.length === 0,
    'no receipt without a merge');
}

/* ---- 4: THE GUARD - the SHIPPED bytes must emit the receipt. On the silent
   pre-phase-2 code this section is RED: that is this suite doing its job
   (register it only with the receipt-emitting commit). ---- */
{
  const h = boot(SLICE);
  h.win.upsertPatient(STUB());
  assert.strictEqual(h.ctx.api.dedupStats.merged, 1, 'shipped slice: the merge ran');
  const log = h.win.__mlsPtsMergeReceipts;
  assert.ok(Array.isArray(log) && log.length === 1,
    'SHIPPED CODE MERGED SILENTLY: dedupStats.merged counted 1 but no receipt names the pair. ' +
    'The pre-registered rule (design: "the merge-receipt naming") requires every dupe-collapse ' +
    'self-heal to emit window.__mlsPtsMergeReceipts entries {at, key, survivorId, absorbedId, ' +
    'visitsAdded, offered} at the merged++ site. Apply the receipt edit (NOTES.md, sj2-drafts) ' +
    'or this stays the 8-silent-merges class.');
  assert.strictEqual(log[0].survivorId, 'real-1', 'shipped receipt names the survivor');
  assert.strictEqual(log[0].absorbedId, 'sched-stub-9', 'shipped receipt names the absorbed stub');
  assert.strictEqual(h.ctx.api.dedupStats.merged, log.length, 'the COUNT and the RECEIPTS agree');
}

console.log('sj2-merge-receipt-required: OK (one collapse site pinned, F5 merge semantics intact, receipt contract ' +
  'proven bindable on the patched slice incl. PHI-lean shape, no receipt on kept-separate, and the SHIPPED bytes ' +
  'emit a receipt whose count matches dedupStats.merged)');
