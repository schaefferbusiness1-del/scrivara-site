'use strict';

/* THE PULL PANEL IS CALM UNDER FIRE (b744, owner watched #36 live).
 * Three defects, one visible symptom ("glitches out every literally second"):
 * 1. render() rebuilt the WHOLE card via innerHTML every 900ms Worker tick,
 *    so b735's mlsLoadIn entrance replayed on a brand-new element ~1/s and
 *    the Hide button died mid-click.
 * 2. ppEnd() fired before the automatic sweeps: full panel teardown at every
 *    sweep boundary, elapsed reset, hidden reset, pull shield dropped.
 * 3. The sanitize sweep ran a full-store LZ compress every 2.5s all pull long
 *    (every _savePatientChart re-dirtied a summary), and the managed batch
 *    flushed a ~1.4s compress every 4 upserts.
 * Plus the owner's escalation: a one-column Day view stored every appointment
 * with an EMPTY provider on a provider-scoped pull. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

/* ---- 1. patch-in-place: build once, paint per tick ---- */
assert(connect.includes('function buildPanel()') && connect.includes('p.__ppBuilt = 1;'),
  'the card must be BUILT once and remembered - node identity is the fix');
assert(connect.includes("if (p && p.__ppBuilt) return p;"),
  'a built panel must never be rebuilt while it lives');
assert(connect.includes("function setText(p, key, val)") &&
  connect.includes("if (el && el.textContent !== val) el.textContent = val;"),
  'paints are no-op-guarded - an unchanged value never re-commits');
const renderStart = connect.indexOf('function render() {', connect.indexOf("var PANEL = 'mlsPullProgPanel'"));
const renderEnd = connect.indexOf('(function loop()', renderStart);
const render = connect.slice(renderStart, renderEnd);
assert(!/p\.innerHTML\s*=/.test(render), 'render() must never assign innerHTML - that was the 1/s glitch');
assert(render.includes("p.__ppRowsSig !== sig"),
  'rows re-render only when a row actually settles, never on the clock');

/* ---- 2. non-blocking by default, hidden survives, live pill ---- */
assert(connect.includes('var startedAt = 0, hidden = true, stopped = false;'),
  'the pull opens as the PILL by default - the modal is one click away');
/* Bump-proof: the build tag inside the source comment is renumbered by every
   bump-build run, so the pin matches the code + comment SHAPE, not the tag. */
assert(/hidden = true; \/\* b\d+: reset to the pill DEFAULT, never to the modal \*\//.test(render),
  'pull end resets to the pill default, never slams the modal back');
/* 2026-09-12: #mlsDsPullBar is a reused view with no run identity. A fast
   second pull could therefore make the pill borrow the prior run's count.
   Both pull surfaces now read the active engine state directly. */
const paintFabStart = connect.indexOf('function paintFab(S)');
const paintFabEnd = connect.indexOf('\n  /* b940 #36', paintFabStart);
const paintFab = connect.slice(paintFabStart, paintFabEnd);
assert(paintFabStart > 0 && paintFabEnd > paintFabStart,
  'the pull pill painter could not be isolated');
assert(!paintFab.includes("document.getElementById('mlsDsPullBar')") &&
  paintFab.includes("var n = (S.done || 0) + '/' + (S.total || 0);"),
  'the pill must use the active run state, never a stale unowned day-pull bar');

