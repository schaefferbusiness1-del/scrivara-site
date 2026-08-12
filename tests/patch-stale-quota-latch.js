#!/usr/bin/env node
'use strict';
/* =============================================================================
 * patch-stale-quota-latch.js  (ql-1.0)  2026-08-11
 *
 * STALE QUOTA LATCH FIX — site-only patch prep (extension untouched).
 *
 * THE DEFECT (final-live-proofs-VERDICT.md, proof 1, b1016): the qv-1.0/1.1
 * write-verification guard (mls-connect.js) verifies a save by reading back
 * uns('patients') from localStorage — a key the sj-2.0 migration REMOVED
 * permanently. In idb mode the echo is null forever, so the guard condemned
 * the very boot flush that IndexedDB CONFIRMED (store receipt gen 1->2,
 * confirmedGen 2, wbFailures 0) as "silent-no-op", armed
 * window.__mlsStoreWriteFailed minutes after every reload, and the flag's
 * "next verified write" self-clear could never fire. The b1014 quota
 * preflight — working exactly as designed — then refused every day pull
 * indefinitely, and the owner saw a permanent false "Local storage full"
 * chip. localStorage sat at 1.4MB of 5.2MB. The instrument lies first.
 *
 * THE FIX (three layers, judged on CURRENT reality, refusal never weakened):
 *   1. PRIMARY — the qv guard's verify is MODE-AWARE (mls-connect.js): in idb
 *      mode the verdict comes from the store's OWN confirm (flushNow() +
 *      receipt: gen==confirmedGen, wbFailures===0, degraded false), never
 *      from the removed localStorage key; ls mode keeps the byte-echo check
 *      byte-for-byte. The flag's self-clear thereby gains its second writer
 *      AT the IndexedDB confirm point; a degraded/rejecting store still arms
 *      the flag loudly.
 *   2. BELT — the day-lane quota preflight (feat_mls_schedimport_exact.js
 *      __dayPullInner) adjudicates the latch against the store receipt before
 *      refusing: a stale latch over a provably-healthy idb store clears (with
 *      a named console line + chip refresh) and the pull proceeds; anything
 *      less refuses exactly as before.
 *   3. PROOF-2 DISCLOSED GAP — the MONTH lane (pullMonth) bypassed the quota
 *      preflight entirely; it gains the SAME gate with the same reality
 *      check, refusing BEFORE any Athena navigation.
 *   Plus: the qv heal tick (4s) runs the same adjudication so a stale chip
 *   dies within one tick even with zero saves and zero pulls (the chip
 *   follows the same truth).
 *
 * EOL SAFETY: files are read and written as latin1 (byte-preserving); every
 * edit is an exact byte splice with an occurrence==1 assertion on its anchor.
 * No line-based rewrite, no normalization, ever (engine verbatim from
 * tests/patch-daynote-foldin.js).
 *
 * MODES:
 *   node patch-stale-quota-latch.js            -> DRY-RUN (writes nothing)
 *   node patch-stale-quota-latch.js --apply    -> apply splices (backups
 *                                                 OUTSIDE the repo first)
 *
 * Exports { EDITS, applyToSources } so stale-quota-latch-contract.test.js can
 * assert the applied identity on the shipped bytes without touching the repo.
 *
 * AFTER APPLY (release-train checklist, not done by this script):
 *   1. register stale-quota-latch-contract.test.js in tests/run-all.js
 *      (EXISTING IS NOT RUNNING);
 *   2. full definitive gate (GATE_PLAN/GATE_COMPLETE, log OUTSIDE the repo);
 *   3. push the branch only — build bump belongs to the ship lane.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');

const SI = 'feat_mls_schedimport_exact.js';
const MC = 'mls-connect.js';

const EDITS = [

  /* ==== 1. qv guard: store-receipt helpers (mls-connect) ================== */
  {
    file: MC, id: 'mc-qv-store-helpers',
    why: 'mode-aware verification primitives: qvStoreReceipt/qvIdbLive/qvStoreHealthy read the sj-2.0 store\'s own receipt; qvIdbVerify judges a save at the store\'s confirm point (flushNow resolves only after the content-hash-verified IndexedDB write-back; rejects once degraded).',
    find: '  function qvFail(reason, expected, got) {\n',
    replace:
      '  /* qv-1.2 (stale-quota-latch fix 2026-08-11): the sj-2.0 migration RETIRED\n' +
      '     the localStorage patients key this guard reads back, so in idb mode the\n' +
      '     old echo check condemned every healthy save as a silent-no-op (armed at\n' +
      '     boot, never cleared - the latch that shut the pull gate on a store with\n' +
      '     3.8MB of localStorage free while IndexedDB confirmed the very save it\n' +
      '     called failed). These helpers make the verification MODE-AWARE: in idb\n' +
      '     mode the verdict comes from the store\'s OWN confirm receipt, never from\n' +
      '     the removed key. The healthy predicate is deliberately strict - idb\n' +
      '     mode, hydrated, gen==confirmedGen, wbFailures===0, degraded false -\n' +
      '     anything less (ls mode, store absent, lagging or degraded write-behind)\n' +
      '     is NOT healthy and never clears the latch, so a store that is genuinely\n' +
      '     failing writes still refuses loudly. Keep the predicate in lockstep\n' +
      '     with _quotaLatchStale (feat_mls_schedimport_exact.js ql-1.0). */\n' +
      '  function qvStoreReceipt() {\n' +
      '    try {\n' +
      '      var ps = window.__mlsPtsStore;\n' +
      '      if (!ps || typeof ps.isReady !== \'function\' || !ps.isReady() || typeof ps.receipt !== \'function\') return null;\n' +
      '      return ps.receipt() || null;\n' +
      '    } catch (e) { return null; }\n' +
      '  }\n' +
      '  function qvIdbLive() {\n' +
      '    var r = qvStoreReceipt();\n' +
      '    return !!(r && r.mode === \'idb\' && r.hydrated === true);\n' +
      '  }\n' +
      '  function qvStoreHealthy(r) {\n' +
      '    return !!(r && r.mode === \'idb\' && r.hydrated === true && r.degraded === false && Number(r.wbFailures) === 0 && Number(r.gen) === Number(r.confirmedGen));\n' +
      '  }\n' +
      '  function qvIdbVerify(expect) {\n' +
      '    /* the idb-mode verified write: flushNow() resolves only after the\n' +
      '       IndexedDB write-back is content-verified by the store itself (gen +\n' +
      '       length + recomputed hash echo) and rejects once the store degrades -\n' +
      '       the STORED ECHO judged at the store\'s own confirm point, strictly\n' +
      '       stronger than the byte-length check it replaces in this mode. A\n' +
      '       healthy confirm is the flag\'s second self-clear writer; a rejection\n' +
      '       or an unhealthy post-confirm receipt arms the flag loudly. */\n' +
      '    try {\n' +
      '      var ps = window.__mlsPtsStore;\n' +
      '      if (!ps || typeof ps.flushNow !== \'function\') return;\n' +
      '      ps.flushNow().then(function () {\n' +
      '        var r = qvStoreReceipt();\n' +
      '        if (qvStoreHealthy(r)) { window.__mlsStoreWriteFailed = null; try { qvChip(); } catch (eQv1) {} }\n' +
      '        else if (r && (r.degraded === true || Number(r.wbFailures) > 0)) qvFail(\'idb-unhealthy: \' + String(r.degradedWhy || r.lastError || \'write-behind failing\').slice(0, 44), expect, -1);\n' +
      '      }, function (eF) {\n' +
      '        qvFail(\'idb-confirm: \' + String((eF && eF.message) || eF).slice(0, 44), expect, -1);\n' +
      '      });\n' +
      '    } catch (eS) {}\n' +
      '  }\n' +
      '  function qvFail(reason, expected, got) {\n'
  },

  /* ==== 2. qv guard: the verify itself goes mode-aware (mls-connect) ====== */
  {
    file: MC, id: 'mc-qv-mode-aware-verify',
    why: 'THE PRIMARY FIX: in idb mode the post-save verification judges the store\'s confirm, never the retired localStorage key (whose null echo condemned every healthy save); ls mode keeps the qv-1.0 byte-echo check unchanged.',
    find:
      '      try {\n' +
      '        var got = key ? String(localStorage.getItem(key) || \'\').length : -1;\n' +
      '        if (key && prevLen >= 0 && got === prevLen && expect >= 0 && Math.abs(expect - prevLen) > 64) {\n' +
      '          qvFail(\'silent-no-op\', expect, got);\n' +
      '        } else {\n' +
      '          window.__mlsStoreWriteFailed = null; try { qvChip(); } catch (eQc2) {} /* qv-1.1: the chip clears with the flag */\n' +
      '        }\n' +
      '      } catch (eR) {}\n',
    replace:
      '      try {\n' +
      '        if (qvIdbLive()) {\n' +
      '          /* qv-1.2: the store runs on IndexedDB - the localStorage key the\n' +
      '             branch below reads back no longer exists there, so the byte-echo\n' +
      '             judgment would false-alarm on every material save (the stale-\n' +
      '             latch bug, live-proven 2026-08-11). Verify through the store\'s\n' +
      '             own confirm instead. */\n' +
      '          qvIdbVerify(expect);\n' +
      '        } else {\n' +
      '          var got = key ? String(localStorage.getItem(key) || \'\').length : -1;\n' +
      '          if (key && prevLen >= 0 && got === prevLen && expect >= 0 && Math.abs(expect - prevLen) > 64) {\n' +
      '            qvFail(\'silent-no-op\', expect, got);\n' +
      '          } else {\n' +
      '            window.__mlsStoreWriteFailed = null; try { qvChip(); } catch (eQc2) {} /* qv-1.1: the chip clears with the flag */\n' +
      '          }\n' +
      '        }\n' +
      '      } catch (eR) {}\n'
  },

  /* ==== 3. qv guard: the heal tick adjudicates the latch (mls-connect) ==== */
  {
    file: MC, id: 'mc-heal-stale-latch',
    why: 'the chip follows the same truth: the 4s heal tick clears a latch the store receipt proves stale (and takes the chip down with it) even with zero saves and zero pulls; an unhealthy receipt never clears anything.',
    find: '    try { qvChip(); } catch (eQh) {} /* qv-1.1: re-assert the persistent surface every heal tick */\n',
    replace:
      '    try { qvChip(); } catch (eQh) {} /* qv-1.1: re-assert the persistent surface every heal tick */\n' +
      '    try { if (window.__mlsStoreWriteFailed && qvStoreHealthy(qvStoreReceipt())) { window.__mlsStoreWriteFailed = null; qvChip(); try { console.warn(\'[mlsQuotaGuard] stale write-failure latch CLEARED - the sj-2.0 store receipt proves healthy confirmed IndexedDB writes.\'); } catch (eQw) {} } } catch (eQs) {} /* qv-1.2: the chip follows CURRENT reality, not a frozen latch */\n'
  },

  /* ==== 4. si: the ONE latch adjudicator, shared by day + month lanes ===== */
  {
    file: SI, id: 'si-quota-latch-adjudicator',
    why: 'the reality check the preflights consult before refusing: clears the latch (+console line naming the receipt proof, +chip refresh) ONLY when the store receipt shows healthy confirmed idb writes; everything else returns false and the refusal stands.',
    find: '  var monthPullRunning = false;\n',
    replace:
      '  /* ql-1.0 (stale-quota-latch 2026-08-11): THE reality adjudicator for the\n' +
      '     __mlsStoreWriteFailed latch, shared by the day and month quota\n' +
      '     preflights. Returns true (and clears the latch + refreshes the qv chip)\n' +
      '     ONLY when the sj-2.0 store\'s own receipt proves current confirmed\n' +
      '     durable writes: idb mode, hydrated, gen==confirmedGen, wbFailures===0,\n' +
      '     degraded false. Anything less - ls mode, store absent or not ready,\n' +
      '     lagging or degraded write-behind - returns false and the loud refusal\n' +
      '     stands untouched. Keep the predicate in lockstep with qvStoreHealthy\n' +
      '     (mls-connect.js qv-1.2). */\n' +
      '  function _quotaLatchStale() {\n' +
      '    var r = safe(function () {\n' +
      '      var ps = window.__mlsPtsStore;\n' +
      '      if (!ps || typeof ps.isReady !== "function" || !ps.isReady() || typeof ps.receipt !== "function") return null;\n' +
      '      return ps.receipt() || null;\n' +
      '    }, null);\n' +
      '    if (!(r && r.mode === "idb" && r.hydrated === true && r.degraded === false && Number(r.wbFailures) === 0 && Number(r.gen) === Number(r.confirmedGen))) return false;\n' +
      '    safe(function () { console.warn("[mls-si] quota-preflight: stale write-failure latch CLEARED - the store receipt proves healthy confirmed IndexedDB writes (gen " + r.gen + " == confirmedGen, wbFailures 0, not degraded)."); });\n' +
      '    safe(function () { window.__mlsStoreWriteFailed = null; });\n' +
      '    safe(function () { var qg = window.__mlsQuotaGuard; if (qg && typeof qg._chip === "function") qg._chip(); });\n' +
      '    return true;\n' +
      '  }\n' +
      '\n' +
      '  var monthPullRunning = false;\n'
  },

  /* ==== 5. si: the day-lane preflight judges CURRENT reality ============== */
  {
    file: SI, id: 'si-day-preflight-reality',
    why: 'the b1014 gate refused every pull off a latch frozen at boot (live proof 1). A stale latch over a provably-healthy idb store clears and the pull proceeds; a genuinely failing store still refuses loudly, byte-identical refusal.',
    find:
      '    var _lrQuota = safe(function () { return window.__mlsStoreWriteFailed; }, null);\n' +
      '    if (_lrQuota) {\n',
    replace:
      '    var _lrQuota = safe(function () { return window.__mlsStoreWriteFailed; }, null);\n' +
      '    /* ql-1.0 (stale-quota-latch 2026-08-11): judge CURRENT reality, not the\n' +
      '       latch. Post-migration the qv guard\'s "next verified write" self-clear\n' +
      '       could never fire (the localStorage key it verified was retired to\n' +
      '       IndexedDB), so this gate refused every pull off a flag armed by a boot\n' +
      '       flush that IndexedDB had CONFIRMED (live proof 1, 2026-08-11:\n' +
      '       gate:"quota-preflight" while the store receipt read gen==confirmedGen,\n' +
      '       wbFailures 0, 3.8MB free). When the store\'s own receipt proves healthy\n' +
      '       confirmed idb writes the latch is stale by proof: clear it and let the\n' +
      '       pull proceed. A store that is GENUINELY failing writes (ls mode,\n' +
      '       degraded or lagging idb) never satisfies the adjudicator and still\n' +
      '       refuses loudly below, unchanged. */\n' +
      '    if (_lrQuota && typeof _quotaLatchStale === "function" && _quotaLatchStale()) _lrQuota = null;\n' +
      '    if (_lrQuota) {\n'
  },

  /* ==== 6. si: the MONTH lane gains the same preflight (proof-2 gap) ====== */
  {
    file: SI, id: 'si-month-quota-preflight',
    why: 'DISCLOSED GAP from proof 2: pullMonth bypassed the quota preflight entirely - a store dropping writes would be driven through up to 31 days of reads it could not keep. Same gate, same reality check, refusing BEFORE any Athena navigation.',
    find: '    if (monthPullRunning) return Promise.resolve(failed("pull-in-flight", "Another exact month pull is already running."));\n',
    replace:
      '    if (monthPullRunning) return Promise.resolve(failed("pull-in-flight", "Another exact month pull is already running."));\n' +
      '    /* ql-1.0 (stale-quota-latch 2026-08-11, proof-2 disclosed gap): the MONTH\n' +
      '       lane bypassed the b1014 quota preflight entirely. Same gate as the day\n' +
      '       lane, same reality check first: a stale latch over a provably-healthy\n' +
      '       idb store clears and the month proceeds; genuinely failing writes\n' +
      '       refuse loudly BEFORE any Athena navigation, named gate, spoken\n' +
      '       through onStatus, outcome-stamped. */\n' +
      '    var _lrQuotaM = safe(function () { return window.__mlsStoreWriteFailed; }, null);\n' +
      '    if (_lrQuotaM && typeof _quotaLatchStale === "function" && _quotaLatchStale()) _lrQuotaM = null;\n' +
      '    if (_lrQuotaM) {\n' +
      '      var _lrQMAge = Math.max(0, Math.round((Date.now() - Number(_lrQuotaM.at || Date.now())) / 60000));\n' +
      '      var _lrQMRefusal = failed("storage-full-writes-failing", "Local storage is FULL - a save failed to persist " + (_lrQMAge ? _lrQMAge + " min ago" : "just now") + ", so new pull data would not survive a reload. No Athena navigation was started. Free storage space (the storage fix is in progress), then pull again.");\n' +
      '      _lrQMRefusal.gate = "quota-preflight";\n' +
      '      _lrQMRefusal.failures = Number(safe(function () { return window.__mlsQuotaGuard && window.__mlsQuotaGuard.failures; }, 0) || 0);\n' +
      '      _lrQMRefusal.lastFailAt = Number(_lrQuotaM.at || 0) || null;\n' +
      '      onStatus(_lrQMRefusal.error, "err");\n' +
      '      safe(function () { window.__mlsPullLastOutcome = { ok: false, at: Date.now(), error: _lrQMRefusal.error }; });\n' +
      '      return Promise.resolve(_lrQMRefusal);\n' +
      '    }\n'
  }
];

