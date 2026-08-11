#!/usr/bin/env node
'use strict';
/* =============================================================================
 * patch-time-unknown-display.js  (td-1.0)  2026-08-11
 *
 * TIME-UNKNOWN DISPLAY FIX - site-only. Zero extension edits, zero backend
 * edits, zero pull/dedup behavior changes.
 *
 * WHY (handoff-2026-08-11/timeless-scan-RESULT.md + silent-refusal-DIAGNOSIS.md
 * DEFECT C): the practice carries 420 appointment rows with start_at NULL
 * across 32 dates (Jun-1..Jul-7), 0 of them absorbable, so the display is the
 * load-bearing cure. Every list surface that renders backend appointment rows
 * sorts by String(start_at||'').localeCompare(...) - NULLS SORT FIRST - so a
 * day like Jul-7 (21 timeless + 39 timed) opens as a screenful of dash rows
 * with every real time below the scroll fold. Two surfaces are worse than a
 * dash: new Date(null) is the EPOCH, so the "All appointments this day" panel
 * and the Who's-Next grid print a confidently-wrong wall-clock time for a row
 * that has no time at all.
 *
 * THE FIX, at every shipped surface that renders backend rows:
 *   (1) rows with start_at null OR time_unknown flagged sort LAST
 *       (timed rows keep their exact time order; day headers/counts untouched);
 *   (2) where the missing time painted a bare dash (or an epoch time, or a
 *       blank), paint the plain honest text "time not recorded" instead.
 * Both states are handled: TODAY (start_at:null, repair flags not yet
 * executed - time_unknown is simply absent/undefined) and POST-REPAIR
 * (time_unknown=1). The predicate is (row.time_unknown || !row.start_at).
 *
 * SURFACES PATCHED (all render backend rows from _calAppts / /api/appointments):
 *   ScribeFlow.html   calOpenDay (day panel - THE diagnosed all-dash wall),
 *                     _calRenderDay, _calRenderMonth (first-5 cell rows),
 *                     _renderWaitingRoom, renderBoard (staff board)
 *   mls-connect.js    #mlsQpAll "All appointments this day" (epoch-time bug),
 *                     Who's-Next reconcile grid (epoch-time bug)
 *   feat_mls_patientpick.js  picker pool sort + card time pill (&mdash;)
 *   feat_mls_uxpack1.js      day chip strip sort
 *
 * DELIBERATELY NOT TOUCHED:
 *   - cleanupDuplicateAppointments keeper sort (dedup behavior - out of scope);
 *   - feat_mls_centerpiece walk order (drives chart opens - behavior);
 *   - agenda popover / whosnext / dayprogress (render athena-pull rows via
 *     a.time, not backend start_at);
 *   - calApptPeek (already prints "No time set");
 *   - week grid (untimed already bucketed into an honest "N no-time" pill);
 *   - staging/test copies (not served).
 *
 * EOL SAFETY: ScribeFlow.html and mls-connect.js are historically mixed-EOL.
 * Files are read and written as latin1 (byte-preserving); every edit is an
 * exact byte splice with an occurrence==1 assertion on its anchor. No
 * line-based rewrite, no normalization, ever. The day-panel dash is the UTF-8
 * em-dash (bytes 0xE2 0x80 0x94), expressed below as latin1 escapes so this
 * file stays ASCII.
 *
 * MODES:
 *   node patch-time-unknown-display.js          -> DRY-RUN (writes nothing)
 *   node patch-time-unknown-display.js --apply  -> splice; backups OUTSIDE the
 *                                                  repo (os.tmpdir), never .bak
 *                                                  debris in the repo root.
 *
 * Exports { EDITS, applyToSources, occurrences, ROOT } for the contract test
 * (time-unknown-display-contract.test.js), which drives the REAL calOpenDay
 * renderer old-vs-new and proves the OLD code fails.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');

const SF = 'ScribeFlow.html';
const MC = 'mls-connect.js';
const PP = 'feat_mls_patientpick.js';
const UX = 'feat_mls_uxpack1.js';

/* The UTF-8 em-dash as its three raw bytes read under latin1. */
const EMDASH = 'â';