/* ---- 2b. pillfirst-1.0.0: the dialog is DOCTOR-OPENED ONLY ----
   OWNER 2026-09-11, verbatim: "when I'm pulling why does this big thing pop
   up, no need for that".
   Every automatic caller - pull start, a phase flip, a needs-attention settle,
   the day-note catch-up, a month job's next day - reaches this module through
   ONE door, render(), off the engine's own state. What opened that door by
   itself was `hidden`: run-scoped state that OUTLIVED its run, so a card the
   doctor opened once and never pressed Done on was still open when the NEXT
   run started. Pinned as the PROPERTY, not as a label: exactly one assignment
   may open the card, it is the pill's own click handler, `hidden` is derived
   from that gesture, and render() re-arms the gate at every run boundary. */
{
  const mod = connect.slice(connect.indexOf("var PANEL = 'mlsPullProgPanel'"),
    connect.indexOf('window.__mlsPullProgress = api;'));
  assert(mod.includes('var userOpened = false;'),
    'the doctor-gesture gate is gone - the dialog can open on leftover state again');
  assert.strictEqual((mod.match(/userOpened = true/g) || []).length, 1,
    'exactly ONE place may open the pull dialog - a second opener is a second way for it to pop up by itself');
  assert(mod.includes("f.onclick = function () { userOpened = true; hidden = false; render(); };"),
    "the only opener is no longer the pill's own click handler");
  assert(mod.includes('var replacedWhileRunning = !!(running && runId && watchedRunId && runId !== watchedRunId);') &&
    mod.includes('var newRun = running && (!wasRunning || replacedWhileRunning);') &&
    mod.includes('if (newRun && (userOpened || replacedWhileRunning)) { userOpened = false; hidden = true; }'),
    'a NEW run no longer returns the surface to the corner pill, including a boundary missed between ticks');
  assert(mod.includes('if (!userOpened && !hidden) hidden = true;'),
    '`hidden` is no longer derived from the gesture, so a stale false can paint the dialog again');
  assert(mod.includes("if (hb) hb.onclick = function () { userOpened = false; hidden = true; render(); };"),
    'Hide no longer gives the gesture back, so the card can re-open later in the same pull');
  /* Stop pull must stay one click away: pill -> dialog -> Stop pull. The pill
     is what makes that route exist, so it is mounted on every running tick. */
  assert(mod.includes('if (hidden) { ensureFab(true); paintFab(S);'),
    'a running pull no longer mounts the pill, so "Stop pull" has no route');
  /* A finished run that still owes the doctor something says so IN THE PILL,
     and reports the card's own number - ONE COUNT, TWO SURFACES. */
  assert(mod.includes('var attnP = failed + dvTnFailed;') &&
    mod.includes("(attnP === 1 ? ' needs' : ' need') + ' attention'"),
    'the finished pill no longer names the rows that need attention');
  assert(mod.indexOf('var dvTnFailed = Math.max(') > 0 &&
    mod.indexOf('var dvTnFailed = Math.max(') < mod.indexOf('var attnP = failed + dvTnFailed;'),
    'the pill reads the day-note debt before renderDone computes it');
}

/* ---- 3. the reporter outlives sweeps (panel lives first row -> true end) ---- */
assert(si.includes('if (!batchBodyCompleted && !sweepDepth) safe(ppEnd);') &&
  !si.includes('} finally { historyBatchRunning = false; ppEnd(); }'),
  'ppEnd left the per-patient finally; sweeps no longer tear the panel down');

/* ---- 4. store writes stop jamming the main thread during pulls ---- */
const sanitize = connect.slice(connect.indexOf('var cleanRuns = 0;'), connect.indexOf('var iv = null; try { iv = setInterval(tick, 2500); }'));
assert(sanitize.includes('window.__mlsPullBusyAt') && sanitize.includes('.state.running'),
  'the sanitize sweep must stand down while a pull is running');
assert(sanitize.includes('if (pulling) { cleanRuns = 0; return; }'),
  'a stood-down pass must not count toward self-retirement');
const continuousStart = connect.indexOf('CONTINUOUS SUMMARY SCRUB');
const continuousEnd = connect.indexOf('var iv = null; try { iv = setInterval(scrub, 2500);', continuousStart);
const continuous = connect.slice(continuousStart, continuousEnd);
assert(continuous.includes('window.__mlsPullBusyAt') && continuous.includes('.state.running'),
  'Continuous Scrub must stand down while a pull is running');
const continuousBusyReturn = continuous.indexOf('if (pulling) return;');
const continuousVersionStamp = continuous.indexOf('st8.lastScrubVer = v8');
assert(continuousBusyReturn >= 0 && continuousVersionStamp >= 0 &&
  continuousBusyReturn < continuousVersionStamp,
  'Continuous Scrub must not stamp a busy store version as clean');
const baseStart = connect.indexOf("try { if (window.__mlsSummarySanitize) return; }");
const baseEnd = connect.indexOf('function tick() { wrapIngest(); wrapSaveChart(); scrubExisting(); }', baseStart);
const baseSanitize = connect.slice(baseStart, baseEnd);
const baseBusyReturn = baseSanitize.indexOf('if (pulling) return;');
const baseRosterRead = baseSanitize.indexOf('window.getPatients');
assert(baseSanitize.includes('window.__mlsPullBusyAt') && baseSanitize.includes('.state.running') &&
  baseBusyReturn >= 0 && baseRosterRead >= 0 && baseBusyReturn < baseRosterRead,
  'base startup scrub must defer before reading or rewriting the roster during a pull');
assert(si.includes('cooperative: true, maxChanges: 64, maxDelayMs: 15000'),
  'the pull batch no longer uses unique-patient cooperative checkpoints');