/* ---------------------------------------------------------------------------
 * Engine: sequential exact-byte splices with occurrence==1 assertions.
 * Verbatim from tests/patch-daynote-foldin.js (the proven dn-1.0 engine).
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

function main() {
  const APPLY = process.argv.indexOf('--apply') >= 0;
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
    console.log('\nDRY-RUN: ALL ' + EDITS.length + ' EDITS ALREADY APPLIED — the repo carries ql-1.0; nothing to do.');
    return;
  }
  if (applied.length > 0) {
    console.error('\nDRY-RUN: FAIL — PARTIAL APPLY: ' + applied.length + '/' + EDITS.length +
      ' edits already present (' + applied.map(l => l.id).join(', ') + '). A half-applied repo needs a git restore of the two target files before this patcher may run.');
    process.exit(1);
  }
  for (const l of result.log) console.log('anchor ok  [' + l.id + ']  ' + l.file + ' @' + l.at);
  for (const f of files) {
    console.log('post-splice size ' + f + ': ' + sources[f].length + ' -> ' + result.sources[f].length +
      ' (+' + (result.sources[f].length - sources[f].length) + ' bytes)');
  }
  console.log('\nDRY-RUN: PASS — ' + result.log.length + '/' + EDITS.length + ' anchors verified (occurrence==1 each).');

  if (!APPLY) {
    console.log('No files written. Re-run with --apply to splice (writes backups OUTSIDE the repo first).');
    console.log('REMINDER after apply: register stale-quota-latch-contract.test.js in tests/run-all.js (EXISTING IS NOT RUNNING), run the full gated suite, push the branch only.');
    return;
  }

  const os = require('os');
  const bakDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ql10-bak-'));
  for (const f of files) {
    const full = path.join(ROOT, f);
    fs.writeFileSync(path.join(bakDir, f + '.ql10.bak'), sources[f], 'latin1');
    fs.writeFileSync(full, result.sources[f], 'latin1');
    console.log('APPLIED ' + f + ' (backup: ' + path.join(bakDir, f + '.ql10.bak') + ')');
  }
}

if (require.main === module) main();
module.exports = { EDITS, applyToSources, occurrences, ROOT };
