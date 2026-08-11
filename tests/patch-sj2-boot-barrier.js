#!/usr/bin/env node
'use strict';
/* =============================================================================
 * patch-sj2-boot-barrier.js  (sj-2.0 phase-2, Commit A step 3, conflict C4)
 * 2026-08-11
 *
 * BOOT INIT()/READY-BARRIER WIRING - the deliverable no draft stage owned
 * (INTEGRATION-ORDER.md conflict C4): after session identity resolves (NEVER
 * before - the sf_u::undefined:: class; the primitive refuses but boot must
 * not even try), boot calls __mlsPtsStore.init() and the FIRST
 * roster-dependent paint awaits ready(). Without this, a migrated account's
 * next reload serves an EMPTY roster forever (isReady never true -> legacy
 * path -> the blob was deleted at migration).
 *
 * DESIGN (three exact-byte splices, ScribeFlow.html only):
 *   1. bb-helper: __mlsPtsBootBarrier(paint) defined immediately before
 *      startSession. A SYNC probe decides the mode: gen stamp present AND
 *      blob absent == migrated. Pre-migration (and with no store at all) the
 *      paint runs SYNCHRONOUSLY on the same line it always ran - boot timing
 *      byte-compatible with today; init() still fires so the storage listener
 *      installs and the boot receipt exists. Post-migration the paint awaits
 *      init() settling, bounded by a 4000ms fail-open (a hung IndexedDB open
 *      must never brick boot; the re-routed readers fall through to the
 *      legacy path = loud-empty, never stale PHI).
 *   2. bb-paint-wrap: the startSession roster paint block (renderDots ->
 *      scheduleNavCounts) wrapped in the barrier. Inner bytes are IDENTICAL
 *      (registered pins: showView('visit') before scheduleNavCounts inside
 *      the startSession window - route-patient-read-fastpath-contract:34).
 *   3. bb-identity-reinit: refreshMe's mid-boot identity-change branch
 *      re-runs init() (idempotent per account key; re-inits on key change) so
 *      an account reached via identity drift is not stranded on the legacy
 *      loud-empty path until the next reload. Fire-and-forget: the paints for
 *      that rare path already happened; the store hydrates behind them.
 *
 * EOL SAFETY: latin1 read/write, exact-byte splices, occurrence==1 asserts,
 * ASCII-only ADDED bytes (the paint-region find contains the file's existing
 * UTF-8 em-dash bytes, built via String.fromCharCode so this file itself
 * stays pure ASCII). Already-applied judged on the REPLACE text (engine:
 * tests/patch-daynote-foldin.js). Backups OUTSIDE the repo.
 *
 * MODES:
 *   node tests/patch-sj2-boot-barrier.js            DRY-RUN (writes nothing)
 *   node tests/patch-sj2-boot-barrier.js --apply    apply (backup to tmpdir)
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');
const SF = 'ScribeFlow.html';

/* the file's existing em-dash (UTF-8 bytes read as latin1) in the
   showView('visit') trailing comment - part of the FIND, never added */
const EMDASH = String.fromCharCode(0xe2, 0x80, 0x94);

const BARRIER_FN =
  '/* sj-2.0 C4 boot barrier (INTEGRATION-ORDER Commit A step 3). After session\n' +
  '   identity resolves, boot calls __mlsPtsStore.init() and the FIRST\n' +
  '   roster-dependent paint awaits ready() - a migrated account whose init()\n' +
  '   never runs would serve an EMPTY roster forever (isReady never true ->\n' +
  '   legacy path -> the blob was deleted at migration). Pre-migration the\n' +
  '   barrier is inert-fast: the sync probe (gen stamp present AND blob absent\n' +
  '   == migrated) keeps today\'s synchronous paint timing identical; init()\n' +
  '   still fires so the store\'s storage listener installs and the boot\n' +
  '   receipt exists. Fail-open by design: a refused init (namespace guard) or\n' +
  '   a hung IndexedDB open must never brick boot - the paint runs anyway\n' +
  '   after 4000ms and the re-routed readers fall through to the legacy path\n' +
  '   (loud-empty, never stale PHI). */\n' +
  'function __mlsPtsBootBarrier(paint){\n' +
  '  var ranPaint=false;\n' +
  '  var runPaint=function(why){\n' +
  '    if(ranPaint)return; ranPaint=true;\n' +
  '    if(why){ try{ console.warn(\'[pts-boot] roster paint released by \'+why+\' (store not hydrated - legacy path serves loud-empty until it is)\'); }catch(_e){} }\n' +
  '    try{ paint(); }catch(ePb){ try{ console.error(\'[pts-boot] roster paint failed\',ePb); }catch(_e2){} }\n' +
  '  };\n' +
  '  var store=null; try{ store=window.__mlsPtsStore; }catch(ePs){}\n' +
  '  if(!store||typeof store.init!==\'function\'){ runPaint(); return; }\n' +
  '  var p=null;\n' +
  '  try{ p=store.init(); }catch(ePi){ p=null; }\n' +
  '  try{ window.__mlsPtsBootReady=p; }catch(ePw){}\n' +
  '  if(!p||typeof p.then!==\'function\'){ runPaint(); return; }\n' +
  '  p.then(null,function(ePr){ try{ console.warn(\'[pts-boot] store init refused: \'+String((ePr&&ePr.message)||ePr)); }catch(_e){} return null; });\n' +
  '  var migrated=false;\n' +
  '  try{ migrated=(localStorage.getItem(uns(\'ptsGenV2\'))!=null)&&(localStorage.getItem(uns(\'patients\'))==null); }catch(ePm){}\n' +
  '  if(!migrated){ runPaint(); return; }\n' +
  '  p.then(function(){ runPaint(); },function(){ runPaint(\'init-refusal\'); });\n' +
  '  setTimeout(function(){ runPaint(\'4000ms fail-open timeout\'); },4000);\n' +
  '}\n';

