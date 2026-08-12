#!/usr/bin/env node
'use strict';
/* =============================================================================
 * patch-honest-surfaces.js  (hs-1.0 + sbp-1.0)  2026-08-12
 *
 * TWO HONEST-SURFACE FIXES, site-only (extension untouched), both observed
 * live on b1016/b1017 (handoff-2026-08-11/final-live-proofs-VERDICT.md):
 *
 * FIX 1 - hs-1.0, feat_mls_schedimport_exact.js: the managed-operation
 *   wrapper stamped window.__mlsPullLastOutcome = {ok:true} on ANY resolve.
 *   The b1017 Jul-7 run died athena-side with the named terminal narration
 *   ("no readable appointment rows ... Nothing was imported", roster
 *   no-provider-headers, zero imports) - the resolved receipt said ok:false -
 *   and the machine surface recorded ok:true anyway ("a receipt that can't
 *   fail"). The stamp now derives from the settled value itself: the same
 *   honest verdict lastPullResult stores and the visible narration speaks.
 *
 * FIX 2 - sbp-1.0, mls-connect.js: the day-strip "Full visit notes" checkbox
 *   (#mlsDsVisitTgl / #mlsDsVisitBodies) painted ONCE at strip render. On a
 *   cold boot that happens before the session namespace exists: uns() builds
 *   the placeholder 'sf_u::_::' key, the qol-2.0 resolver reads that WRONG
 *   slot, answers 'unset' (= default on), and the box paints CHECKED while
 *   the settled preference is off. Nothing ever repainted it (same-tab writes
 *   fire no storage event), so the surface lied to the doctor about which
 *   mode the next pull would use - still live on b1017 (Proof 3). The
 *   checkbox is a VIEW of the ONE resolver: it now re-paints until the
 *   resolver's answer is DEFINITIVE and stops the moment it settles.
 *
 * EOL SAFETY: both files are read and written as latin1 (byte-preserving);
 * every edit is an exact byte splice with an occurrence==1 assertion on its
 * anchor. No line-based rewrite, no normalization, ever (memory:
 * wyzant-metrics-file-has-no-backup - a byte rewrite "newline fix" destroyed
 * a file; splice, never rewrite). All inserted bytes are pure ASCII.
 *
 * MODES:
 *   node patch-honest-surfaces.js            -> DRY-RUN: verify every anchor
 *                                               (occurrence==1) + report.
 *                                               Writes NOTHING.
 *   node patch-honest-surfaces.js --apply    -> apply splices, write .bak
 *                                               copies OUTSIDE the repo first.
 *
 * Exports { EDITS, applyToSources } so the contract suites can build the
 * patched sources in memory without touching the repo.
 *
 * AFTER APPLY (release-train checklist, not done by this script):
 *   1. register pull-outcome-honest-stamp.test.js and
 *      strip-checkbox-paints-resolver.test.js in tests/run-all.js
 *      (EXISTING IS NOT RUNNING - an unregistered fence never executes);
 *   2. run the full gate with the completeness line (GATE_PLAN/GATE_COMPLETE),
 *      log OUTSIDE the repo, GATE_COMMIT first line == final tip.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');

const SI = 'feat_mls_schedimport_exact.js';
const MC = 'mls-connect.js';

const EDITS = [

  /* ==== 1. hs-1.0 honest-outcome helper (si) ============================= */
  {
    file: SI, id: 'si-honest-outcome-helper',
    why: 'derive the machine-surface outcome from the settled receipt itself; PHI-free by construction (verdict booleans, reason/gate tokens, the narration string every visible surface already shows, numeric counts only).',
    find: '  function runManagedAthenaOperation(task, busyFactory) {\n',
    replace:
      '  /* hs-1.0 (live 2026-08-12, b1017 proof-1 caveat): "resolved" is NOT\n' +
      '     "succeeded". The managed wrapper stamped __mlsPullLastOutcome ok:true on\n' +
      '     ANY resolve, so the named terminal failure the owner watched live ("no\n' +
      '     readable appointment rows ... Nothing was imported", roster\n' +
      '     no-provider-headers, zero imports) was recorded ok:true on the machine\n' +
      '     surface - a consumer reading only that surface calls the failure a\n' +
      '     success (the progress stage read it back as "Pull finished."). The stamp\n' +
      '     now carries the RUN\'S OWN verdict - the same receipt lastPullResult\n' +
      '     stores and the visible narration speaks. A settled value without a\n' +
      '     verdict field (history-retry receipts) is judged by its own completeness\n' +
      '     contract: complete AND zero failures. PHI-free by construction: verdict\n' +
      '     booleans, reason/gate tokens, the narration string every visible surface\n' +
      '     already shows, and numeric counts only. */\n' +
      '  function honestPullOutcome(value) {\n' +
      '    var out = { ok: true, at: Date.now() };\n' +
      '    if (!value || typeof value !== "object") return out;\n' +
      '    if (typeof value.ok === "boolean") out.ok = value.ok === true;\n' +
      '    else if (typeof value.complete === "boolean") out.ok = value.complete === true && !(Number(value.failures || 0) > 0);\n' +
      '    else return out;\n' +
      '    if (typeof value.complete === "boolean") out.complete = value.complete === true;\n' +
      '    if (value.reason !== undefined && value.reason !== null && String(value.reason) !== "") out.reason = String(value.reason).slice(0, 80);\n' +
      '    if (!out.ok) {\n' +
      '      if (value.gate) out.gate = String(value.gate).slice(0, 80);\n' +
      '      var errText = value.error || value.narration || "";\n' +
      '      if (errText) out.error = String(errText).slice(0, 200);\n' +
      '      var counts = {}, names = ["created", "repaired", "skipped", "failed", "failures", "requested", "processed"], any = false;\n' +
      '      for (var ci = 0; ci < names.length; ci++) {\n' +
      '        var cv = value[names[ci]];\n' +
      '        if (typeof cv === "number" && isFinite(cv)) { counts[names[ci]] = cv; any = true; }\n' +
      '      }\n' +
      '      if (any) out.counts = counts;\n' +
      '    }\n' +
      '    return out;\n' +
      '  }\n' +
      '  function runManagedAthenaOperation(task, busyFactory) {\n'
  },

  /* ==== 2. hs-1.0 honest resolve stamp (si) =============================== */
  {
    file: SI, id: 'si-honest-resolve-stamp',
    why: 'the resolve-path stamp carries the settled value\'s own verdict instead of a blanket ok:true; the reject-path stamp (already honest) is untouched.',
    find: '      safe(function () { window.__mlsPullLastOutcome = { ok: true, at: Date.now() }; });\n',
    replace:
      '      /* hs-1.0: stamp the settled value\'s OWN verdict - a resolved terminal\n' +
      '         failure (ok:false receipt) must never be recorded as a success. */\n' +
      '      safe(function () { window.__mlsPullLastOutcome = honestPullOutcome(value); });\n'
  },

  /* ==== 3. sbp-1.0 resolver settle verdict (mc, INSIDE the resolver
   *          markers - the fifth-reader guard forbids key literals anywhere
   *          else, and the settle judgment belongs to the ONE resolver) ===== */
  {
    file: MC, id: 'mc-resolver-settled-ns',
    why: 'the resolver reports whether its answer is DEFINITIVE: during boot uns() builds a placeholder namespace and the read consults the wrong slot, so its unset (= default on) is provisional; views must be able to ask without touching keys themselves.',
    find: "      var kM = nk('visitNotesModeV2');\n      var v2 = kM ? localStorage.getItem(kM) : null;\n",
    replace:
      "      var kM = nk('visitNotesModeV2');\n" +
      '      /* sbp-1.0: is this answer DEFINITIVE? An explicit on/off always is.\n' +
      "         An 'unset' is definitive only when the canonical key was derived\n" +
      '         from a REAL session namespace - during boot uns() builds a\n' +
      "         placeholder ('sf_u::_::' / '::undefined::') and this read consults\n" +
      "         the wrong slot, so its 'unset' (= default on) is provisional and\n" +
      '         views must re-read after the session settles (live b1016/b1017:\n' +
      '           the day-strip checkbox painted CHECKED while the settled\n' +
      '           preference was off). */\n' +
      "      var settledNs = !!kM && kM.indexOf('::_::') < 0 && kM.indexOf('::undefined::') < 0;\n" +
      '      var v2 = kM ? localStorage.getItem(kM) : null;\n'
  },
  {
    file: MC, id: 'mc-resolver-settled-onoff',
    why: 'an explicit stored on/off is always definitive.',
    find: "if (v2 === 'on' || v2 === 'off') return { state: v2, on: v2 === 'on' };",
    replace: "if (v2 === 'on' || v2 === 'off') return { state: v2, on: v2 === 'on', settled: true };"
  },
  {
    file: MC, id: 'mc-resolver-settled-pair',
    why: 'the adopted legacy pair lives in the same namespace, so its answer is only as settled as the namespace it was read through.',
    find: "return { state: on1 ? 'on' : 'off', on: on1 };",
    replace: "return { state: on1 ? 'on' : 'off', on: on1, settled: settledNs };"
  },
  {
    file: MC, id: 'mc-resolver-settled-legacy',
    why: 'the retired un-namespaced global carries a definitive human choice regardless of session state.',
    find: "return { state: on2 ? 'on' : 'off', on: on2 };",
    replace: "return { state: on2 ? 'on' : 'off', on: on2, settled: true };"
  },
  {
    file: MC, id: 'mc-resolver-settled-unset',
    why: 'a real-namespace unset is a definitive answer (default ON law); a placeholder-namespace unset and the exception path are provisional.',
    find: "      return { state: 'unset', on: true };\n    } catch (e) { return { state: 'unset', on: true }; }\n",
    replace: "      return { state: 'unset', on: true, settled: settledNs };\n    } catch (e) { return { state: 'unset', on: true, settled: false }; }\n"
  },
  {
    file: MC, id: 'mc-resolver-version',
    why: 'additive read() field: settled. Version bump so live probes can tell which contract they are reading.',
    find: "var api = { installed: true, version: '2.0.1', read: read, write: write, isPrefKey: isPrefKey, lastWrite: null };",
    replace: "var api = { installed: true, version: '2.1.0', read: read, write: write, isPrefKey: isPrefKey, lastWrite: null };"
  },

  /* ==== 4. sbp-1.0 strip-checkbox settle repaint (mc) ===================== */
  {
    file: MC, id: 'mc-strip-settle-repaint',
    why: 'the strip checkbox re-paints from the ONE resolver until the resolver says its answer is definitive, then stops; a rebuilt or torn-down strip also stops the watcher. No key literals here - the settle verdict comes from the resolver (fifth-reader guard).',
    find: '        paint();\n        tgl.onchange = function () {\n',
    replace:
      '        paint();\n' +
      '        /* sbp-1.0 boot-paint settle (live b1016/b1017, final-live-proofs\n' +
      '           Proof 3): the ONE paint above can run before the session namespace\n' +
      '           exists - the resolver reads the placeholder slot, answers \'unset\'\n' +
      '           (= on), and the box paints CHECKED while the settled preference is\n' +
      '           off. Nothing ever repainted it: same-tab writes fire no storage\n' +
      '           event. The checkbox is a VIEW of the ONE resolver (qol-2.0), so\n' +
      '           until the resolver says its answer is DEFINITIVE (read().settled,\n' +
      '           2.1.0) it re-paints on a short cadence and stops the moment the\n' +
      '           answer settles or this strip instance is torn down / rebuilt. */\n' +
      '        var prefSettled = function () {\n' +
      '          try {\n' +
      '            var r = window.__mlsVisitNotesPref;\n' +
      '            if (!r || typeof r.read !== \'function\') return false;\n' +
      '            var st = r.read();\n' +
      '            return !!st && (st.state === \'on\' || st.state === \'off\' || st.settled === true);\n' +
      '          } catch (e0) { return false; }\n' +
      '        };\n' +
      '        if (!prefSettled()) {\n' +
      '          var settleIv = setInterval(function () {\n' +
      '            try {\n' +
      '              if (document.getElementById(\'mlsDsVisitBodies\') !== tgl) { clearInterval(settleIv); return; }\n' +
      '              paint();\n' +
      '              if (prefSettled()) clearInterval(settleIv);\n' +
      '            } catch (e1) { clearInterval(settleIv); }\n' +
      '          }, 500);\n' +
      '        }\n' +
      '        tgl.onchange = function () {\n'
  }
];

