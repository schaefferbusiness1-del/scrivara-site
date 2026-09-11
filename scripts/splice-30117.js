/* splice-30117.js - MLS Assist 3.0.117 pull-reliability splice (DRAFT ONLY).
 *
 *   node scripts/splice-30117.js <input-background.js> <output-background.js>
 *
 * DRAFT SPLICE. Reads an input background.js as latin1, edits it by EXACT
 * WHOLE-LINE anchors only (never String.replace over the whole file), asserts
 * every anchor (or contiguous anchor RUN) resolves exactly once, re-emits every
 * inserted or replaced line with the SAME terminator as its anchor line, and
 * writes the result to a separate output path. background.js carries MIXED
 * terminators (6391 CRLF lines, 12510 LF lines at e52f1beb), so a run is only
 * ever replaced when every line in it shares one terminator; a run with mixed
 * terminators is only ever INSERTED AFTER, using that one line's terminator.
 * The tracked file is never touched by this script - pass the paths explicitly.
 *
 * WHAT IT CHANGES (all additive; nothing is removed from any receipt):
 *
 *  A  DOB READER PARITY (isodob-1.1.0) - five readers lacked the anchored-ISO
 *     branch that dateKey at module scope already carries, so the M/D/Y regex
 *     matched INSIDE an ISO year and nrmDob('1962-03-04'), nrmDob('1942-03-04')
 *     and nrmDob('1902-03-04') all returned '2/3/2004': different people
 *     compared EQUAL. The five sites are injected functions, which cannot close
 *     over a worker helper, so the branch is repeated verbatim, never shared.
 *     The inconsistent 2-digit pivots (>26, >30) are retired for the dynamic
 *     one in the same edit. Slash input is byte-unchanged.
 *       A1 the day-schedule dateKey          A2 the merge comparator normDob
 *       A3 the search DOB veto nrmDob        A4 the visits-read wrong-chart
 *       A5 the write-lane wrong-chart
 *
 *  B  DAY-GRID BAND (bandnormalize-1.0.0) - the vertical scroll container was
 *     discovered ONLY among elements that already contained a rendered
 *     appointment cell, so a Day calendar that opens on the empty 19:00-23:00
 *     band found no scroller, never scrolled, parsed 0 rows and refused
 *     schedule-incomplete on a full day. Discover by SHAPE (geometry plus a
 *     schedule/calendar/grid ancestor) with the rendered-cell test demoted to a
 *     score boost; when and ONLY when zero rows are rendered, force the best
 *     container to the top band, poll for row-count stability, then RE-DISCOVER.
 *       B1 shape-based discovery  B2 the band pre-pass  B3 receipt.bandNormalize
 *
 *  C  KEEP-ALIVE BACKSTOP (kabackstop-1.0.0) - the tick deferred the WHOLE
 *     keep-alive job while a chart read or quiet pull was live, i.e. for the
 *     entire length of a day or month pull, including the shadow-DOM
 *     session-expiry Continue backstop. Split the two jobs: the dialog backstop
 *     runs even under load; only the frame-touch injections and the
 *     authenticated fetches stay deferred.
 *       C1 kaFrameTouch(kaMode)   C2 touches guarded   C3 fetches guarded
 *       C4 busy tick runs the backstop   C5 per-tab busy re-check likewise
 *
 *  D  SEARCH VALUE VERIFICATION + RETRY (searchverify-1.0.0 / rowreverify-1.0.0)
 *     - athenaOne's global search drops or re-orders typed characters under
 *     load and its result list re-orders between render and click, so the wrong
 *     chart opened. Read the field back and require equality before submitting
 *     (3 attempts, clear + retype, settle between); re-read the result rows
 *     after a settle and click only the one row that still carries this
 *     patient; refuse 'search-target-unverified' with attempted:false instead.
 *       D1 global-search fill verify   D2 findpatient row re-verify
 *       D3 clickRow stale-row refusal  D4,D5 its two call sites
 *       D6 the caller's fill-failure sentence
 *
 *  E  OPENED-CHART IDENTITY (additive receipts only)
 *       E1 wrong-chart carries attempted:false plus expected/observed MRN
 *          DIGIT COUNTS (counts only - never the values)
 *       E2,E3 the successful capture carries identity:{mrnMatched,dobRead,
 *          dobSource,dobFillable,identityMode} so the app can FILL a missing
 *          DOB from the chart instead of refusing dob-mismatch
 *
 * It does NOT touch the write/save/sign/order/billing legs, proof minting, the
 * token lock, the 3.0.116 reconcile leg, content.js, the manifest, or any
 * version pin. Version bump and digest stamping are a separate job.
 */
'use strict';

var fs = require('fs');

var IN = process.argv[2], OUT = process.argv[3];
if (!IN || !OUT) {
  console.error('usage: node scripts/splice-30117.js <input-background.js> <output-background.js>');
  process.exit(1);
}

var s = fs.readFileSync(IN, 'latin1');

function census(str) {
  var cr = 0, lf = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c === 13) cr++; else if (c === 10) lf++;
  }
  return { bytes: str.length, cr: cr, lf: lf };
}

var before = census(s);

/* Every constant this script emits must be ASCII: the latin1 writer turns a
   stray Unicode code point into control bytes. */
function assertAscii(lines) {
  lines.forEach(function (line) {
    if (/[^\x09\x20-\x7e]/.test(line)) throw new Error('Non-ASCII payload line: ' + line.slice(0, 60));
  });
}

/* Resolve ONE whole line by exact content. The anchor must match the full line
   (terminator excluded) and must occur exactly once in the file. */