const EDITS = [

  /* ==== ScribeFlow.html ================================================== */
  {
    file: SF, id: 'sf-openday-sort',
    why: 'calOpenDay day panel: timeless rows (start_at null OR time_unknown) sort LAST instead of first - the diagnosed all-dash wall on Jul-7 (21 timeless rows filled the panel, every timed row below the fold).',
    find: "return _calDateOf(a)===key; }).sort(function(x,y){ return String(x.start_at||'').localeCompare(String(y.start_at||'')); });",
    replace: "return _calDateOf(a)===key; }).sort(function(x,y){ var xu=(x.time_unknown||!x.start_at)?1:0, yu=(y.time_unknown||!y.start_at)?1:0; return (xu-yu)||String(x.start_at||'').localeCompare(String(y.start_at||'')); });"
  },
  {
    file: SF, id: 'sf-openday-chip',
    why: 'calOpenDay time cell: the bare em-dash becomes the plain honest text "time not recorded" (muted, so it reads as an annotation, not a time). Flag-aware: a time_unknown row never paints a fabricated-looking time.',
    find: "min-width:50px\">'+(tm||'" + EMDASH + "')+'",
    replace: "min-width:50px\">'+((tm&&!a.time_unknown)?tm:'<span style=\"color:var(--muted);font-size:11px\">time not recorded</span>')+'"
  },
  {
    file: SF, id: 'sf-dayview-sort',
    why: '_calRenderDay: same timeless-last invariant (untimed rows are already bucketed separately here, so this is invariant-keeping with zero visual change - but the sort must not silently disagree with its siblings).',
    find: "_calRowMatchesProv(a,pfVal); }).sort(function(x,y){ return String(x.start_at||'').localeCompare(String(y.start_at||'')); });",
    replace: "_calRowMatchesProv(a,pfVal); }).sort(function(x,y){ var xu=(x.time_unknown||!x.start_at)?1:0, yu=(y.time_unknown||!y.start_at)?1:0; return (xu-yu)||String(x.start_at||'').localeCompare(String(y.start_at||'')); });"
  },
  {
    file: SF, id: 'sf-month-sort',
    why: "_calRenderMonth: each month cell shows the FIRST FIVE rows (ap.slice(0,5)) - with nulls first, a day like Jul-7 shows five timeless rows and hides every timed one behind '+N more'. Timeless-last lets the timed schedule fill the cell. The count badge (ap.length) is order-independent - headers/counts unaffected.",
    find: "var ap=(byDate[key]||[]).slice().sort(function(x,y){ return String(x.start_at||'').localeCompare(String(y.start_at||'')); });",
    replace: "var ap=(byDate[key]||[]).slice().sort(function(x,y){ var xu=(x.time_unknown||!x.start_at)?1:0, yu=(y.time_unknown||!y.start_at)?1:0; return (xu-yu)||String(x.start_at||'').localeCompare(String(y.start_at||'')); });"
  },
  {
    file: SF, id: 'sf-waiting-sort',
    why: '_renderWaitingRoom: timeless checked-in/roomed rows list after timed ones (text already degrades honestly - status is the primary info).',
    find: "a.status==='checked_in'||a.status==='roomed'; }).sort(function(x,y){ return String(x.start_at||'').localeCompare(String(y.start_at||'')); });",
    replace: "a.status==='checked_in'||a.status==='roomed'; }).sort(function(x,y){ var xu=(x.time_unknown||!x.start_at)?1:0, yu=(y.time_unknown||!y.start_at)?1:0; return (xu-yu)||String(x.start_at||'').localeCompare(String(y.start_at||'')); });"
  },
  {
    file: SF, id: 'sf-board-sort',
    why: 'renderBoard (staff board): within each status group, timeless rows sort last (status stays the primary key - group headers/counts unaffected).',
    find: "((order[a.status]||9)-(order[b.status]||9)) || String(a.start_at||'').localeCompare(String(b.start_at||''));",
    replace: "((order[a.status]||9)-(order[b.status]||9)) || (((a.time_unknown||!a.start_at)?1:0)-((b.time_unknown||!b.start_at)?1:0)) || String(a.start_at||'').localeCompare(String(b.start_at||''));"
  },
  {
    file: SF, id: 'sf-board-time',
    why: 'renderBoard row: a timeless row painted an EMPTY time slot; paint the honest text instead (muted small text in the existing time span).',
    find: "const t=a.start_at?_fmtApptTime(a.start_at):'';",
    replace: "const t=(a.start_at&&!a.time_unknown)?_fmtApptTime(a.start_at):'time not recorded';"
  },

  /* ==== mls-connect.js =================================================== */
  {
    file: MC, id: 'mc-qpa-sort',
    why: '"All appointments this day" panel (#mlsQpAll): timeless-last.',
    find: "appts.sort(function(a,b){return String(a.start_at||'').localeCompare(String(b.start_at||''));});",
    replace: "appts.sort(function(a,b){var au=(a.time_unknown||!a.start_at)?1:0, bu=(b.time_unknown||!b.start_at)?1:0; return (au-bu)||String(a.start_at||'').localeCompare(String(b.start_at||''));});"
  },
  {
    file: MC, id: 'mc-qpa-time',
    why: '#mlsQpAll time cell: fmtTime(null) is new Date(null) = THE EPOCH, so a timeless row printed a confidently-wrong wall-clock time (7:00 PM ET). Guard the timeless predicate and print the honest text.',
    find: "<span class=\"qpa-t\">'+esc(fmtTime(a.start_at))+'</span>",
    replace: "<span class=\"qpa-t\">'+esc((a.start_at&&!a.time_unknown)?fmtTime(a.start_at):'time not recorded')+'</span>"
  },
  {
    file: MC, id: 'mc-wn-sort',
    why: 'Who\'s-Next reconcile grid: timeless-last.',
    find: "a.sort(function(p,q){ return String(p.start_at||'').localeCompare(String(q.start_at||'')); });",
    replace: "a.sort(function(p,q){ var pu=(p.time_unknown||!p.start_at)?1:0, qu=(q.time_unknown||!q.start_at)?1:0; return (pu-qu)||String(p.start_at||'').localeCompare(String(q.start_at||'')); });"
  },
  {
    file: MC, id: 'mc-wn-time',
    why: 'Who\'s-Next chip subtitle: same epoch-time bug as #mlsQpAll (new Date(null)); print the honest text for timeless rows.',
    find: "esc(fmtTime(x.start_at))+' / DOB '",
    replace: "esc((x.start_at&&!x.time_unknown)?fmtTime(x.start_at):'time not recorded')+' / DOB '"
  },

  /* ==== feat_mls_patientpick.js ========================================== */
  {
    file: PP, id: 'pp-pick-sort',
    why: "picker pool: 'YYYY-MM-DD' (appt_date fallback) sorts BEFORE 'YYYY-MM-DDT...' so timeless rows led the card list; timeless-last, appt_date tiebreak preserved.",
    find: 'pool = pool.slice().sort(function (a, b) { return String(a.start_at || a.appt_date || "").localeCompare(String(b.start_at || b.appt_date || "")); });',
    replace: 'pool = pool.slice().sort(function (a, b) { var au = (a.time_unknown || !a.start_at) ? 1 : 0, bu = (b.time_unknown || !b.start_at) ? 1 : 0; return (au - bu) || String(a.start_at || a.appt_date || "").localeCompare(String(b.start_at || b.appt_date || "")); });',
  },
  {
    file: PP, id: 'pp-row-flag',
    why: 'the picker builds display rows from the raw appointment; the time_unknown flag must ride along or the card renderer cannot see it.',
    find: 'sex: p.sex || "", mrn: p.mrn || "", reason: a.reason || "", time: a.start_at || "",',
    replace: 'sex: p.sex || "", mrn: p.mrn || "", reason: a.reason || "", time: a.start_at || "", time_unknown: a.time_unknown ? 1 : 0,'
  },
  {
    file: PP, id: 'pp-card-chip',
    why: 'picker card time pill: the bare &mdash; becomes the plain honest text "time not recorded".',
    find: '(tStr ? esc(tStr) : "&mdash;")',
    replace: '((tStr && !p.time_unknown) ? esc(tStr) : "time not recorded")'
  },

  /* ==== feat_mls_uxpack1.js ============================================== */
  {
    file: UX, id: 'ux-daychips-sort',
    why: 'day chip strip ("Booked: N"): timeless-last (timeless chips already render name-only - an honest absence - so only the order moves).',
    find: 'out.sort(function (x, y) { return String(x.start_at || "").localeCompare(String(y.start_at || "")); });',
    replace: 'out.sort(function (x, y) { var xu = (x.time_unknown || !x.start_at) ? 1 : 0, yu = (y.time_unknown || !y.start_at) ? 1 : 0; return (xu - yu) || String(x.start_at || "").localeCompare(String(y.start_at || "")); });'
  }
];