const EDITS = [
  {
    file: SF, id: 'bb-helper',
    why: 'the barrier function itself, defined immediately before startSession (called at runtime, long after every script parsed, so uns()/__mlsPtsStore resolve as globals).',
    find: 'function startSession(email){\n',
    replace: BARRIER_FN + 'function startSession(email){\n'
  },
  {
    file: SF, id: 'bb-paint-wrap',
    why: 'the first roster-dependent paint (renderDots -> scheduleNavCounts) runs behind the barrier. Inner bytes byte-identical; pre-migration the barrier calls the closure synchronously on this very line.',
    find:
      '  renderDots();\n' +
      '  newVisit({preserveRecovery:true});\n' +
      "  showView('visit');   // land ready to record the first patient " + EMDASH + ' not the busy Patients list\n' +
      '  /* Counts are data-owned, not route-owned. Refresh them after sign-in only\n' +
      '     when the browser is genuinely idle so an existing large roster cannot\n' +
      '     block the first Visit click, while local/offline accounts never remain at\n' +
      "     the markup's temporary zero badges. */\n" +
      '  scheduleNavCounts();',
    replace:
      '  /* sj-2.0 C4: the first roster-dependent paint runs behind the patient-\n' +
      '     store boot barrier. Pre-migration it paints synchronously right here\n' +
      '     (call order identical to the un-wrapped block); post-migration it\n' +
      '     awaits store hydration so the first paint never serves an empty\n' +
      '     roster. */\n' +
      '  __mlsPtsBootBarrier(function(){\n' +
      '  renderDots();\n' +
      '  newVisit({preserveRecovery:true});\n' +
      "  showView('visit');   // land ready to record the first patient " + EMDASH + ' not the busy Patients list\n' +
      '  /* Counts are data-owned, not route-owned. Refresh them after sign-in only\n' +
      '     when the browser is genuinely idle so an existing large roster cannot\n' +
      '     block the first Visit click, while local/offline accounts never remain at\n' +
      "     the markup's temporary zero badges. */\n" +
      '  scheduleNavCounts();\n' +
      '  });'
  },
  {
    file: SF, id: 'bb-identity-reinit',
    why: 'C4 side door: a mid-boot identity change (refreshMe resolves a different email than the stored session) re-binds the store to the token-authenticated namespace; init() is idempotent per key and re-inits on a key change.',
    find: "          try{ sfResetSessionBoundary(em,{reason:'identity-change',previousAccount:previousIdentity}); }catch(e){}\n",
    replace:
      "          try{ sfResetSessionBoundary(em,{reason:'identity-change',previousAccount:previousIdentity}); }catch(e){}\n" +
      '          /* sj-2.0 C4: re-run the patient-store init for the token-\n' +
      '             authenticated namespace (idempotent per account key). Without\n' +
      '             this, a migrated account reached via identity drift stays on\n' +
      '             the legacy loud-empty path until the next reload. */\n' +
      "          try{ if(window.__mlsPtsStore&&typeof window.__mlsPtsStore.init==='function'){ window.__mlsPtsBootReady=window.__mlsPtsStore.init(); window.__mlsPtsBootReady.then(null,function(ePtsIc){ try{ console.warn('[pts-boot] identity-change init refused: '+String((ePtsIc&&ePtsIc.message)||ePtsIc)); }catch(_e){} }); } }catch(ePtsI){}\n"
  }
];

function occurrences(hay, needle) {
  let n = 0, i = 0;
  for (;;) { i = hay.indexOf(needle, i); if (i < 0) return n; n++; i += needle.length; }
}

function assertAsciiAdded(e) {
  /* every byte the edit ADDS must be ASCII; the find may carry existing
     non-ASCII file bytes (the em-dash), which the replace re-emits verbatim */
  for (let i = 0; i < e.replace.length; i++) {
    const c = e.replace.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) continue;
    const tri = e.replace.slice(i, i + 3);
    if (tri === EMDASH && e.find.indexOf(EMDASH) >= 0) { i += 2; continue; }
    throw new Error('[' + e.id + '] non-ASCII ADDED byte 0x' + c.toString(16) + ' at replace offset ' + i);
  }
}