function lineSpan(anchor) {
  var hits = [], from = 0;
  for (;;) {
    var i = s.indexOf(anchor, from);
    if (i < 0) break;
    from = i + 1;
    var start = i === 0 ? 0 : s.lastIndexOf('\n', i - 1) + 1;
    if (start !== i) continue;
    var end = s.indexOf('\n', i);
    if (end < 0) continue; /* an unterminated last line is never an anchor here */
    var content = s.slice(start, end);
    if (content.charCodeAt(content.length - 1) === 13) content = content.slice(0, -1);
    if (content !== anchor) continue;
    hits.push({ start: start, end: end, eol: s.charCodeAt(end - 1) === 13 ? '\r\n' : '\n' });
  }
  if (hits.length !== 1) throw new Error('Anchor occurs ' + hits.length + ' time(s), expected 1: ' + anchor.trim().slice(0, 72));
  return hits[0];
}

/* Resolve a CONTIGUOUS RUN of whole lines. The run must occur exactly once.
   Returns the span plus the per-line terminators, so a caller can refuse to
   replace a run whose lines do not all share one terminator. */
function runSpan(anchors) {
  var first = anchors[0], hits = [], from = 0;
  for (;;) {
    var i = s.indexOf(first, from);
    if (i < 0) break;
    from = i + 1;
    var start = i === 0 ? 0 : s.lastIndexOf('\n', i - 1) + 1;
    if (start !== i) continue;
    var cursor = start, eols = [], okRun = true, lineStarts = [];
    for (var k = 0; k < anchors.length; k++) {
      var end = s.indexOf('\n', cursor);
      if (end < 0) { okRun = false; break; }
      var content = s.slice(cursor, end);
      if (content.charCodeAt(content.length - 1) === 13) content = content.slice(0, -1);
      if (content !== anchors[k]) { okRun = false; break; }
      lineStarts.push(cursor);
      eols.push(s.charCodeAt(end - 1) === 13 ? '\r\n' : '\n');
      cursor = end + 1;
    }
    if (!okRun) continue;
    hits.push({ start: start, end: cursor, eols: eols, lineStarts: lineStarts });
  }
  if (hits.length !== 1) throw new Error('Run occurs ' + hits.length + ' time(s), expected 1: ' + anchors[0].trim().slice(0, 72));
  return hits[0];
}

var ops = [];

function emit(lines, eol) { return lines.map(function (line) { return line + eol; }).join(''); }
function note(tag, kind, eol, removed, added) {
  ops.push({ tag: tag, kind: kind, eol: eol === '\r\n' ? 'CRLF' : 'LF', removed: removed, added: added });
}

function replaceLine(tag, anchor, lines) {
  assertAscii([anchor]);
  assertAscii(lines);
  var span = lineSpan(anchor);
  s = s.slice(0, span.start) + emit(lines, span.eol) + s.slice(span.end + 1);
  note(tag, 'replace', span.eol, 1, lines.length);
}

function insertAfterLine(tag, anchor, lines) {
  assertAscii([anchor]);
  assertAscii(lines);
  var span = lineSpan(anchor);
  s = s.slice(0, span.end + 1) + emit(lines, span.eol) + s.slice(span.end + 1);
  note(tag, 'insert-after', span.eol, 0, lines.length);
}

/* Replace a contiguous run. Refuses unless every line in the run carries the
   SAME terminator, so the replacement cannot silently convert CRLF to LF. */
function replaceRun(tag, anchors, lines) {
  assertAscii(anchors);
  assertAscii(lines);
  var span = runSpan(anchors);
  var eol = span.eols[0];
  for (var i = 1; i < span.eols.length; i++) {
    if (span.eols[i] !== eol) throw new Error('Run has mixed terminators, refusing to replace: ' + anchors[0].trim().slice(0, 60));
  }
  s = s.slice(0, span.start) + emit(lines, eol) + s.slice(span.end);
  note(tag, 'replace-run', eol, anchors.length, lines.length);
}

/* Insert AFTER one named line of a run. Used where the line itself is not
   unique (two byte-identical nrmDob bodies) but the run around it is, and
   where the run's terminators are mixed so it must not be re-emitted. */
function insertAfterRunLine(tag, anchors, idx, lines) {
  assertAscii(anchors);
  assertAscii(lines);
  var span = runSpan(anchors);
  var at = span.lineStarts[idx] + anchors[idx].length + span.eols[idx].length;
  s = s.slice(0, at) + emit(lines, span.eols[idx]) + s.slice(at);
  note(tag, 'insert-after-run-line', span.eols[idx], 0, lines.length);
}

var ISO_RE = "/(^|[^0-9])(\\d{4})-([01]\\d)-([0-3]\\d)(?![0-9])/";

/* ================================================================== */
/* A. DOB READER PARITY - isodob-1.1.0                                */
/* ================================================================== */

/* A1: the day-schedule dateKey copy. */
insertAfterLine('A1-datekey-iso',
  '    function dateKey(v) {',
  [
    '      /* isodob-1.1.0 (3.0.117): an ISO DOB (1962-03-04) must not be scanned',
    "         by the M/D/Y reader below - it first matches INSIDE the year ('2-03-04')",
    '         and reads a different person, so 1962/1942/1902-03-04 all collapsed to',
    '         one key (measured 2026-09-11). Anchored ISO branch first; the M/D/Y',
    '         branch below is byte-unchanged. Same implementation as the module-scope',
    '         dateKey (isodob-1.0.0, 3.0.99) - an injected function cannot close over',
    '         a worker helper, so the branch is repeated, never shared. */',
    '      var iso = ' + ISO_RE + ".exec(String(v || ''));",
    "      if (iso) return Number(iso[3]) + '/' + Number(iso[4]) + '/' + iso[2];"
  ]);