/* ---------------------------------------------------------------------------
 * Engine: sequential exact-byte splices with occurrence==1 assertions.
 * (Same engine as tests/patch-daynote-foldin.js.)
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
    /* ALREADY APPLIED is judged on the REPLACE text (edits here splice by
     * prefix/suffix, so the find survives a correct apply). */
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
    console.log('\nDRY-RUN: ALL ' + EDITS.length + ' EDITS ALREADY APPLIED - the repo carries hs-1.0/sbp-1.0; nothing to do.');
    return;
  }
  if (applied.length > 0) {
    console.error('\nDRY-RUN: FAIL - PARTIAL APPLY: ' + applied.length + '/' + EDITS.length +
      ' edits already present (' + applied.map(l => l.id).join(', ') + '). A half-applied repo needs a git restore of the target files before this patcher may run.');
    process.exit(1);
  }
  for (const l of result.log) console.log('anchor ok  [' + l.id + ']  ' + l.file + ' @' + l.at);
  for (const f of files) {
    console.log('post-splice size ' + f + ': ' + sources[f].length + ' -> ' + result.sources[f].length +
      ' (+' + (result.sources[f].length - sources[f].length) + ' bytes)');
  }
  console.log('\nDRY-RUN: PASS - ' + result.log.length + '/' + EDITS.length + ' anchors verified (occurrence==1 each).');

  if (!APPLY) {
    console.log('No files written. Re-run with --apply to splice (writes out-of-repo .bak first).');
    return;
  }

  /* Backups go OUTSIDE the repo (git-add-A-publishes-your-debris). */
  const os = require('os');
  const bakDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs10-bak-'));
  for (const f of files) {
    const full = path.join(ROOT, f);
    fs.writeFileSync(path.join(bakDir, f + '.hs10.bak'), sources[f], 'latin1');
    fs.writeFileSync(full, result.sources[f], 'latin1');
    console.log('APPLIED ' + f + ' (backup: ' + path.join(bakDir, f + '.hs10.bak') + ')');
  }
}

if (require.main === module) main();
module.exports = { EDITS, applyToSources, occurrences, ROOT };