/* ---------------------------------------------------------------------------
 * Engine: sequential exact-byte splices with occurrence==1 assertions.
 * (Same engine contract as tests/patch-daynote-foldin.js: locate by exact
 * source bytes, assert bounds, splice - never regex-rewrite. A second --apply
 * must never double-splice.)
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
    /* ALREADY APPLIED is judged on the REPLACE text (see patch-daynote-foldin:
     * a find contained in its replace survives a correct apply). */
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
    if (nRepl !== 0) {
      throw new Error('ANCHOR FAILURE [' + e.id + '] in ' + e.file + ': replacement already present alongside anchor');
    }
    const at = src.indexOf(e.find);
    out[e.file] = src.slice(0, at) + e.replace + src.slice(at + e.find.length);
    log.push({ id: e.id, file: e.file, status: 'ok', at });
  }
  return { sources: out, log };
}

/* Reverse-splice: rebuild the PRE-PATCH sources from an applied repo (the
 * contract test uses this to run the OLD renderer after the repo carries the
 * fix). Refuses unless every replacement is present exactly once. */
function revertSources(sources) {
  const out = Object.assign({}, sources);
  for (const e of EDITS) {
    const src = out[e.file];
    if (typeof src !== 'string') throw new Error('missing source for ' + e.file);
    if (occurrences(src, e.replace) !== 1) throw new Error('[' + e.id + '] revert: replacement not present exactly once');
    const at = src.indexOf(e.replace);
    out[e.file] = src.slice(0, at) + e.find + src.slice(at + e.replace.length);
  }
  return out;
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
    console.log('\nDRY-RUN: ALL ' + EDITS.length + ' EDITS ALREADY APPLIED - the repo carries td-1.0; nothing to do.');
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
    console.log('No files written. Re-run with --apply to splice (backups go to os.tmpdir, outside the repo).');
    return;
  }

  const os = require('os');
  const bakDir = fs.mkdtempSync(path.join(os.tmpdir(), 'td10-bak-'));
  for (const f of files) {
    const full = path.join(ROOT, f);
    fs.writeFileSync(path.join(bakDir, f + '.td10.bak'), sources[f], 'latin1');
    fs.writeFileSync(full, result.sources[f], 'latin1');
    console.log('APPLIED ' + f + ' (backup: ' + path.join(bakDir, f + '.td10.bak') + ')');
  }
  console.log('REMINDER: register time-unknown-display-contract.test.js in tests/run-all.js (EXISTING IS NOT RUNNING), then run the full gate.');
}

if (require.main === module) main();
module.exports = { EDITS, applyToSources, revertSources, occurrences, ROOT };