/* A2: the merge comparator normDob. Output shape (MM/DD/YYYY) unchanged. */
replaceLine('A2-normdob-iso',
  "  function normDob(s) { var m = /([01]?\\d)[\\/\\-\\.]([0-3]?\\d)[\\/\\-\\.](\\d{2,4})/.exec(String(s || '')); if (!m) return ''; var y = m[3]; if (y.length === 2) y = (parseInt(y, 10) > 30 ? '19' : '20') + y; return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + y; }",
  [
    "  function normDob(s) { /* isodob-1.1.0 (3.0.117): anchored ISO branch first - the M/D/Y regex matched INSIDE an ISO year, so this merge comparator returned one key for three different decades. The hardcoded >30 two-digit pivot is retired for the dynamic one. The zero-padded MM/DD/YYYY output shape is unchanged. */ var iso = " + ISO_RE + ".exec(String(s || '')); if (iso) return iso[3] + '/' + iso[4] + '/' + iso[2]; var m = /([01]?\\d)[\\/\\-\\.]([0-3]?\\d)[\\/\\-\\.](\\d{2,4})/.exec(String(s || '')); if (!m) return ''; var y = m[3]; if (y.length === 2) y = (Number(y) > ((new Date().getFullYear() % 100) + 1) ? '19' : '20') + y; return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + y; }"
  ]);

/* A3: the patient-search DOB veto nrmDob. */
replaceLine('A3-search-veto-iso',
  "      function nrmDob(s) { var m = /([01]?\\d)[\\/\\-\\.]([0-3]?\\d)[\\/\\-\\.](\\d{2,4})/.exec(String(s || '')); if (!m) return ''; var y = m[3].length === 2 ? ((Number(m[3]) > 26 ? '19' : '20') + m[3]) : m[3]; return Number(m[1]) + '/' + Number(m[2]) + '/' + y; }",
  [
    "      function nrmDob(s) { /* isodob-1.1.0 (3.0.117): anchored ISO branch first - the M/D/Y regex matched INSIDE an ISO year, so this DOB veto compared 1962-03-04, 1942-03-04 and 1902-03-04 EQUAL and both passed and refused the wrong rows. The hardcoded >26 two-digit pivot is retired for the dynamic one. */ var iso = " + ISO_RE + ".exec(String(s || '')); if (iso) return Number(iso[3]) + '/' + Number(iso[4]) + '/' + iso[2]; var m = /([01]?\\d)[\\/\\-\\.]([0-3]?\\d)[\\/\\-\\.](\\d{2,4})/.exec(String(s || '')); if (!m) return ''; var y = m[3].length === 2 ? ((Number(m[3]) > ((new Date().getFullYear() % 100) + 1) ? '19' : '20') + m[3]) : m[3]; return Number(m[1]) + '/' + Number(m[2]) + '/' + y; }"
  ]);

/* A4: the visits-read wrong-chart verdict. The function line itself is not
   unique (the write-lane twin is byte-identical), so the RUN is the anchor and
   the insert lands after its first line - which is the only line of that run
   this edit touches, and the run's terminators are mixed. */
insertAfterRunLine('A4-visits-wrongchart-iso',
  [
    '    function nrmDob(s) {',
    "      var m = /([01]?\\d)[\\/\\-\\.]([0-3]?\\d)[\\/\\-\\.](\\d{2,4})/.exec(String(s || ''));",
    "      if (!m) return '';",
    '      /* v1.89 (wf_4): DYNAMIC 2-digit-year pivot - anything "after next year"'
  ], 0,
  [
    '      /* isodob-1.1.0 (3.0.117): anchored ISO branch first. The M/D/Y regex',
    '         below matches INSIDE an ISO year, so 1962-03-04, 1942-03-04 and',
    "         1902-03-04 all returned '2/3/2004' and the VISITS-READ wrong-chart",
    '         verdict compared different people equal (measured 2026-09-11). */',
    '      var iso = ' + ISO_RE + ".exec(String(s || ''));",
    "      if (iso) { var isoMo = Number(iso[3]), isoDy = Number(iso[4]); if (isoMo < 1 || isoMo > 12 || isoDy < 1 || isoDy > 31) return ''; return isoMo + '/' + isoDy + '/' + iso[2]; }"
  ]);

/* A5: the write-lane wrong-chart verdict (the byte-identical twin). */
insertAfterRunLine('A5-writelane-wrongchart-iso',
  [
    '    function nrmDob(s) {',
    "      var m = /([01]?\\d)[\\/\\-\\.]([0-3]?\\d)[\\/\\-\\.](\\d{2,4})/.exec(String(s || ''));",
    "      if (!m) return '';",
    '      var pivot = (new Date().getFullYear() % 100) + 1;'
  ], 0,
  [
    '      /* isodob-1.1.0 (3.0.117): anchored ISO branch first. The M/D/Y regex',
    '         below matches INSIDE an ISO year, so 1962-03-04, 1942-03-04 and',
    "         1902-03-04 all returned '2/3/2004' and the WRITE-LANE wrong-chart",
    '         verdict compared different people equal (measured 2026-09-11). */',
    '      var iso = ' + ISO_RE + ".exec(String(s || ''));",
    "      if (iso) { var isoMo = Number(iso[3]), isoDy = Number(iso[4]); if (isoMo < 1 || isoMo > 12 || isoDy < 1 || isoDy > 31) return ''; return isoMo + '/' + isoDy + '/' + iso[2]; }"
  ]);

/* ================================================================== */
/* B. DAY-GRID BAND - bandnormalize-1.0.0                             */
/* ================================================================== */

/* B1: discover vertical scroll containers by SHAPE, not by content. The
   rendered-cell test survives only as a score boost, so the best candidate
   still sorts first on a day that already paints rows. */
