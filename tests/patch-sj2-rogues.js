#!/usr/bin/env node
'use strict';
/* =============================================================================
 * patch-sj2-rogues.js  (sj-2.0 phase-2, ROGUES stage)  2026-08-11  DRAFT
 *
 * Re-routes the direct patients-blob readers/writers ("fifth-reader class")
 * through the sj-2.0 primitive `window.__mlsPtsStore`, per the AUTHORITATIVE
 * design tests/live-e2e-artifacts/2026-08-11-sj2-patients-idb-design.md:
 *
 *   - b121 _restoreSnapshot (feat_mls_b121_pack.js, design ":2090"): the
 *     emergency whole-store rewind wrote the raw snapshot straight onto the
 *     blob key. Post-migration that re-creates a STALE localStorage blob,
 *     trips the primitive's both-blob-and-idb-present fail-closed boot, and
 *     silently diverges from the IndexedDB copy. Re-routed: decode + parse
 *     the snapshot, then __mlsPtsStore.saveAsync(rows,{allowRemovals:true})
 *     (a whole-roster delta can never honestly fit the 256KB sync journal;
 *     a human-confirmed whole-store rewind IS an intentional removal path).
 *   - b121 snapshotRotate (SWEEP FINDING, missed by the design's rogue list):
 *     mints the pre-merge snapshot by reading the blob key directly. Post-
 *     migration the read returns null -> merges refuse on 'no-snapshot' with
 *     a MISLEADING quota framing; and re-minting a multi-MB snapshot into
 *     localStorage would re-create the exact ceiling sj-2.0 removes.
 *     REFUSE-AND-REPORT: in idb mode it declines loudly with the true reason
 *     (merge stays fail-closed, unchanged semantics, honest message).
 *   - visitfix hydrateFromPersisted fallback (feat_mls_visitfix.js, design
 *     ":237"): direct read+decode of the blob as the rich-visit hydration
 *     source when getPatients() is empty. Post-migration it silently serves
 *     ZERO rich rows. Re-routed: when the primitive is live, serve the
 *     fallback from its in-memory roster (sync getRoster()); the legacy raw
 *     read+decode stays byte-for-byte for pre-migration boots.
 *   - legal-chart-fill-ui.js patients() fallback (SWEEP FINDING, same rogue
 *     class, missed by the design): direct read+decode of the blob when
 *     window.getPatients is absent. Same re-route shape as visitfix.
 *
 * Every re-route is guarded by `__mlsPtsStore && isReady()`, so the edits are
 * INERT until the primitive is spliced AND migrate() has completed - applying
 * this patcher before/after the primitive lands changes nothing pre-cutover.
 *
 * PINNED-CONTRACT COMPLIANCE:
 *   - tests/patient-store-compression-runtime.test.js item 7 pins that
 *     feat_mls_visitfix.js and legal-chart-fill-ui.js contain '__mlsPtsDecode'
 *     - both legacy decode paths SURVIVE these edits (asserted below).
 *   - the qg-2.0 at-risk latch identifier appears NOWHERE in this file or in
 *     any replacement (one writer, zero readers - a registered guard counts).
 *   - the two retired v1 journal key names appear nowhere here.
 *
 * EOL SAFETY (measured 2026-08-11 against current repo bytes):
 *   feat_mls_visitfix.js   MIXED-EOL (532 CRLF + 349 lone-LF) - anchors LF
 *   feat_mls_b121_pack.js  MIXED-EOL (5008 CRLF + 216 lone-LF) - anchors CRLF
 *   legal-chart-fill-ui.js pure LF
 * Files are read and written as latin1 (byte-preserving); every edit is an
 * exact byte splice with an occurrence==1 assertion; replacements carry the
 * SAME EOL flavor as the region they land in. No line-based rewrite, no
 * normalization, ever. All replacement bytes are ASCII (self-checked below).
 *
 * MODES (engine shape copied from tests/patch-daynote-foldin.js, including
 * its REPLACE-judged already-applied refusal so a second --apply can never
 * double-splice):
 *   node patch-sj2-rogues.js            -> DRY-RUN: verify every anchor
 *                                          (occurrence==1) + print report.
 *                                          Writes NOTHING.
 *   node patch-sj2-rogues.js --apply    -> apply splices, write .sj2rogues.bak
 *                                          first, then patched files.
 *
 * ROOT RESOLUTION: this draft lives OUTSIDE the repo. Set MLS_REPO_ROOT, or
 * copy the file into <repo>/tests/ where it self-resolves. It REFUSES to
 * guess (dispatch-clones-drift class: a wrong default silently patches the
 * wrong checkout).
 *
 * AFTER APPLY (release-train checklist, not done by this script):
 *   1. register a contract test for these re-routes in tests/run-all.js
 *      (EXISTING IS NOT RUNNING - an unregistered fence never executes);
 *   2. run the full suite gate with the completeness line (GATE_PLAN/COMPLETE);
 *   3. these edits ship WITH (or after) the primitive splice train - never as
 *      a lone ship, so the acceptance run judges them together.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

/* Lazy: only main() needs a repo on disk. Requiring this module for its
 * EDITS/applyToSources (the contract-test seam) must never demand one. */
