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
assert(connect.includes("function paintFab(S)") && connect.includes("'Pulling ' + (S.done || 0) + '/' + (S.total || 0)"),
  'the pill carries live progress instead of a frozen label');

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
assert(si.includes('maxChanges: 12, maxDelayMs: 15000'),
  'the pull batch flushes at the clamp ceiling, not every 4 upserts');
assert(si.includes('if (isFn(window.upsertPatient)) window.upsertPatient(arr[i]);'),
  'stampVisitsProof joins the batch instead of forcing unbatched compresses');

/* ---- 5. provider attribution: scoped pulls stamp their provider ---- */
assert(si.includes('if (!rowProvider && requestedProvider.mode === "selected") rowProvider = requestedProvider.name;'),
  'a provider-scoped pull stamps its provider onto columnless scrape rows');
assert(si.includes('provider: rowProvider,'),
  'the stamped provider is what gets stored');

console.log('PASS pull panel calm under fire: built once + painted in place, pill by default, reporter outlives sweeps, store writes batched and sanitize stood down, scoped pulls attribute their provider');