replaceLine('B1-shape-discovery',
  '        _allS.forEach(function(el){try{var cs=_dvS.getComputedStyle(el),sh=el.scrollHeight||0,ch=el.clientHeight||0,shaped=!!el.querySelector(\'[class*="PatientAppointment_appointment-container"], [class~="filled-appointment-row"]\');if(shaped&&/(auto|scroll)/.test(cs.overflowY)&&sh>ch+40&&ch>100)_vS.push({el:el,score:(sh-ch)+1000000});}catch(_e){}});',
  [
    '        /* bandnormalize-1.0.0 (3.0.117): discovery by SHAPE. The shipped test',
    '           accepted a scroll container ONLY when it ALREADY contained a rendered',
    '           appointment cell, so a grid parked on an empty band could never be',
    '           found - and it was the scrolling that would have rendered the rows.',
    '           Geometry plus a schedule/calendar/grid ancestor is the gate now;',
    '           containing a rendered cell is a SCORE BOOST, so on a day that paints',
    '           rows the same container still sorts first. */',
    '        function __vScanS(){var _vF=[];var _shapeSelS=\'[class*="PatientAppointment_appointment-container"], [class~="filled-appointment-row"]\';_allS.forEach(function(el){try{var cs=_dvS.getComputedStyle(el),sh=el.scrollHeight||0,ch=el.clientHeight||0;if(!/(auto|scroll)/.test(cs.overflowY)||!(sh>ch+40)||!(ch>100))return;var shaped=!!el.querySelector(_shapeSelS);var gridish=false;try{gridish=!!(el.closest&&el.closest(\'[class*="schedule"],[class*="Schedule"],[class*="calendar"],[class*="Calendar"],[role="grid"],[role="table"],main\'));}catch(_eG){}if(!shaped&&!gridish)return;_vF.push({el:el,score:(sh-ch)+(shaped?1000000:0)});}catch(_e){}});try{var _deS=doc.scrollingElement;if(_deS&&_deS.scrollHeight>_deS.clientHeight+40)_vF.push({el:_deS,score:(_deS.scrollHeight-_deS.clientHeight)+(_deS.querySelector(_shapeSelS)?500000:0)});}catch(_e){}return _vF;}'
  ]);

/* B2: the band pre-pass. Runs ONLY when the grid has painted ZERO appointment
   cells, so every day that already renders rows is byte-for-byte the shipped
   path and the user's scroll position is never moved. */
replaceLine('B2-band-prepass',
  '        try{var _deS=doc.scrollingElement;if(_deS&&_deS.scrollHeight>_deS.clientHeight+40&&_deS.querySelector(\'[class*="PatientAppointment_appointment-container"], [class~="filled-appointment-row"]\'))_vS.push({el:_deS,score:(_deS.scrollHeight-_deS.clientHeight)+500000});}catch(_e){}',
  [
    "        /* bandnormalize-1.0.0 (3.0.117, measured live 2026-09-11 00:03):",
    "           athenaOne's Day calendar can open auto-scrolled to the empty",
    '           19:00-23:00 band of its virtualized grid. With ZERO appointment cells',
    '           rendered nothing downstream can recover: the sweep had no container to',
    '           walk, 0 rows parsed, authoritativeEmpty stayed false (an empty band',
    '           paints no empty-state text) and the pull refused schedule-incomplete',
    "           with cause no-readable-rows on a day that was full. Forcing the",
    '           container to the top band rendered the whole day. This pre-pass runs',
    '           ONLY when the row count is zero, so a day that already paints rows',
    "           keeps the shipped path and the doctor's scroll position exactly.",
    '           Read-only: it scrolls a container and reads a count. Nothing is',
    '           clicked, typed or navigated. */',
    '        var _bandS = { attempted: false, scrolledToTop: false, rowsBefore: 0, rowsAfter: 0, stable: false, reads: 0, midBandRetry: false, containersBefore: 0, containersAfter: 0 };',
    '        function _rowCountS(){ try { return doc.querySelectorAll(\'[class*="PatientAppointment_appointment-container"], [class~="filled-appointment-row"]\').length; } catch (_eRC) { return 0; } }',
    '        var _vScan0S = __vScanS();',
    '        _bandS.containersBefore = _vScan0S.length;',
    '        _bandS.rowsBefore = _rowCountS();',
    '        if (_bandS.rowsBefore === 0 && _vScan0S.length && __scheduleActionAllowed()) {',
    '          _vScan0S.sort(function(a,b){return b.score-a.score;});',
    '          var _bandElS = _vScan0S[0].el;',
    '          _bandS.attempted = true;',
    "          try { _bandElS.scrollTop = 0; _bandElS.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (_eB1) {}",
    '          try { _bandS.scrolledToTop = Number(_bandElS.scrollTop || 0) <= 4; } catch (_eB2) { _bandS.scrolledToTop = false; }',
    '          var _bandPrevS = -1;',
    '          for (var _bandI = 0; _bandI < 10 && __scheduleActionAllowed(); _bandI++) {',
    '            if (!(await _sleepS(400))) break;',
    '            _bandS.reads++;',
    '            var _bandNowS = _rowCountS();',
    '            if (_bandNowS > 0 && _bandNowS === _bandPrevS) { _bandS.stable = true; break; }',
    '            _bandPrevS = _bandNowS;',
    '          }',
    '          _bandS.rowsAfter = _rowCountS();',
    '          if (_bandS.rowsAfter === 0 && __scheduleActionAllowed()) {',
    '            /* Still nothing at the top band. Try the middle band once, then',
    '               come back to the top and read again before anyone refuses. */',
    '            _bandS.midBandRetry = true;',
    "            try { var _bandMaxS = Math.max(0, (_bandElS.scrollHeight || 0) - (_bandElS.clientHeight || 0)); _bandElS.scrollTop = Math.round(_bandMaxS / 2); _bandElS.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (_eB3) {}",
    '            if (await _sleepS(400)) { _bandS.reads++; _bandS.rowsAfter = _rowCountS(); }',
    "            try { _bandElS.scrollTop = 0; _bandElS.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (_eB4) {}",
    '            if (await _sleepS(400)) { _bandS.reads++; _bandS.rowsAfter = _rowCountS(); }',
    '          }',
    '        }',
    '        var _vRescanS = __vScanS();',
    '        _bandS.containersAfter = _vRescanS.length;',
    '        out.diag.bandNormalize = _bandS;',
    '        _vRescanS.forEach(function(v){ _vS.push(v); });'
  ]);