function resolveRoot() {
  if (process.env.MLS_REPO_ROOT) return process.env.MLS_REPO_ROOT;
  const guess = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(guess, 'feat_mls_b121_pack.js')) &&
      fs.existsSync(path.join(guess, 'ScribeFlow.html'))) return guess;
  console.error('REFUSING to guess the repo root: set MLS_REPO_ROOT or place this file in <repo>/tests/.');
  process.exit(1);
}

const VF = 'feat_mls_visitfix.js';
const B121 = 'feat_mls_b121_pack.js';
const LG = 'legal-chart-fill-ui.js';

/* CRLF helper: feat_mls_b121_pack.js anchors live in CRLF regions. Writing
 * the replacement in the same flavor keeps the file's byte texture intact. */
function crlf(s) { return s.split('\n').join('\r\n'); }

/* ---------------------------------------------------------------------------
 * EDITS. Each: { file, id, why, find, replace }. `find` must occur EXACTLY
 * ONCE in the file's current bytes when applied (sequential application).
 * ------------------------------------------------------------------------- */
const EDITS = [

  /* ==== 1. visitfix: hydration fallback reads the store, not the blob ===== */
  {
    file: VF, id: 'vf-hydrate-fallback-reroute',
    why: 'design rogue ":237": post-migration the direct read returns null and rich-visit hydration silently dies; the primitive\'s in-memory roster is the persisted state and is readable synchronously.',
    find:
      '              if(!prev.length&&!noDecode){\n' +
      "                var rawLs=(typeof window.uns==='function')?localStorage.getItem(window.uns('patients')):null;\n" +
      "                if(rawLs&&typeof window.__mlsPtsDecode==='function')rawLs=window.__mlsPtsDecode(rawLs);\n" +
      '                prev=rawLs?JSON.parse(rawLs):[];\n' +
      '                for(k=0;k<prev.length;k++){if(prev[k]&&prev[k].id)prevMap[prev[k].id]=prev[k];}\n' +
      '              }',
    replace:
      '              if(!prev.length&&!noDecode){\n' +
      '                /* sj-2.0 ROGUE RE-ROUTE (design: tests/live-e2e-artifacts/2026-08-11-sj2-patients-idb-design.md):\n' +
      '                   post-migration the patients blob key is RETIRED from localStorage,\n' +
      '                   so the raw read below returns null and this hydration source dies\n' +
      '                   SILENTLY (stale-empty, not loud). When the primitive is live its\n' +
      '                   in-memory roster IS the persisted state - serve the fallback from\n' +
      '                   there (sync). The legacy raw read+decode stays byte-for-byte for\n' +
      '                   pre-migration boots, where localStorage is still authoritative. */\n' +
      '                var vfxSjStore=window.__mlsPtsStore;\n' +
      "                if(vfxSjStore&&typeof vfxSjStore.isReady==='function'&&vfxSjStore.isReady()){\n" +
      '                  try{prev=vfxSjStore.getRoster()||[];}catch(eSjRoster){prev=[];}\n' +
      '                }else{\n' +
      "                  var rawLs=(typeof window.uns==='function')?localStorage.getItem(window.uns('patients')):null;\n" +
      "                  if(rawLs&&typeof window.__mlsPtsDecode==='function')rawLs=window.__mlsPtsDecode(rawLs);\n" +
      '                  prev=rawLs?JSON.parse(rawLs):[];\n' +
      '                }\n' +
      '                for(k=0;k<prev.length;k++){if(prev[k]&&prev[k].id)prevMap[prev[k].id]=prev[k];}\n' +
      '              }'
  },

  /* ==== 2. b121: _restoreSnapshot rewinds through the primitive =========== */
  {
    file: B121, id: 'b121-restore-snapshot-reroute',
    why: 'design rogue ":2090": a direct setItem post-migration re-creates a stale blob, trips the both-blob-and-idb-present fail-closed boot, and silently diverges from IndexedDB. Rewind now routes through saveAsync({allowRemovals:true}); ls-mode path byte-identical.',
    find: crlf(
      "      var bk = JSON.parse(localStorage.getItem(key + '::b121backup::1') || 'null');\n" +
      "      if (!bk || typeof bk.raw !== 'string') return 'no-snapshot';\n" +
      '      localStorage.setItem(key, bk.raw);\n' +
      '      refreshRenders();\n' +
      "      return 'restored snapshot from ' + bk.at;"),
    replace: crlf(
      "      var bk = JSON.parse(localStorage.getItem(key + '::b121backup::1') || 'null');\n" +
      "      if (!bk || typeof bk.raw !== 'string') return 'no-snapshot';\n" +
      '      var sjStore = window.__mlsPtsStore;\n' +
      "      if (sjStore && typeof sjStore.isReady === 'function' && sjStore.isReady()) {\n" +
      '        /* sj-2.0 ROGUE RE-ROUTE (design: tests/live-e2e-artifacts/2026-08-11-sj2-patients-idb-design.md):\n' +
      '           post-migration the patients blob key is RETIRED. A direct setItem here\n' +
      '           would re-create a stale localStorage blob, trip the primitive\'s\n' +
      '           both-blob-and-idb-present fail-closed boot, and silently diverge from\n' +
      '           the IndexedDB copy. The rewind now routes through the primitive\'s bulk\n' +
      '           confirm-awaiting path (a whole-roster delta can never honestly fit the\n' +
      '           256KB sync journal) with allowRemovals - a human-confirmed whole-store\n' +
      '           rewind IS an intentional removal path (it clears the foreign-carry set\n' +
      '           by design, exactly like purge). Returns a PROMISE in this mode; this is\n' +
      '           a console-only emergency API and log() reports the settled verdict. */\n' +
      '        var sjRaw = bk.raw;\n' +
      "        try { if (typeof window.__mlsPtsDecode === 'function') sjRaw = window.__mlsPtsDecode(sjRaw); } catch (eSjDec) {}\n" +
      '        var sjRows = null;\n' +
      '        try { sjRows = JSON.parse(sjRaw); } catch (eSjParse) { sjRows = null; }\n' +
      "        if (!Array.isArray(sjRows)) return 'restore-refused: the snapshot does not decode to a patient array - nothing was written';\n" +
      '        return sjStore.saveAsync(sjRows, { allowRemovals: true }).then(function (sjRes) {\n' +
      '          refreshRenders();\n' +
      "          log('restored snapshot from ' + bk.at + ' via __mlsPtsStore: ' + sjRows.length + ' row(s), IndexedDB-confirmed gen ' + ((sjRes && sjRes.confirmedGen) || '?') + '.');\n" +
      "          return 'restored snapshot from ' + bk.at + ' (' + sjRows.length + ' rows, IndexedDB-confirmed)';\n" +
      '        }, function (eSjSave) {\n' +
      "          log('restore FAILED in __mlsPtsStore: ' + ((eSjSave && eSjSave.message) || eSjSave) + ' - the retired blob key was NOT rewritten. Check __mlsPtsStore.receipt(): a degraded write-behind may still hold the rewind in memory awaiting IndexedDB.');\n" +
      "          return 'restore-failed: ' + ((eSjSave && eSjSave.message) || eSjSave);\n" +
      '        });\n' +
      '      }\n' +
      '      localStorage.setItem(key, bk.raw);\n' +
      '      refreshRenders();\n' +
      "      return 'restored snapshot from ' + bk.at;")
  },

  /* ==== 3. b121: snapshotRotate refuses HONESTLY in idb mode ============== */
  {
    file: B121, id: 'b121-snapshot-rotate-honest-refusal',
    why: 'SWEEP FINDING (design missed it): the pre-merge snapshot reads the blob key directly. Post-migration it would refuse with a misleading quota framing; minting a multi-MB localStorage snapshot would re-create the ceiling sj-2.0 removes. Refuse-and-report with the true reason; merges stay fail-closed (unchanged semantics).',
    find: crlf(
      '  function snapshotRotate(key) {\n' +
      '    /* FRESH snapshot before EACH merging run; two generations kept.\n' +
      "       ::1 = newest (this run's pre-merge state), ::2 = previous run's. */\n" +
      '    try {\n' +
      '      var raw = localStorage.getItem(key);\n' +
      "      if (raw == null) return '';"),
    replace: crlf(
      '  function snapshotRotate(key) {\n' +
      '    /* FRESH snapshot before EACH merging run; two generations kept.\n' +
      "       ::1 = newest (this run's pre-merge state), ::2 = previous run's. */\n" +
      '    try {\n' +
      '      var sjStoreSr = window.__mlsPtsStore;\n' +
      "      if (sjStoreSr && typeof sjStoreSr.isReady === 'function' && sjStoreSr.isReady()) {\n" +
      '        /* sj-2.0 REFUSE-AND-REPORT (design: tests/live-e2e-artifacts/2026-08-11-sj2-patients-idb-design.md):\n' +
      '           post-migration the blob key is retired, so the read below returns null\n' +
      "           and the merge lane refuses on 'no-snapshot' - correct, but its\n" +
      '           "storage quota?" framing would misdiagnose. Say the true reason. And\n' +
      '           minting a multi-MB JSON snapshot into localStorage here would re-create\n' +
      '           the exact quota ceiling sj-2.0 removes, so pre-merge snapshots are NOT\n' +
      '           minted in idb mode until the b121 snapshot lane moves to IndexedDB\n' +
      '           (open question in the sj-2.0 rogues NOTES). Merges stay fail-closed:\n' +
      '           no snapshot, no merge - unchanged semantics, honest message. */\n' +
      "        log('sj-2.0: pre-merge snapshots are not minted post-migration (the patients blob left localStorage). Merges refuse fail-closed until the b121 snapshot lane moves to IndexedDB.');\n" +
      "        return '';\n" +
      '      }\n' +
      '      var raw = localStorage.getItem(key);\n' +
      "      if (raw == null) return '';")
  },

  /* ==== 4. legal-chart-fill: patients() fallback reads the store ========== */
  {
    file: LG, id: 'lg-patients-fallback-reroute',
    why: 'SWEEP FINDING (design missed it, same fifth-reader class as visitfix ":237"): the fallback silently serves ZERO patients post-migration. Same re-route shape; legacy path byte-identical for contexts where the primitive is absent (this file also runs on pages that never load ScribeFlow).',
    find:
      '  function patients() {\n' +
      '    try {\n' +
      "      if (typeof window.getPatients === 'function') return window.getPatients() || [];\n" +
      "      var raw = localStorage.getItem(uns('patients')) || '[]';\n" +
      "      if (typeof window.__mlsPtsDecode === 'function') raw = window.__mlsPtsDecode(raw);\n" +
      '      return JSON.parse(raw) || [];',
    replace:
      '  function patients() {\n' +
      '    try {\n' +
      "      if (typeof window.getPatients === 'function') return window.getPatients() || [];\n" +
      '      /* sj-2.0 ROGUE RE-ROUTE (design: tests/live-e2e-artifacts/2026-08-11-sj2-patients-idb-design.md):\n' +
      '         post-migration the patients blob key is RETIRED, so the raw read below\n' +
      '         returns null and this fallback silently serves ZERO patients. When the\n' +
      '         primitive is live, serve its in-memory roster; the legacy raw\n' +
      '         read+decode stays for contexts where the primitive never loads. */\n' +
      '      var sjStore = window.__mlsPtsStore;\n' +
      "      if (sjStore && typeof sjStore.isReady === 'function' && sjStore.isReady()) {\n" +
      '        try { return (sjStore.getRoster() || []).slice(); } catch (eSj) { return []; }\n' +
      '      }\n' +
      "      var raw = localStorage.getItem(uns('patients')) || '[]';\n" +
      "      if (typeof window.__mlsPtsDecode === 'function') raw = window.__mlsPtsDecode(raw);\n" +
      '      return JSON.parse(raw) || [];'
  }
];