function applyToSources(sources, opts) {
  opts = opts || {};
  const out = Object.assign({}, sources);
  const log = [];
  for (const e of EDITS) {
    assertAsciiAdded(e);
    const src = out[e.file];
    if (typeof src !== 'string') throw new Error('missing source for ' + e.file);
    const nFind = occurrences(src, e.find);
    const nRepl = occurrences(src, e.replace);
    if (nRepl === 1) {
      if (opts.tolerateApplied) { log.push({ id: e.id, file: e.file, status: 'already-applied' }); continue; }
      throw new Error('[' + e.id + '] in ' + e.file + ': already applied - refusing to double-splice');
    }
    if (nFind !== 1) {
      throw new Error('ANCHOR FAILURE [' + e.id + '] in ' + e.file + ': expected occurrence==1, found ' + nFind +
        (nRepl ? ' (replacement text present ' + nRepl + 'x)' : ''));
    }
    const at = src.indexOf(e.find);
    out[e.file] = src.slice(0, at) + e.replace + src.slice(at + e.find.length);
    log.push({ id: e.id, file: e.file, status: 'ok', at });
  }
  return { sources: out, log };
}

function postchecks(app) {
  const must = (cond, msg) => { if (!cond) throw new Error('POSTCHECK FAIL: ' + msg); };
  /* the primitive must already be spliced (Commit A order: splice, then barrier) */
  must(occurrences(app, '/* ===== BEGIN mls-pts-store (sj-2.0) ===== */') === 1, 'primitive BEGIN marker present exactly once');
  must(occurrences(app, 'function __mlsPtsBootBarrier(paint){') === 1, 'barrier defined exactly once');
  /* route-patient-read-fastpath-contract:34 - inside the startSession window,
     showView(visit) still precedes scheduleNavCounts */
  const s0 = app.indexOf('function startSession(email)');
  const s1 = app.indexOf('function logout(force)', s0);
  must(s0 >= 0 && s1 > s0, 'startSession window located');
  const w = app.slice(s0, s1);
  must(w.indexOf("showView('visit');") >= 0 && w.indexOf('scheduleNavCounts();') >= 0 &&
    w.indexOf("showView('visit');") < w.indexOf('scheduleNavCounts();'),
    'showView(visit) precedes scheduleNavCounts inside the startSession window (registered pin)');
  must(w.indexOf('__mlsPtsBootBarrier(function(){') >= 0, 'startSession paints through the barrier');
  /* the barrier definition sits BEFORE the startSession window, so the
     window extraction (indexOf on the function head) is unmoved */
  must(app.indexOf('function __mlsPtsBootBarrier(paint){') < s0, 'barrier defined before startSession');
  /* the latch stays 1 writer / 0 readers */
  must(occurrences(app, '__mlsPtsEdit' + 'AtRiskUnknown') === 1, 'qg latch identifier count unmoved (1 writer, 0 readers)');
}

function main() {
  const APPLY = process.argv.indexOf('--apply') >= 0;
  const full = path.join(ROOT, SF);
  const sources = { [SF]: fs.readFileSync(full, 'latin1') };
  console.log('read  ' + SF + '  (' + sources[SF].length + ' bytes, latin1)');

  let result;
  try { result = applyToSources(sources, { tolerateApplied: !APPLY }); }
  catch (err) { console.error('\nDRY-RUN: FAIL'); console.error(String(err && err.message || err)); process.exit(1); }

  const applied = result.log.filter(l => l.status === 'already-applied');
  if (applied.length === EDITS.length) {
    console.log('\nDRY-RUN: ALL ' + EDITS.length + ' EDITS ALREADY APPLIED - the repo carries the sj-2.0 boot barrier; nothing to do.');
    return;
  }
  if (applied.length > 0) {
    console.error('\nDRY-RUN: FAIL - PARTIAL APPLY: ' + applied.length + '/' + EDITS.length +
      ' edits already present (' + applied.map(l => l.id).join(', ') + '). Restore ' + SF + ' from git before this patcher may run.');
    process.exit(1);
  }
  for (const l of result.log) console.log('anchor ok  [' + l.id + ']  ' + l.file + ' @' + l.at);
  try { postchecks(result.sources[SF]); }
  catch (err) { console.error('\nDRY-RUN: FAIL'); console.error(String(err && err.message || err)); process.exit(1); }
  console.log('post-splice size ' + SF + ': ' + sources[SF].length + ' -> ' + result.sources[SF].length +
    ' (+' + (result.sources[SF].length - sources[SF].length) + ' bytes)');
  console.log('\nDRY-RUN: PASS - ' + result.log.length + '/' + EDITS.length + ' anchors verified, postchecks held.');

  if (!APPLY) { console.log('No files written. Re-run with --apply to splice (backup goes OUTSIDE the repo).'); return; }

  const os = require('os');
  const bakDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sj2bb-bak-'));
  fs.writeFileSync(path.join(bakDir, SF + '.sj2bb.bak'), sources[SF], 'latin1');
  fs.writeFileSync(full, result.sources[SF], 'latin1');
  console.log('APPLIED ' + SF + ' (backup: ' + path.join(bakDir, SF + '.sj2bb.bak') + ')');
}

if (require.main === module) main();
module.exports = { EDITS, applyToSources, occurrences, postchecks, BARRIER_FN };