/* B3: carry the band receipt out with the schedule receipt, so an empty band is
   distinguishable from a genuinely empty day without guessing. */
insertAfterLine('B3-band-receipt',
  '        var __receipt = {',
  [
    '          bandNormalize: (__dd && __dd.bandNormalize) || null, /* bandnormalize-1.0.0 (3.0.117): PHI-free - counts and flags only */'
  ]);

/* ================================================================== */
/* C. KEEP-ALIVE BACKSTOP - kabackstop-1.0.0                          */
/* ================================================================== */

/* C1: kaFrameTouch takes a mode. */
replaceLine('C1-ka-mode',
  'function kaFrameTouch() {',
  [
    "/* kabackstop-1.0.0 (3.0.117): kaMode 'dialog-only' runs ONLY the shadow-DOM",
    '   session-expiry dialog backstop - no synthetic events, no authenticated',
    '   fetches. The tick used to defer this whole function while a chart read or a',
    '   quiet pull was live, i.e. for the ENTIRE length of a day or month pull, so a',
    "   long run could meet athenaOne's idle logout with the backstop blind and the",
    '   rows simply stopped arriving. The frame touches stay deferred (they perturb',
    '   the DOM a read is walking); clicking a modal Continue button does not. */',
    'function kaFrameTouch(kaMode) {'
  ]);

/* C2: the three synthetic touches, guarded. */
replaceRun('C2-touches-guarded',
  [
    "    try { document.dispatchEvent(new Event('mousemove', { bubbles: true })); } catch (e1) {}",
    "    try { document.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (e2) {}",
    "    try { if (document.body) document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 3, clientY: 3 })); } catch (e3) {}"
  ],
  [
    "    if (kaMode !== 'dialog-only') {",
    "      try { document.dispatchEvent(new Event('mousemove', { bubbles: true })); } catch (e1) {}",
    "      try { document.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (e2) {}",
    "      try { if (document.body) document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 3, clientY: 3 })); } catch (e3) {}",
    '    }'
  ]);

/* C3: the authenticated fetches, guarded. */
replaceLine('C3-fetches-guarded',
  '    if (window === window.top) {',
  [
    "    if (window === window.top && kaMode !== 'dialog-only') {"
  ]);

/* C4: a busy tick runs the dialog backstop before it defers. */
replaceRun('C4-busy-runs-backstop',
  [
    '    if (__kaPullBusyNow()) {',
    '      __kaDeferForPull();',
    '      return;',
    '    }'
  ],
  [
    '    /* kabackstop-1.0.0 (3.0.117): a busy tick no longer skips the expiry',
    '       dialog. Run the dialog-ONLY backstop across the signed-in athena tabs',
    '       first - one shadow-DOM walk and, at most, one click on a Continue',
    '       button - then defer the frame-touch tick exactly as before. */',
    '    if (__kaPullBusyNow()) {',
    '      var __kaBackstopClicks = 0, __kaBackstopTabs = 0;',
    '      try {',
    "        var __kaBusyTabs = await chrome.tabs.query({ url: 'https://athenanet.athenahealth.com/*' });",
    '        for (var __kbi = 0; __kbi < (__kaBusyTabs || []).length; __kbi++) {',
    '          var __kbt = __kaBusyTabs[__kbi];',
    '          if (!__kbt || __kbt.id == null || __kbt.discarded) continue;',
    '          try { if (mlsAthIsLoginish(__kbt)) continue; } catch (eKbL) {}',
    '          __kaBackstopTabs++;',
    '          try {',
    "            var __kbr = await chrome.scripting.executeScript({ target: { tabId: __kbt.id, allFrames: true }, func: kaFrameTouch, args: ['dialog-only'] });",
    "            if ((__kbr || []).some(function (r0) { return r0 && r0.result === 'ka-clicked-continue'; })) __kaBackstopClicks++;",
    '          } catch (eKbX) {}',
    '        }',
    '      } catch (eKbQ) {}',
    '      try { chrome.storage.local.set({ mlsKeepAliveLastBackstopAt: Date.now(), mlsKeepAliveLastBackstopClicks: __kaBackstopClicks, mlsKeepAliveLastBackstopTabs: __kaBackstopTabs }, function () {}); } catch (eKbS) {}',
    '      __kaDeferForPull();',
    '      return;',
    '    }'
  ]);

/* C5: the per-tab re-check likewise runs the backstop before deferring. */
replaceLine('C5-pertab-backstop',
  '      if (__kaPullBusyNow()) { __kaDeferForPull(); return; }',
  [
    '      if (__kaPullBusyNow()) {',
    '        /* kabackstop-1.0.0 (3.0.117): a read acquired while tabs.query settled',
    '           still must not cost this tab its expiry backstop. */',
    "        try { await chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, func: kaFrameTouch, args: ['dialog-only'] }); } catch (eKbT) {}",
    '        try { chrome.storage.local.set({ mlsKeepAliveLastBackstopAt: Date.now() }, function () {}); } catch (eKbS2) {}',
    '        __kaDeferForPull();',
    '        return;',
    '      }'
  ]);

/* ================================================================== */
/* D. SEARCH VALUE VERIFICATION + RETRY                               */
/* ================================================================== */

/* D1: the global-search fill phase types, settles, READS THE FIELD BACK, and
   only then lets the Enter/submit lines below run. */