/* ---------------------------------------------------------------------------
 * Engine: sequential exact-byte splices with occurrence==1 assertions.
 * Copied from tests/patch-daynote-foldin.js (dn-1.0), including the
 * REPLACE-judged already-applied handling: every edit here splices by
 * expansion (its find is contained in its replace), so the find SURVIVES a
 * correct apply and absence-of-find alone can never prove "not applied".
 * ------------------------------------------------------------------------- */
function occurrences(hay, needle) {
  let n = 0, i = 0;
  for (;;) { i = hay.indexOf(needle, i); if (i < 0) return n; n++; i += needle.length; }
}

function applyToSources(sources, opts) {
  opts = opts || {};
  const out = Object.assign({}, sources);
  const log = [];
  for (const e of EDITS) {
    const src = out[e.file];
    if (typeof src !== 'string') throw new Error('missing source for ' + e.file);
    const nFind = occurrences(src, e.find);
    const nRepl = occurrences(src, e.replace);
    if (nRepl === 1) {
      if (opts.tolerateApplied) {
        log.push({ id: e.id, file: e.file, status: 'already-applied' });
        continue;
      }
      throw new Error('[' + e.id + '] in ' + e.file + ': already applied - refusing to double-splice');
    }
    if (nFind !== 1) {
      throw new Error('ANCHOR FAILURE [' + e.id + '] in ' + e.file + ': expected occurrence==1, found ' + nFind +
        (nRepl ? ' (replacement text present ' + nRepl + 'x)' : ''));
    }
    if (nRepl !== 0 && e.replace.indexOf(e.find) !== 0 && occurrences(e.replace, e.find) === 0) {
      throw new Error('ANCHOR FAILURE [' + e.id + '] in ' + e.file + ': replacement already present alongside anchor');
    }
    const at = src.indexOf(e.find);
    out[e.file] = src.slice(0, at) + e.replace + src.slice(at + e.find.length);
    log.push({ id: e.id, file: e.file, status: 'ok', at });
  }
  return { sources: out, log };
}