assert(si.includes('if (isFn(window.upsertPatient)) window.upsertPatient(arr[i]);'),
  'stampVisitsProof joins the batch instead of forcing unbatched compresses');

/* ---- 5. provider attribution: scoped pulls stamp their provider ---- */
assert(si.includes('if (!rowProvider && requestedProvider.mode === "selected") rowProvider = requestedProvider.name;'),
  'a provider-scoped pull stamps its provider onto columnless scrape rows');
assert(si.includes('provider: rowProvider,'),
  'the stamped provider is what gets stored');

/* ---- 5b. THE BEHAVIORAL ARM (pa-1.0.0) — the assertion whose absence let
   b744 ship dead: the b744 stamp lived in the CREATE path, but
   scopeProviderRows ran FIRST and returned zero rows for a columnless scoped
   grid, so the stamp was unreachable. This arm RUNS the real gate. ---- */
{
  const vm = require('vm');
  const head = si.slice(si.indexOf('var PROVIDER_NOISE = {'), si.indexOf('function normDob(s)'));
  const tailStart = si.indexOf('function firstField(');
  const tailEnd = si.indexOf('\n', si.indexOf('function rowProviderId('));
  assert(tailStart > 0 && tailEnd > tailStart, 'helper slice anchors must exist');
  const tail = si.slice(tailStart, tailEnd + 1);
  const ctx = { window: {}, console };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(
    'var safe=function(f,d){try{return f()}catch(e){return d}};var isFn=function(f){return typeof f===\'function\'};\n' +
    head + '\n' + tail + '\nthis.__scope=scopeProviderRows;',
    ctx, { filename: 'scopeProviderRows-slice.js' });
  const COLUMNLESS = [
    { name: 'A Patient', dob: '01/01/1980', time: '9:00 AM' },
    { name: 'B Patient', dob: '02/02/1981', time: '9:30 AM' }
  ];
  const RESP = { receipt: { complete: true } };
  /* columnless + roster-verified scope -> FILLED, complete, counted */
  const filled = ctx.__scope(COLUMNLESS, { name: 'Cheston Simmons, MD', id: '7', rosterVerified: true }, RESP);
  assert.strictEqual(filled.complete, true, 'a columnless scoped grid must now IMPORT (b744 returned zero rows here)');
  assert.strictEqual(filled.rows.length, 2, 'every columnless row rides the scoped fill');
  assert.strictEqual(filled.rows[0].provider, 'Cheston Simmons, MD', 'the fill stamps the requested provider');
  assert.strictEqual(filled.receipt.scopeFilledRows, 2, 'the receipt counts every filled row');
  assert.strictEqual(filled.receipt.attribution, 'requested-scope-columnless', 'the receipt names the attribution source');
  assert(!COLUMNLESS[0].provider, 'the caller rows are never mutated - the fill copies');
  /* MIXED grid (one tagged row) stays fail-closed exactly as before */
  const MIXED = [
    { name: 'A Patient', dob: '01/01/1980', provider: 'Someone Else, MD' },
    { name: 'B Patient', dob: '02/02/1981' }
  ];
  const mixed = ctx.__scope(MIXED, { name: 'Cheston Simmons, MD', id: '7', rosterVerified: true }, RESP);
  assert.strictEqual(mixed.complete, false, 'a MIXED grid must stay provider-incomplete - never guessed');
  assert.strictEqual(mixed.rows.length, 0, 'a fail-closed scope imports nothing');
  /* incomplete sweep -> no fill */
  const incompleteSweep = ctx.__scope(COLUMNLESS, { name: 'Cheston Simmons, MD', id: '7', rosterVerified: true }, { receipt: { complete: false } });
  assert.strictEqual(incompleteSweep.complete, false, 'an unfinished sweep must never scope-fill');
  /* unverified, unnamed provider -> no fill */
  const unverified = ctx.__scope(COLUMNLESS, { name: 'Total Stranger, MD' }, RESP);
  assert.strictEqual(unverified.complete, false, 'an unverified provider the read never named must not scope-fill');
  /* all-scope stays honestly untouched */
  const allScope = ctx.__scope(COLUMNLESS, 'All providers', RESP);
  assert(allScope.rows.every(function (r) { return !r.provider; }), 'an all-scope pull never invents attribution');
}

console.log('PASS pull panel calm under fire: built once + painted in place, pill by default, the dialog opens ONLY from the pill click and every run boundary re-arms that gate, reporter outlives sweeps, store writes batched and sanitize stood down, scoped pulls attribute their provider');