replaceRun('D1-search-value-verify',
  [
    '          if (setter && setter.set) setter.set.call(best, searchStr); else best.value = searchStr;',
    '          if (!openAllowed()) return deadlineOut();',
    "          best.dispatchEvent(new Event('input', { bubbles: true }));",
    "          best.dispatchEvent(new Event('change', { bubbles: true }));"
  ],
  [
    '          /* searchverify-1.0.0 (3.0.117, measured live 2026-09-11): athenaOne',
    "             global search DROPS or RE-ORDERS typed characters under load - a",
    '             typed 7-digit MRN read back as a DIFFERENT 7-digit id, and the chart',
    '             that opened belonged to someone else. Type, settle, READ THE FIELD',
    '             BACK, and submit only when it equals the intended string; otherwise',
    '             clear it (native setter plus input) and retype, up to three attempts.',
    '             A detached field can still report the value we wrote, so the node',
    '             must also still be connected. Nothing below this loop runs until the',
    '             value verifies; when it never does, nothing is submitted at all. */',
    '          function __svSleep(ms) { var __svAt = Date.now() + Math.max(0, Number(ms || 0)); return new Promise(function (r) { /* mls-hs-1.0.0: a hidden tab freezes timers; yield through a MessageChannel until the wall clock passes. */ if (typeof document === \'undefined\' || !document.hidden) { setTimeout(r, Math.max(0, __svAt - Date.now())); return; } var __svCh = null; try { __svCh = new MessageChannel(); } catch (e) { __svCh = null; } if (!__svCh) { setTimeout(r, Math.max(0, __svAt - Date.now())); return; } __svCh.port1.onmessage = function () { if (Date.now() >= __svAt) { try { __svCh.port1.onmessage = null; __svCh.port1.close(); __svCh.port2.close(); } catch (e2) {} r(); return; } if (!document.hidden) { try { __svCh.port1.onmessage = null; __svCh.port1.close(); __svCh.port2.close(); } catch (e3) {} setTimeout(r, Math.max(0, __svAt - Date.now())); return; } try { __svCh.port2.postMessage(0); } catch (e4) { setTimeout(r, Math.max(0, __svAt - Date.now())); } }; __svCh.port2.postMessage(0); }); }',
    '          var __svTyped = false;',
    '          for (var __svTry = 0; __svTry < 3 && !__svTyped; __svTry++) {',
    '            if (!openAllowed()) return deadlineOut();',
    "            if (!typableField(best)) return { phase: 'fill', filled: false, attempted: false, diag: diag, reason: 'numeric-only-field-refused' };",
    "            try { if (setter && setter.set) setter.set.call(best, ''); else best.value = ''; } catch (eSvClear) {}",
    "            try { best.dispatchEvent(new Event('input', { bubbles: true })); } catch (eSvClearEv) {}",
    '            if (setter && setter.set) setter.set.call(best, searchStr); else best.value = searchStr;',
    '            if (!openAllowed()) return deadlineOut();',
    "            best.dispatchEvent(new Event('input', { bubbles: true }));",
    "            best.dispatchEvent(new Event('change', { bubbles: true }));",
    '            await __svSleep(260);',
    "            var __svRead = ''; try { __svRead = String(best.value == null ? '' : best.value); } catch (eSvRead) { __svRead = ''; }",
    '            if (__svRead === searchStr && best.isConnected !== false) { __svTyped = true; break; }',
    '            diag.searchRetypes = (diag.searchRetypes || 0) + 1;',
    '          }',
    '          diag.searchValueVerified = __svTyped;',
    "          if (!__svTyped) return { phase: 'fill', filled: false, attempted: false, diag: diag, reason: 'search-target-unverified', error: \"athenaOne's search did not show this patient; nothing was opened\" };"
  ]);

/* D2: the findpatient result list re-orders between render and click, so the
   chosen row is re-read from the LIVE document and re-verified before the
   click. Never a stale element, never a coordinate. */
replaceRun('D2-findpatient-row-reverify',
  [
    "      if (pool.length > 1) return { opened: false, reason: 'ambiguous', count: pool.length, tier: exact.length ? 'exact' : 'prefix' };",
    '      if (!openAllowed()) return deadlineOut();',
    '      pool[0].a.click();'
  ],
  [
    "      if (pool.length > 1) return { opened: false, reason: 'ambiguous', count: pool.length, tier: exact.length ? 'exact' : 'prefix' };",
    '      /* rowreverify-1.0.0 (3.0.117, measured live 2026-09-11): the result list',
    '         RE-ORDERS between the read that chose a row and the click that opens it,',
    "         so the chart that opened was a different person's and the app-side merge",
    "         refused 'wrong-chart' - correctly, but the row was lost for that pull.",
    '         Settle, RE-READ the live rows, and click only the ONE row that still',
    '         carries this last name (plus the first name, the MRN when the choice was',
    '         narrowed by one, and the DOB veto). Anything else refuses with',
    '         attempted:false and opens nobody. */',
    '      if (!openAllowed()) return deadlineOut();',
    '      await sleep(320);',
    '      if (!openAllowed()) return deadlineOut();',
    "      var _rvWantMrn = (wantMrn && pool[0].mrnMatched === true) ? wantMrn : '';",
    '      var _rvRows = [];',
    '      try {',
    '        var _rvD = best.w.document;',
    "        var _rvAs = Array.prototype.slice.call(_rvD.querySelectorAll('a')).filter(function (a) { return /^chart$/i.test((a.innerText || '').trim()); });",
    '        for (var _rvI = 0; _rvI < _rvAs.length; _rvI++) {',
    "          var _rvTr = _rvAs[_rvI].closest ? _rvAs[_rvI].closest('tr') : null;",
    '          if (!_rvTr) continue;',
    "          var _rvCells = Array.prototype.slice.call(_rvTr.querySelectorAll('td,th')).map(function (x) { return (x.innerText || '').trim(); });",
    "          var _rvT = _rvCells.join(' | ').toLowerCase();",
    '          if (_rvT.indexOf(lnorm) < 0) continue;',
    '          if (fnorm && _rvT.indexOf(fnorm) < 0) continue;',
    '          if (_rvWantMrn) { var _rvMrnHit = false; for (var _rvC = 0; _rvC < _rvCells.length; _rvC++) { if (mrnCellMatches(_rvCells[_rvC], _rvWantMrn)) { _rvMrnHit = true; break; } } if (!_rvMrnHit) continue; }',
    "          if (wantDob) { var _rvDob = ''; for (var _rvC2 = 0; _rvC2 < _rvCells.length; _rvC2++) { var _rvDm = /([01]?\\d)\\/([0-3]?\\d)\\/(\\d{4})/.exec(_rvCells[_rvC2]); if (_rvDm) { _rvDob = Number(_rvDm[1]) + '/' + Number(_rvDm[2]) + '/' + _rvDm[3]; break; } } if (_rvDob && _rvDob !== wantDob) continue; }",
    '          _rvRows.push(_rvAs[_rvI]);',
    '        }',
    '      } catch (_rvE) { _rvRows = []; }',
    '      if (_rvRows.length !== 1) return { opened: false, attempted: false, reason: \'search-target-unverified\', rowsOnReread: _rvRows.length, error: "athenaOne\'s search did not show this patient; nothing was opened" };',
    '      if (!openAllowed()) return deadlineOut();',
    '      _rvRows[0].click();'
  ]);