/* ASCII self-check: every replacement must survive latin1 travel untouched
 * (ASCII apostrophes only; the :10432 mojibake toast is what a violation
 * becomes). Tab(9)/LF(10)/CR(13) plus printable 32..126 are the alphabet. */
function assertAscii() {
  for (const e of EDITS) {
    for (const [label, s] of [['find', e.find], ['replace', e.replace]]) {
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) continue;
        throw new Error('[' + e.id + '] non-ASCII char U+' + c.toString(16) + ' in ' + label + ' at index ' + i);
      }
    }
    if (e.replace.indexOf('</scr' + 'ipt') >= 0) throw new Error('[' + e.id + '] replacement contains a script-close sequence');
  }
}

function main() {
  const APPLY = process.argv.indexOf('--apply') >= 0;
  const ROOT = resolveRoot();
  assertAscii();
  const files = Array.from(new Set(EDITS.map(e => e.file)));
  const sources = {};
  for (const f of files) {
    const full = path.join(ROOT, f);
    sources[f] = fs.readFileSync(full, 'latin1');
    console.log('read  ' + f + '  (' + sources[f].length + ' bytes, latin1)');
  }

  let result;
  try {
    result = applyToSources(sources, { tolerateApplied: !APPLY });
  } catch (err) {
    console.error('\nDRY-RUN: FAIL');
    console.error(String(err && err.message || err));
    process.exit(1);
  }
  const applied = result.log.filter(l => l.status === 'already-applied');
  if (applied.length === EDITS.length) {
    console.log('\nDRY-RUN: ALL ' + EDITS.length + ' EDITS ALREADY APPLIED - the repo carries the sj-2.0 rogue re-routes; nothing to do.');
    return;
  }
  if (applied.length > 0) {
    console.error('\nDRY-RUN: FAIL - PARTIAL APPLY: ' + applied.length + '/' + EDITS.length +
      ' edits already present (' + applied.map(l => l.id).join(', ') + '). A half-applied repo needs the .sj2rogues.bak restored before this patcher may run.');
    process.exit(1);
  }
  for (const l of result.log) console.log('anchor ok  [' + l.id + ']  ' + l.file + ' @' + l.at);

  /* pinned-suite guards (tests/patient-store-compression-runtime.test.js #7
   * pins the shared decode helper's PRESENCE in both satellite readers) */
  for (const f of [VF, LG]) {
    if (result.sources[f].indexOf('__mlsPtsDecode') < 0) {
      console.error('PIN VIOLATION: ' + f + ' lost __mlsPtsDecode (compression suite item 7 would fail)');
      process.exit(1);
    }
  }
  for (const f of files) {
    if (result.sources[f] === sources[f]) { console.error('VACUOUS: ' + f + ' unchanged after splice'); process.exit(1); }
    console.log('post-splice size ' + f + ': ' + sources[f].length + ' -> ' + result.sources[f].length +
      ' (+' + (result.sources[f].length - sources[f].length) + ' bytes)');
  }
  console.log('\nDRY-RUN: PASS - ' + result.log.length + '/' + EDITS.length + ' anchors verified (occurrence==1 each), decode-helper pins intact.');

  if (!APPLY) {
    console.log('No files written. Re-run with --apply to splice (writes .sj2rogues.bak first).');
    console.log('REMINDER after apply: register the rogues contract test in tests/run-all.js (EXISTING IS NOT RUNNING), run the gated suite, and ship WITH the primitive train.');
    return;
  }

  for (const f of files) {
    const full = path.join(ROOT, f);
    fs.writeFileSync(full + '.sj2rogues.bak', sources[f], 'latin1');
    fs.writeFileSync(full, result.sources[f], 'latin1');
    console.log('APPLIED ' + f + ' (backup: ' + f + '.sj2rogues.bak)');
  }
}

if (require.main === module) main();
module.exports = { EDITS, applyToSources, occurrences, assertAscii, resolveRoot };