/* D3: a scanned row can be re-rendered between the scan and the click, so
   clickRow re-reads the row's OWN live text before it touches anything. */
insertAfterLine('D3-clickrow-reverify',
  "          clickRow.reason = '';",
  [
    '          /* rowreverify-1.0.0 (3.0.117): the suggestion dropdown and the schedule',
    '             list both re-render between the scan that scored this row and this',
    "             click. Re-read the row's OWN live text and refuse if it no longer",
    '             carries the patient it was scored for. A detached node is never',
    '             clicked, and no click is ever issued from a stale coordinate. */',
    '          try {',
    "            if (row && row.isConnected === false) { clickRow.reason = 'row-identity-changed'; return false; }",
    '            var __crText = rowText(row).toLowerCase();',
    "            if ((lname && __crText.indexOf(lname) === -1) || (fname && __crText.indexOf(fname) === -1)) { clickRow.reason = 'row-identity-changed'; return false; }",
    '          } catch (eCrVerify) {}'
  ]);

/* D4 / D5: both clickRow call sites must report the new refusal honestly
   instead of falling through to the deadline receipt. */
replaceLine('D4-clickrow-site-1',
  "            if (clickRow.reason === 'appointment-target-not-clinical') return { phase: 'open', opened: false, candidates: 1, reason: clickRow.reason, diag: { frame: location.hostname, scanned: hit.scanned, topScore: hit.sc, apptIdBound: false, apptIdMatches: hit.matches || 1 } };",
  [
    "            if (/^(appointment-target-not-clinical|row-identity-changed)$/.test(clickRow.reason || '')) return { phase: 'open', opened: false, attempted: false, candidates: 1, reason: clickRow.reason, diag: { frame: location.hostname, scanned: hit.scanned, topScore: hit.sc, apptIdBound: false, apptIdMatches: hit.matches || 1 } };"
  ]);

replaceLine('D5-clickrow-site-2',
  "                if (clickRow.reason === 'appointment-target-not-clinical') return { phase: 'open', opened: false, candidates: 1, reason: clickRow.reason, diag: { frame: location.hostname, scanned: scannedTotal, scrolledTo: y, topScore: h2.sc, apptIdBound: false, apptIdMatches: h2.matches || 1 } };",
  [
    "                if (/^(appointment-target-not-clinical|row-identity-changed)$/.test(clickRow.reason || '')) return { phase: 'open', opened: false, attempted: false, candidates: 1, reason: clickRow.reason, diag: { frame: location.hostname, scanned: scannedTotal, scrolledTo: y, topScore: h2.sc, apptIdBound: false, apptIdMatches: h2.matches || 1 } };"
  ]);

/* D6: the caller's fill-failure sentence names the new refusal in plain
   English. The other two branches are byte-unchanged. */
replaceLine('D6-fill-failure-sentence',
  "            sendResponse({ ok: false, opened: false, reason: (fill && fill.reason) || '', error: (fill && fill.reason === 'numeric-only-field-refused') ? 'Refused: the only patient field on this screen accepts numbers only, and typing a name there makes athenaNet raise a blocking dialog. The chart was skipped instead.' : 'Could not find the Athena patient search box on this screen.', diag: fill && fill.diag });",
  [
    "            sendResponse({ ok: false, opened: false, attempted: false, reason: (fill && fill.reason) || '', error: (fill && fill.reason === 'numeric-only-field-refused') ? 'Refused: the only patient field on this screen accepts numbers only, and typing a name there makes athenaNet raise a blocking dialog. The chart was skipped instead.' : ((fill && fill.reason === 'search-target-unverified') ? \"athenaOne's search did not show this patient; nothing was opened.\" : 'Could not find the Athena patient search box on this screen.'), diag: fill && fill.diag });"
  ]);

/* D7: the findpatient refusal set must include the new reason, or the driver
   falls through to the legacy schedule scanner after refusing. */
replaceLine('D7-findpatient-refusal-set',
  "              if (findRes && /^(ambiguous|no-results|no-name-match|blank-error|rows-not-rendered|dob-mismatch)$/.test(findRes.reason || '')) {",
  [
    "              if (findRes && /^(ambiguous|no-results|no-name-match|blank-error|rows-not-rendered|dob-mismatch|search-target-unverified)$/.test(findRes.reason || '')) {"
  ]);

replaceLine('D8-findpatient-refusal-sentence',
  "                    : 'athenaOne patient search found no matching patient.',",
  [
    "                    : findRes.reason === 'search-target-unverified' ? \"athenaOne's search did not show this patient; nothing was opened.\"",
    "                    : 'athenaOne patient search found no matching patient.',"
  ]);

/* ================================================================== */
/* E. OPENED-CHART IDENTITY - additive receipts only                  */
/* ================================================================== */

/* E1: the wrong-chart refusal says nothing was captured AND carries the MRN
   digit COUNTS so a mismatch is diagnosable without an MRN ever leaving the
   worker. The fields the app already reads are untouched. */
replaceLine('E1-wrongchart-receipt',
  "            return chartRespond({ ok: false, reason: 'wrong-chart', chartName: ident.name, chartDob: ident.dob || '', opened: opened, version: versionStrict, error: 'The open athenaOne chart identity does not match ' + want + '. Nothing was captured for ' + want + '.' });",
  [
    "            return chartRespond({ ok: false, reason: 'wrong-chart', attempted: false, captured: false, chartName: ident.name, chartDob: ident.dob || '', expectedMrnDigits: mrnKeyStrict(wantMrn).length, observedMrnDigits: mrnKeyStrict(ident.mrn).length, opened: opened, version: versionStrict, error: 'The open athenaOne chart identity does not match ' + want + '. Nothing was captured for ' + want + '.' });"
  ]);

/* E2: the identity block the app needs to FILL a missing DOB from the chart
   (owner ruling 2026-08-28: auto-merge only on MRN or name+DOB) instead of
   refusing dob-mismatch. When BOTH DOBs exist and differ, nothing here
   changes - that stays a dob-mismatch decided app-side. */
insertAfterLine('E2-identity-block',
  '          const briefingDiag = { offered: (briefingFrames || []).length, bound: briefingBound.length, used: briefingUsed, omitted: briefingOmitted, chars: briefingShip.length, apptScoped: briefingApptRe ? 1 : 0, identityHeld: exactGlobalIdentity ? 1 : 0 };',
  [
    '          /* identityfill-1.0.0 (3.0.117): PHI-free flags only - the chart DOB',
    '             itself already ships as chartDob on this same response. mrnMatched',
    '             says the opened chart proved the expected MRN; dobFillable says the',
    '             row carried NO DOB and the chart did, which is the one case the app',
    "             may fill instead of refusing. identityMode 'identity-name-only' says",
    '             the row had neither MRN nor DOB, so this capture is a suggestion and',
    '             never an automatic merge. */',
    "          const __mlsIdentityFill = { mrnMatched: !!(wantMrn && ident && ident.mrn && mrnKeyStrict(ident.mrn) === mrnKeyStrict(wantMrn)), dobRead: !!(ident && ident.dob), dobSource: (ident && ident.dob) ? 'chart' : '', dobFillable: !!(!wantDob && ident && ident.dob), identityMode: (!wantMrn && !wantDob) ? 'identity-name-only' : 'identity-verified' };"
  ]);

/* E3: ship it. Every existing field on this response is byte-unchanged. */
replaceLine('E3-success-identity',
  "          return chartRespond({ ok: true, text: chartTextStrict, receipt: chartReceiptStrict, url: pickStrict.u || tab.url, title: tab.title, opened: opened, frames: eligibleFrames.length, stageMs: { total: Date.now() - chartRequestStartedAt, identity: __identDoneAt - T0, text: Date.now() - __identDoneAt, polls: polls }, chartName: (ident && ident.name) || '', chartDob: (ident && ident.dob) || '', chartMrn: (ident && ident.mrn) || '', version: versionStrict, via: (ident && ident.via) || '', briefingText: briefingShip, briefingDiag: briefingDiag, briefingNav: navClicked || '', identDiag: identDiag, textDiag: textDiagStrict, expected: expectName ? 1 : 0 });",
  [
    "          return chartRespond({ ok: true, text: chartTextStrict, receipt: chartReceiptStrict, url: pickStrict.u || tab.url, title: tab.title, opened: opened, frames: eligibleFrames.length, stageMs: { total: Date.now() - chartRequestStartedAt, identity: __identDoneAt - T0, text: Date.now() - __identDoneAt, polls: polls }, chartName: (ident && ident.name) || '', chartDob: (ident && ident.dob) || '', chartMrn: (ident && ident.mrn) || '', identity: __mlsIdentityFill, version: versionStrict, via: (ident && ident.via) || '', briefingText: briefingShip, briefingDiag: briefingDiag, briefingNav: navClicked || '', identDiag: identDiag, textDiag: textDiagStrict, expected: expectName ? 1 : 0 });"
  ]);

/* ------------------------------------------------------------------ */
/* Census: the terminator counts may move ONLY by the edited lines.    */
/* ------------------------------------------------------------------ */
var expectedCr = 0, expectedLf = 0;
ops.forEach(function (op) {
  var net = op.added - op.removed;
  expectedLf += net;
  if (op.eol === 'CRLF') expectedCr += net;
});

fs.writeFileSync(OUT, s, 'latin1');
var after = census(s);

console.log('input           : ' + IN);
console.log('output          : ' + OUT);
ops.forEach(function (op) {
  console.log('  ' + op.tag + '  ' + op.kind + '  eol=' + op.eol + '  -' + op.removed + ' +' + op.added);
});
console.log('ops             : ' + ops.length);
console.log('census before   : bytes=' + before.bytes + ' CR=' + before.cr + ' LF=' + before.lf);
console.log('census after    : bytes=' + after.bytes + ' CR=' + after.cr + ' LF=' + after.lf);
console.log('byte delta      : ' + (after.bytes - before.bytes));
console.log('CR delta        : ' + (after.cr - before.cr) + ' (expected ' + expectedCr + ')');
console.log('LF delta        : ' + (after.lf - before.lf) + ' (expected ' + expectedLf + ')');

if (after.cr - before.cr !== expectedCr) { console.error('ABORT: CR census moved by more than the edited lines'); process.exit(1); }
if (after.lf - before.lf !== expectedLf) { console.error('ABORT: LF census moved by more than the edited lines'); process.exit(1); }
console.log('SPLICE OK (isodob-1.1.0 / bandnormalize-1.0.0 / kabackstop-1.0.0 / searchverify-1.0.0 / rowreverify-1.0.0 / identityfill-1.0.0)');
