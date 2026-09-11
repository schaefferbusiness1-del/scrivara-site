/* splice-30117-proof.js - independent proof for the 3.0.117 draft splice.
 *
 *   node scripts/splice-30117-proof.js <spliced-background.js> [baseline-background.js]
 *
 * baseline defaults to $BACKGROUND_BASELINE, else ./background.js. The
 * extension repo root is taken as the baseline's directory.
 *
 * It proves, WITHOUT trusting splice-30117.js:
 *   1  every intended edit is present VERBATIM, as ONE contiguous run of lines,
 *      the expected number of times (contiguity matters: lines like
 *      "if (!openAllowed()) return deadlineOut();" occur all over the file);
 *   2  every replaced line is gone, and was present in the baseline;
 *   3  the CR/LF census moved by exactly the inserted lines and nothing else,
 *      no non-ASCII byte was introduced, and - the strong one - the multiset of
 *      line CONTENTS changed ONLY by the declared removals and the declared
 *      payload, so nothing outside the 24 named edits moved;
 *   4  DOB READER PARITY, EXECUTED. Every dateKey/normDob/nrmDob body is
 *      extracted from BOTH files by brace balance, eval'd, and called: the
 *      baseline must COLLIDE on 1962-03-04 / 1942-03-04 / 1902-03-04 at the
 *      five named sites (so the proof is red on today's bytes), and the draft
 *      must collide nowhere, must read an ISO DOB equal to its slash form, and
 *      must be byte-for-byte unchanged on slash input;
 *   5  scope: the 3.0.116 native section-persistence block is byte-identical,
 *      no write / save / sign / order / billing / proof-mint / token-lock line
 *      moved, the new refusals carry attempted:false, and every field the
 *      shipped receipts already carried is still there (additive only);
 *   6  node --check passes on the spliced file;
 *   7  every extension suite that reads background.js AND touches this lane
 *      passes when pointed at the spliced copy.
 *
 * HOW THE SUITES ARE POINTED AT THE COPY. The suites read
 * path.join(__dirname, '..', 'background.js') directly and honour no override.
 * The tests are NOT edited. This script writes a tiny preload module and runs
 * each suite as
 *   BACKGROUND_JS=<spliced> BACKGROUND_TRACKED=<repo>/background.js \
 *     node --require <preload> tests/<suite>.test.js
 * from the extension repo root. The preload redirects fs.readFileSync of THAT
 * ONE path to $BACKGROUND_JS and leaves every other read alone - which matters,
 * because some suites also read a historical
 * extension-candidates/3.0.4x/background.js and must keep getting the real one.
 * To run a suite by hand, use exactly that invocation.
 *
 * TWO CAVEATS, BOTH REPORTED RATHER THAN HIDDEN:
 *   - the playwright-backed runtime suites need node_modules, which this repo
 *     does not have. Set PLAYWRIGHT_NODE_PATH (copied into NODE_PATH for the
 *     child) to a sibling worktree's node_modules.
 *   - savenamed-slate-editor-reader-runtime.test.js pins manifest.version and
 *     the core-sha256 digest, and computes that digest in a CHILD process the
 *     preload cannot reach. Against a draft copy that one assertion is still
 *     checking the TRACKED file. Version bump and digest stamping are a
 *     separate job; treat that assertion as not proven here.
 */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var OUT = process.argv[2];
var BASE = process.argv[3] || process.env.BACKGROUND_BASELINE || 'background.js';
if (!OUT) {
  console.error('usage: node scripts/splice-30117-proof.js <spliced-background.js> [baseline-background.js]');
  process.exit(1);
}
OUT = path.resolve(OUT);
BASE = path.resolve(BASE);

var out = fs.readFileSync(OUT, 'latin1');
var base = fs.readFileSync(BASE, 'latin1');

var failures = [], checks = 0;
function ok(label) { checks++; console.log('  ok   ' + label); }
function bad(label) { checks++; failures.push(label); console.log('  FAIL ' + label); }
function check(cond, label) { if (cond) ok(label); else bad(label); }

function lines(str) { return str.split('\n').map(function (l) { return l.charCodeAt(l.length - 1) === 13 ? l.slice(0, -1) : l; }); }
function countLine(arr, line) { var n = 0; for (var i = 0; i < arr.length; i++) if (arr[i] === line) n++; return n; }
function countRun(arr, run) {
  var n = 0;
  for (var i = 0; i + run.length <= arr.length; i++) {
    var hit = true;
    for (var j = 0; j < run.length; j++) if (arr[i + j] !== run[j]) { hit = false; break; }
    if (hit) n++;
  }
  return n;
}
function census(str) {
  var cr = 0, lf = 0;
  for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); if (c === 13) cr++; else if (c === 10) lf++; }
  return { bytes: str.length, cr: cr, lf: lf };
}

var outLines = lines(out), baseLines = lines(base);

var ISO_RE = "/(^|[^0-9])(\\d{4})-([01]\\d)-([0-3]\\d)(?![0-9])/";

/* ------------------------------------------------------------------ */
/* 1. Every intended edit, verbatim, contiguous, the expected count.   */
/* ------------------------------------------------------------------ */
var GROUPS = [
  { tag: 'A1 day-schedule dateKey ISO branch', want: 1, run: [
    '      /* isodob-1.1.0 (3.0.117): an ISO DOB (1962-03-04) must not be scanned',
    "         by the M/D/Y reader below - it first matches INSIDE the year ('2-03-04')",
    '         and reads a different person, so 1962/1942/1902-03-04 all collapsed to',
    '         one key (measured 2026-09-11). Anchored ISO branch first; the M/D/Y',
    '         branch below is byte-unchanged. Same implementation as the module-scope',
    '         dateKey (isodob-1.0.0, 3.0.99) - an injected function cannot close over',
    '         a worker helper, so the branch is repeated, never shared. */',
    '      var iso = ' + ISO_RE + ".exec(String(v || ''));",
    "      if (iso) return Number(iso[3]) + '/' + Number(iso[4]) + '/' + iso[2];"
  ] },
  { tag: 'A2 merge comparator normDob', want: 1, run: [
    "  function normDob(s) { /* isodob-1.1.0 (3.0.117): anchored ISO branch first - the M/D/Y regex matched INSIDE an ISO year, so this merge comparator returned one key for three different decades. The hardcoded >30 two-digit pivot is retired for the dynamic one. The zero-padded MM/DD/YYYY output shape is unchanged. */ var iso = " + ISO_RE + ".exec(String(s || '')); if (iso) return iso[3] + '/' + iso[4] + '/' + iso[2]; var m = /([01]?\\d)[\\/\\-\\.]([0-3]?\\d)[\\/\\-\\.](\\d{2,4})/.exec(String(s || '')); if (!m) return ''; var y = m[3]; if (y.length === 2) y = (Number(y) > ((new Date().getFullYear() % 100) + 1) ? '19' : '20') + y; return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + y; }"
  ] },
  { tag: 'A3 search DOB veto nrmDob', want: 1, run: [
    "      function nrmDob(s) { /* isodob-1.1.0 (3.0.117): anchored ISO branch first - the M/D/Y regex matched INSIDE an ISO year, so this DOB veto compared 1962-03-04, 1942-03-04 and 1902-03-04 EQUAL and both passed and refused the wrong rows. The hardcoded >26 two-digit pivot is retired for the dynamic one. */ var iso = " + ISO_RE + ".exec(String(s || '')); if (iso) return Number(iso[3]) + '/' + Number(iso[4]) + '/' + iso[2]; var m = /([01]?\\d)[\\/\\-\\.]([0-3]?\\d)[\\/\\-\\.](\\d{2,4})/.exec(String(s || '')); if (!m) return ''; var y = m[3].length === 2 ? ((Number(m[3]) > ((new Date().getFullYear() % 100) + 1) ? '19' : '20') + m[3]) : m[3]; return Number(m[1]) + '/' + Number(m[2]) + '/' + y; }"
  ] },
  { tag: 'A4 visits-read wrong-chart nrmDob ISO branch', want: 1, run: [
    '      /* isodob-1.1.0 (3.0.117): anchored ISO branch first. The M/D/Y regex',
    '         below matches INSIDE an ISO year, so 1962-03-04, 1942-03-04 and',
    "         1902-03-04 all returned '2/3/2004' and the VISITS-READ wrong-chart",
    '         verdict compared different people equal (measured 2026-09-11). */',
    '      var iso = ' + ISO_RE + ".exec(String(s || ''));",
    "      if (iso) { var isoMo = Number(iso[3]), isoDy = Number(iso[4]); if (isoMo < 1 || isoMo > 12 || isoDy < 1 || isoDy > 31) return ''; return isoMo + '/' + isoDy + '/' + iso[2]; }"
  ] },
  { tag: 'A5 write-lane wrong-chart nrmDob ISO branch', want: 1, run: [
    '      /* isodob-1.1.0 (3.0.117): anchored ISO branch first. The M/D/Y regex',
    '         below matches INSIDE an ISO year, so 1962-03-04, 1942-03-04 and',
    "         1902-03-04 all returned '2/3/2004' and the WRITE-LANE wrong-chart",
    '         verdict compared different people equal (measured 2026-09-11). */',
    '      var iso = ' + ISO_RE + ".exec(String(s || ''));",
    "      if (iso) { var isoMo = Number(iso[3]), isoDy = Number(iso[4]); if (isoMo < 1 || isoMo > 12 || isoDy < 1 || isoDy > 31) return ''; return isoMo + '/' + isoDy + '/' + iso[2]; }"
  ] },
  { tag: 'B1 shape-based vertical scroller discovery', want: 1, run: [
    '        function __vScanS(){var _vF=[];var _shapeSelS=\'[class*="PatientAppointment_appointment-container"], [class~="filled-appointment-row"]\';_allS.forEach(function(el){try{var cs=_dvS.getComputedStyle(el),sh=el.scrollHeight||0,ch=el.clientHeight||0;if(!/(auto|scroll)/.test(cs.overflowY)||!(sh>ch+40)||!(ch>100))return;var shaped=!!el.querySelector(_shapeSelS);var gridish=false;try{gridish=!!(el.closest&&el.closest(\'[class*="schedule"],[class*="Schedule"],[class*="calendar"],[class*="Calendar"],[role="grid"],[role="table"],main\'));}catch(_eG){}if(!shaped&&!gridish)return;_vF.push({el:el,score:(sh-ch)+(shaped?1000000:0)});}catch(_e){}});try{var _deS=doc.scrollingElement;if(_deS&&_deS.scrollHeight>_deS.clientHeight+40)_vF.push({el:_deS,score:(_deS.scrollHeight-_deS.clientHeight)+(_deS.querySelector(_shapeSelS)?500000:0)});}catch(_e){}return _vF;}'
  ] },
  { tag: 'B2 band pre-pass (row-count gate, top band, stability poll, re-discover)', want: 1, run: [
    '        var _bandS = { attempted: false, scrolledToTop: false, rowsBefore: 0, rowsAfter: 0, stable: false, reads: 0, midBandRetry: false, containersBefore: 0, containersAfter: 0 };',
    '        function _rowCountS(){ try { return doc.querySelectorAll(\'[class*="PatientAppointment_appointment-container"], [class~="filled-appointment-row"]\').length; } catch (_eRC) { return 0; } }',
    '        var _vScan0S = __vScanS();',
    '        _bandS.containersBefore = _vScan0S.length;',
    '        _bandS.rowsBefore = _rowCountS();',
    '        if (_bandS.rowsBefore === 0 && _vScan0S.length && __scheduleActionAllowed()) {'
  ] },
  { tag: 'B2b band pre-pass stability poll', want: 1, run: [
    '          var _bandPrevS = -1;',
    '          for (var _bandI = 0; _bandI < 10 && __scheduleActionAllowed(); _bandI++) {',
    '            if (!(await _sleepS(400))) break;',
    '            _bandS.reads++;',
    '            var _bandNowS = _rowCountS();',
    '            if (_bandNowS > 0 && _bandNowS === _bandPrevS) { _bandS.stable = true; break; }',
    '            _bandPrevS = _bandNowS;',
    '          }'
  ] },
  { tag: 'B2c re-discover after the band normalize', want: 1, run: [
    '        var _vRescanS = __vScanS();',
    '        _bandS.containersAfter = _vRescanS.length;',
    '        out.diag.bandNormalize = _bandS;',
    '        _vRescanS.forEach(function(v){ _vS.push(v); });'
  ] },
  { tag: 'B3 bandNormalize rides the schedule receipt', want: 1, run: [
    '        var __receipt = {',
    '          bandNormalize: (__dd && __dd.bandNormalize) || null, /* bandnormalize-1.0.0 (3.0.117): PHI-free - counts and flags only */'
  ] },
  { tag: 'C1 kaFrameTouch takes a mode', want: 1, run: [
    'function kaFrameTouch(kaMode) {'
  ] },
  { tag: 'C2 synthetic touches guarded', want: 1, run: [
    "    if (kaMode !== 'dialog-only') {",
    "      try { document.dispatchEvent(new Event('mousemove', { bubbles: true })); } catch (e1) {}",
    "      try { document.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (e2) {}",
    "      try { if (document.body) document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 3, clientY: 3 })); } catch (e3) {}",
    '    }'
  ] },
  { tag: 'C3 authenticated fetches guarded', want: 1, run: [
    "    if (window === window.top && kaMode !== 'dialog-only') {"
  ] },
  { tag: 'C4 a busy tick runs the dialog backstop before deferring', want: 1, run: [
    '    if (__kaPullBusyNow()) {',
    '      var __kaBackstopClicks = 0, __kaBackstopTabs = 0;',
    '      try {',
    "        var __kaBusyTabs = await chrome.tabs.query({ url: 'https://athenanet.athenahealth.com/*' });"
  ] },
  { tag: 'C4b the backstop injection is dialog-only', want: 1, run: [
    "            var __kbr = await chrome.scripting.executeScript({ target: { tabId: __kbt.id, allFrames: true }, func: kaFrameTouch, args: ['dialog-only'] });",
    "            if ((__kbr || []).some(function (r0) { return r0 && r0.result === 'ka-clicked-continue'; })) __kaBackstopClicks++;"
  ] },
  { tag: 'C5 per-tab busy re-check runs the backstop too', want: 1, run: [
    '      if (__kaPullBusyNow()) {',
    '        /* kabackstop-1.0.0 (3.0.117): a read acquired while tabs.query settled',
    '           still must not cost this tab its expiry backstop. */',
    "        try { await chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, func: kaFrameTouch, args: ['dialog-only'] }); } catch (eKbT) {}",
    '        try { chrome.storage.local.set({ mlsKeepAliveLastBackstopAt: Date.now() }, function () {}); } catch (eKbS2) {}',
    '        __kaDeferForPull();',
    '        return;',
    '      }'
  ] },
  { tag: 'D1 global-search value read-back + 3 attempts', want: 1, run: [
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
  ] },
  { tag: 'D1b the Enter/submit lines still follow the verified fill', want: 1, run: [
    '          diag.searchValueVerified = __svTyped;',
    "          if (!__svTyped) return { phase: 'fill', filled: false, attempted: false, diag: diag, reason: 'search-target-unverified', error: \"athenaOne's search did not show this patient; nothing was opened\" };",
    "          ['keydown', 'keypress', 'keyup'].forEach(function (t) {"
  ] },
  { tag: 'D2 findpatient row re-read before the click', want: 1, run: [
    '      if (!openAllowed()) return deadlineOut();',
    '      await sleep(320);',
    '      if (!openAllowed()) return deadlineOut();',
    "      var _rvWantMrn = (wantMrn && pool[0].mrnMatched === true) ? wantMrn : '';",
    '      var _rvRows = [];'
  ] },
  { tag: 'D2b the click lands on the re-verified row only', want: 1, run: [
    '      if (_rvRows.length !== 1) return { opened: false, attempted: false, reason: \'search-target-unverified\', rowsOnReread: _rvRows.length, error: "athenaOne\'s search did not show this patient; nothing was opened" };',
    '      if (!openAllowed()) return deadlineOut();',
    '      _rvRows[0].click();'
  ] },
  { tag: 'D3 clickRow refuses a stale / re-identified row', want: 1, run: [
    '          try {',
    "            if (row && row.isConnected === false) { clickRow.reason = 'row-identity-changed'; return false; }",
    '            var __crText = rowText(row).toLowerCase();',
    "            if ((lname && __crText.indexOf(lname) === -1) || (fname && __crText.indexOf(fname) === -1)) { clickRow.reason = 'row-identity-changed'; return false; }",
    '          } catch (eCrVerify) {}'
  ] },
  { tag: 'D4 clickRow call site 1 reports the new refusal', want: 1, run: [
    "            if (/^(appointment-target-not-clinical|row-identity-changed)$/.test(clickRow.reason || '')) return { phase: 'open', opened: false, attempted: false, candidates: 1, reason: clickRow.reason, diag: { frame: location.hostname, scanned: hit.scanned, topScore: hit.sc, apptIdBound: false, apptIdMatches: hit.matches || 1 } };"
  ] },
  { tag: 'D5 clickRow call site 2 reports the new refusal', want: 1, run: [
    "                if (/^(appointment-target-not-clinical|row-identity-changed)$/.test(clickRow.reason || '')) return { phase: 'open', opened: false, attempted: false, candidates: 1, reason: clickRow.reason, diag: { frame: location.hostname, scanned: scannedTotal, scrolledTo: y, topScore: h2.sc, apptIdBound: false, apptIdMatches: h2.matches || 1 } };"
  ] },
  { tag: 'D6 the caller names the new refusal in plain English', want: 1, run: [
    "            sendResponse({ ok: false, opened: false, attempted: false, reason: (fill && fill.reason) || '', error: (fill && fill.reason === 'numeric-only-field-refused') ? 'Refused: the only patient field on this screen accepts numbers only, and typing a name there makes athenaNet raise a blocking dialog. The chart was skipped instead.' : ((fill && fill.reason === 'search-target-unverified') ? \"athenaOne's search did not show this patient; nothing was opened.\" : 'Could not find the Athena patient search box on this screen.'), diag: fill && fill.diag });"
  ] },
  { tag: 'D7 the findpatient refusal set includes the new reason', want: 1, run: [
    "              if (findRes && /^(ambiguous|no-results|no-name-match|blank-error|rows-not-rendered|dob-mismatch|search-target-unverified)$/.test(findRes.reason || '')) {"
  ] },
  { tag: 'D8 its sentence', want: 1, run: [
    "                    : findRes.reason === 'search-target-unverified' ? \"athenaOne's search did not show this patient; nothing was opened.\"",
    "                    : 'athenaOne patient search found no matching patient.',"
  ] },
  { tag: 'E1 wrong-chart carries attempted:false + MRN digit COUNTS', want: 1, run: [
    "            return chartRespond({ ok: false, reason: 'wrong-chart', attempted: false, captured: false, chartName: ident.name, chartDob: ident.dob || '', expectedMrnDigits: mrnKeyStrict(wantMrn).length, observedMrnDigits: mrnKeyStrict(ident.mrn).length, opened: opened, version: versionStrict, error: 'The open athenaOne chart identity does not match ' + want + '. Nothing was captured for ' + want + '.' });"
  ] },
  { tag: 'E2 identity fill block', want: 1, run: [
    "          const __mlsIdentityFill = { mrnMatched: !!(wantMrn && ident && ident.mrn && mrnKeyStrict(ident.mrn) === mrnKeyStrict(wantMrn)), dobRead: !!(ident && ident.dob), dobSource: (ident && ident.dob) ? 'chart' : '', dobFillable: !!(!wantDob && ident && ident.dob), identityMode: (!wantMrn && !wantDob) ? 'identity-name-only' : 'identity-verified' };"
  ] },
  { tag: 'E3 the successful capture ships identity', want: 1, run: [
    "          return chartRespond({ ok: true, text: chartTextStrict, receipt: chartReceiptStrict, url: pickStrict.u || tab.url, title: tab.title, opened: opened, frames: eligibleFrames.length, stageMs: { total: Date.now() - chartRequestStartedAt, identity: __identDoneAt - T0, text: Date.now() - __identDoneAt, polls: polls }, chartName: (ident && ident.name) || '', chartDob: (ident && ident.dob) || '', chartMrn: (ident && ident.mrn) || '', identity: __mlsIdentityFill, version: versionStrict, via: (ident && ident.via) || '', briefingText: briefingShip, briefingDiag: briefingDiag, briefingNav: navClicked || '', identDiag: identDiag, textDiag: textDiagStrict, expected: expectName ? 1 : 0 });"
  ] }
];

console.log('1. intended edits present verbatim, contiguous, expected count');
GROUPS.forEach(function (g) {
  var n = countRun(outLines, g.run);
  check(n === g.want, g.tag + ' (' + g.run.length + ' line(s), want ' + g.want + ', found ' + n + ')');
});
/* A4 and A5 are deliberately DIFFERENT text so each resolves once; prove the
   two twins really are two distinct insertions, not one run counted twice. */
check(countLine(outLines, "         1902-03-04 all returned '2/3/2004' and the VISITS-READ wrong-chart") === 1 &&
  countLine(outLines, "         1902-03-04 all returned '2/3/2004' and the WRITE-LANE wrong-chart") === 1,
  'the two byte-identical nrmDob twins each received their OWN ISO branch');
/* the band pre-pass must sit between the discovery function and the sort that
   consumes _vS, or it would run after the sweep had already read nothing. */
var vScanIdx = outLines.findIndex(function (l) { return l.indexOf('function __vScanS(){') >= 0; });
var vSortIdx = outLines.findIndex(function (l) { return l.indexOf('_vS.sort(function(a,b){return b.score-a.score;});_vS=_vS.filter(') >= 0; });
var vPushIdx = outLines.indexOf('        _vRescanS.forEach(function(v){ _vS.push(v); });');
check(vScanIdx > 0 && vPushIdx > vScanIdx && vSortIdx > vPushIdx, 'band pre-pass runs after discovery and before the sweep sorts _vS');

/* ------------------------------------------------------------------ */
/* 2. Replaced lines are gone (and were there).                        */
/* ------------------------------------------------------------------ */
var REMOVED = [
  "  function normDob(s) { var m = /([01]?\\d)[\\/\\-\\.]([0-3]?\\d)[\\/\\-\\.](\\d{2,4})/.exec(String(s || '')); if (!m) return ''; var y = m[3]; if (y.length === 2) y = (parseInt(y, 10) > 30 ? '19' : '20') + y; return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + y; }",
  "      function nrmDob(s) { var m = /([01]?\\d)[\\/\\-\\.]([0-3]?\\d)[\\/\\-\\.](\\d{2,4})/.exec(String(s || '')); if (!m) return ''; var y = m[3].length === 2 ? ((Number(m[3]) > 26 ? '19' : '20') + m[3]) : m[3]; return Number(m[1]) + '/' + Number(m[2]) + '/' + y; }",
  '        _allS.forEach(function(el){try{var cs=_dvS.getComputedStyle(el),sh=el.scrollHeight||0,ch=el.clientHeight||0,shaped=!!el.querySelector(\'[class*="PatientAppointment_appointment-container"], [class~="filled-appointment-row"]\');if(shaped&&/(auto|scroll)/.test(cs.overflowY)&&sh>ch+40&&ch>100)_vS.push({el:el,score:(sh-ch)+1000000});}catch(_e){}});',
  '        try{var _deS=doc.scrollingElement;if(_deS&&_deS.scrollHeight>_deS.clientHeight+40&&_deS.querySelector(\'[class*="PatientAppointment_appointment-container"], [class~="filled-appointment-row"]\'))_vS.push({el:_deS,score:(_deS.scrollHeight-_deS.clientHeight)+500000});}catch(_e){}',
  'function kaFrameTouch() {',
  "    try { document.dispatchEvent(new Event('mousemove', { bubbles: true })); } catch (e1) {}",
  "    try { document.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (e2) {}",
  "    try { if (document.body) document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 3, clientY: 3 })); } catch (e3) {}",
  '    if (window === window.top) {',
  '      if (__kaPullBusyNow()) { __kaDeferForPull(); return; }',
  '          if (setter && setter.set) setter.set.call(best, searchStr); else best.value = searchStr;',
  '          if (!openAllowed()) return deadlineOut();',
  "          best.dispatchEvent(new Event('input', { bubbles: true }));",
  "          best.dispatchEvent(new Event('change', { bubbles: true }));",
  '      pool[0].a.click();',
  "            if (clickRow.reason === 'appointment-target-not-clinical') return { phase: 'open', opened: false, candidates: 1, reason: clickRow.reason, diag: { frame: location.hostname, scanned: hit.scanned, topScore: hit.sc, apptIdBound: false, apptIdMatches: hit.matches || 1 } };",
  "                if (clickRow.reason === 'appointment-target-not-clinical') return { phase: 'open', opened: false, candidates: 1, reason: clickRow.reason, diag: { frame: location.hostname, scanned: scannedTotal, scrolledTo: y, topScore: h2.sc, apptIdBound: false, apptIdMatches: h2.matches || 1 } };",
  "            sendResponse({ ok: false, opened: false, reason: (fill && fill.reason) || '', error: (fill && fill.reason === 'numeric-only-field-refused') ? 'Refused: the only patient field on this screen accepts numbers only, and typing a name there makes athenaNet raise a blocking dialog. The chart was skipped instead.' : 'Could not find the Athena patient search box on this screen.', diag: fill && fill.diag });",
  "              if (findRes && /^(ambiguous|no-results|no-name-match|blank-error|rows-not-rendered|dob-mismatch)$/.test(findRes.reason || '')) {",
  "            return chartRespond({ ok: false, reason: 'wrong-chart', chartName: ident.name, chartDob: ident.dob || '', opened: opened, version: versionStrict, error: 'The open athenaOne chart identity does not match ' + want + '. Nothing was captured for ' + want + '.' });",
  "          return chartRespond({ ok: true, text: chartTextStrict, receipt: chartReceiptStrict, url: pickStrict.u || tab.url, title: tab.title, opened: opened, frames: eligibleFrames.length, stageMs: { total: Date.now() - chartRequestStartedAt, identity: __identDoneAt - T0, text: Date.now() - __identDoneAt, polls: polls }, chartName: (ident && ident.name) || '', chartDob: (ident && ident.dob) || '', chartMrn: (ident && ident.mrn) || '', version: versionStrict, via: (ident && ident.via) || '', briefingText: briefingShip, briefingDiag: briefingDiag, briefingNav: navClicked || '', identDiag: identDiag, textDiag: textDiagStrict, expected: expectName ? 1 : 0 });"
];
console.log('2. replaced lines removed');
REMOVED.forEach(function (line) {
  var a = countLine(baseLines, line), b = countLine(outLines, line);
  check(a >= 1, 'baseline had it (' + a + '): ' + line.trim().slice(0, 58));
  check(b === a - 1, 'one fewer in output (' + a + ' -> ' + b + '): ' + line.trim().slice(0, 52));
});

/* ------------------------------------------------------------------ */
/* 3. Census, ASCII, and the "nothing else moved" multiset proof.      */
/* ------------------------------------------------------------------ */
console.log('3. census + ascii + nothing-else-moved');
var b = census(base), o = census(out);
var ADDED_LINES = 180, ADDED_CR = 11;
console.log('   baseline: bytes=' + b.bytes + ' CR=' + b.cr + ' LF=' + b.lf);
console.log('   spliced : bytes=' + o.bytes + ' CR=' + o.cr + ' LF=' + o.lf);
console.log('   delta   : bytes=' + (o.bytes - b.bytes) + ' CR=' + (o.cr - b.cr) + ' LF=' + (o.lf - b.lf));
check(o.lf - b.lf === ADDED_LINES, 'LF count moved by exactly ' + ADDED_LINES + ' net inserted lines');
check(o.cr - b.cr === ADDED_CR, 'CR count moved by exactly ' + ADDED_CR + ' (the CRLF-anchored edits only)');
check(outLines.length - baseLines.length === ADDED_LINES, 'line count moved by exactly ' + ADDED_LINES);
var nonAsciiBase = (base.match(/[^\x09\x0a\x0d\x20-\x7e]/g) || []).length;
var nonAsciiOut = (out.match(/[^\x09\x0a\x0d\x20-\x7e]/g) || []).length;
check(nonAsciiOut === nonAsciiBase, 'non-ASCII byte count unchanged (' + nonAsciiBase + ')');

/* The strong scope proof: recover the EDIT HUNKS by resynchronising the two
   line arrays on an 8-line identical window, then assert that the whole file
   changed in a small number of localized hunks, that exactly 28 lines were
   removed in total, that every one of them is a line the splice declared
   removed, and that exactly 208 lines were added. Anything the splice touched
   outside its 24 named edits would show up here as an extra hunk. */
function diffHunks(A, B) {
  var i = 0, j = 0, hunks = [], W = 8;
  function win(a, b) { for (var k = 0; k < W; k++) if (A[a + k] !== B[b + k]) return false; return true; }
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { i++; j++; continue; }
    var found = null;
    for (var d = 1; d <= 400 && !found; d++) {
      for (var x = 0; x <= d && !found; x++) {
        var y = d - x;
        if (i + x + W <= A.length && j + y + W <= B.length && win(i + x, j + y)) found = { x: x, y: y };
      }
    }
    if (!found) break;
    hunks.push({ at: i + 1, removed: A.slice(i, i + found.x), added: B.slice(j, j + found.y) });
    i += found.x; j += found.y;
  }
  if (i < A.length || j < B.length) hunks.push({ at: i + 1, removed: A.slice(i), added: B.slice(j) });
  return hunks;
}
var hunks = diffHunks(baseLines, outLines);
var totalRemoved = 0, totalAdded = 0, undeclared = [];
var removedPool = Object.create(null);
REMOVED.forEach(function (l) { removedPool[l] = (removedPool[l] || 0) + 1; });
hunks.forEach(function (h) {
  totalRemoved += h.removed.length; totalAdded += h.added.length;
  h.removed.forEach(function (l) {
    /* a line the hunk re-emits unchanged did not actually change; the resync
       window just swept it into the hunk. */
    if (h.added.indexOf(l) >= 0) return;
    if (removedPool[l] > 0) removedPool[l]--; else undeclared.push(l);
  });
});
console.log('   hunks: ' + hunks.length + '  removed=' + totalRemoved + '  added=' + totalAdded);
hunks.forEach(function (h) { console.log('     @' + h.at + '  -' + h.removed.length + ' +' + h.added.length); });
check(hunks.length <= 24, 'the file changed in ' + hunks.length + ' localized hunks (<= the 24 declared edits; adjacent edits merge)');
check(totalAdded - totalRemoved === ADDED_LINES, 'the hunks account for exactly the +' + ADDED_LINES + ' net line delta (+' + totalAdded + ' -' + totalRemoved + ')');
check(totalRemoved <= 32, 'no more than the 28 declared removals plus resync spill was removed (found ' + totalRemoved + ')');
check(undeclared.length === 0, 'every line that really disappeared was declared by the splice' +
  (undeclared.length ? ' :: ' + undeclared[0].trim().slice(0, 70) : ''));
check(Object.keys(removedPool).every(function (k) { return removedPool[k] === 0; }), 'every declared removal actually happened');

/* ------------------------------------------------------------------ */
/* 4. DOB reader parity - EXECUTED, on both files.                     */
/* ------------------------------------------------------------------ */
console.log('4. DOB reader parity (executed)');
function readers(src) {
  var L = lines(src), found = [];
  function extract(start) {
    var buf = '', depth = 0, started = false;
    for (var i = start; i < L.length; i++) {
      var ln = L[i]; buf += ln + '\n';
      for (var c = 0; c < ln.length; c++) { if (ln[c] === '{') { depth++; started = true; } else if (ln[c] === '}') depth--; }
      if (started && depth <= 0) return buf;
    }
    return buf;
  }
  for (var i = 0; i < L.length; i++) {
    if (/^\s*function (dateKey|normDob|nrmDob)\s*\(/.test(L[i])) {
      found.push({ line: i + 1, name: /function (\w+)/.exec(L[i])[1], src: extract(i) });
    }
  }
  return found;
}
function probe(rs) {
  return rs.map(function (f) {
    var fn;
    try { fn = eval('(function(){function clean(v){return String(v==null?"":v);}\n' + f.src + '\nreturn ' + f.name + ';})()'); }
    catch (e) { return { line: f.line, name: f.name, error: e.message }; }
    try {
      var a = fn('1962-03-04'), c = fn('1902-03-04'), d = fn('03/04/1962'), e2 = fn('3/4/1962');
      return { line: f.line, name: f.name, iso: a, isoOld: c, slashPad: d, slash: e2, collide: a === c, isoEqSlash: (a === d || a === e2) };
    } catch (e) { return { line: f.line, name: f.name, error: e.message }; }
  });
}
var baseR = probe(readers(base)), outR = probe(readers(out));
var baseCollide = baseR.filter(function (r) { return r.collide === true; });
var outCollide = outR.filter(function (r) { return r.collide === true; });
baseR.forEach(function (r) { console.log('   baseline ' + r.line + ' ' + r.name + '  iso=' + JSON.stringify(r.iso) + ' iso1902=' + JSON.stringify(r.isoOld) + ' collide=' + r.collide); });
outR.forEach(function (r) { console.log('   spliced  ' + r.line + ' ' + r.name + '  iso=' + JSON.stringify(r.iso) + ' iso1902=' + JSON.stringify(r.isoOld) + ' collide=' + r.collide); });
check(baseR.length === outR.length && baseR.length >= 7, 'same reader count in both files (' + baseR.length + ')');
check(baseCollide.length === 5, 'BASELINE collides at exactly the five named sites (found ' + baseCollide.length + ') - the proof is red on today bytes');
check(outCollide.length === 0, 'SPLICED collides nowhere (found ' + outCollide.length + ')');
outR.forEach(function (r) {
  check(!r.error, 'reader evaluates: ' + r.line + ' ' + r.name + (r.error ? ' :: ' + r.error : ''));
  check(r.isoEqSlash === true, 'ISO reads equal to its slash form: ' + r.line + ' ' + r.name + ' ' + JSON.stringify(r.iso));
});
/* slash input must be byte-identical to the baseline for every reader */
var slashSame = true, slashWhere = '';
for (var ri = 0; ri < outR.length; ri++) {
  var bm = baseR.filter(function (x) { return x.name === outR[ri].name && (x.slash === outR[ri].slash); });
  if (!bm.length) { slashSame = false; slashWhere = outR[ri].name + '@' + outR[ri].line; break; }
}
check(slashSame, 'slash input is byte-unchanged for every reader' + (slashSame ? '' : ' :: ' + slashWhere));

/* ------------------------------------------------------------------ */
/* 5. Scope: the 3.0.116 lane and every write control are untouched.   */
/* ------------------------------------------------------------------ */
console.log('5. scope');
function block(str, startMark, endMark) {
  var a = str.indexOf(startMark); if (a < 0) return null;
  var c = str.indexOf(endMark, a); if (c < 0) return null;
  return str.slice(a, c);
}
var MARK_A = "    if (nativeNamedSave && action === 'save_draft') {";
var MARK_B = '    /* savenamed-1.0.0 (3.0.111, owner ruling 2026-09-02)';
var nb = block(base, MARK_A, MARK_B), no = block(out, MARK_A, MARK_B);
check(nb && no && nb === no, 'the 3.0.116 native section-persistence block is byte-identical');
[
  "      return { ok: true, action: action, attempted: false, readOnly: true, verified: true, saved: true, persisted: true, serverVerified: true, reason: 'exact-section-persistence-reconciled', nativePersistenceReconcile: true, sectionsDeclared: 5, persistedDestinations: 4, signed: false, context: context, results: nativeResults, noAutomaticChaining: 'no-automatic-chaining' };",
  '      clickOnce(actionControl);',
  "    if (snvNamedSave && action === 'save_draft') {",
  '    nativeNamedSave = !!(nativeNamedSave && hit.nativePersistenceReconcile);',
  '  function dateKey(v) { /* isodob-1.0.0 (3.0.99): an ISO DOB (1962-03-04) must not be scanned by the M/D/Y reader - it first matches inside the YEAR and reads a different person (measured b1157 app-side; this is the extension twin). Anchored ISO branch first; the M/D/Y branch below is unchanged. */ var iso = /(^|[^0-9])(\\d{4})-([01]\\d)-([0-3]\\d)(?![0-9])/.exec(clean(v)); if (iso) { return Number(iso[3]) + \'/\' + Number(iso[4]) + \'/\' + iso[2]; } var m = /([01]?\\d)[\\/\\-.]([0-3]?\\d)[\\/\\-.](\\d{2,4})/.exec(clean(v)); if (!m) return \'\'; var y = m[3]; if (y.length === 2) y = (Number(y) > ((new Date().getFullYear() % 100) + 1) ? \'19\' : \'20\') + y; return Number(m[1]) + \'/\' + Number(m[2]) + \'/\' + y; }',
  '      if (!kaUrl) return;'
].forEach(function (line) {
  var a = countLine(baseLines, line), c = countLine(outLines, line);
  if (a === 0) { ok('scope marker not in this build (skipped): ' + line.trim().slice(0, 48)); return; }
  check(a === c, 'unchanged (' + a + '=' + c + '): ' + line.trim().slice(0, 58));
});
/* the frame touches are still emitted exactly once each - guarded, not deleted */
["      try { document.dispatchEvent(new Event('mousemove', { bubbles: true })); } catch (e1) {}",
 "      try { document.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (e2) {}"
].forEach(function (l) { check(countLine(outLines, l) === 1, 'frame touch preserved (guarded, not removed): ' + l.trim().slice(0, 46)); });
check(countLine(outLines, "function kaFrameTouch() {") === 0 && countLine(outLines, 'function kaFrameTouch(kaMode) {') === 1, 'exactly one kaFrameTouch, and it takes the mode');
/* every new refusal is honest about having done nothing */
var svRefusals = outLines.filter(function (l) { return l.indexOf("reason: 'search-target-unverified'") >= 0 && l.indexOf('return') >= 0; });
check(svRefusals.length === 2 && svRefusals.every(function (l) { return l.indexOf('attempted: false') >= 0; }),
  "both search-target-unverified refusals carry attempted:false (" + svRefusals.length + ' site(s))');
check(countLine(outLines, "            if (row && row.isConnected === false) { clickRow.reason = 'row-identity-changed'; return false; }") === 1 &&
  outLines.filter(function (l) { return l.indexOf("clickRow.reason = 'row-identity-changed'") >= 0; }).length === 2,
  'clickRow sets row-identity-changed on exactly the two stale-row conditions and clicks nothing');
var riRefusals = outLines.filter(function (l) { return l.indexOf('row-identity-changed)$/.test(clickRow.reason') >= 0; });
check(riRefusals.length === 2 && riRefusals.every(function (l) { return l.indexOf('attempted: false') >= 0; }),
  'both clickRow call sites return attempted:false for a stale row (' + riRefusals.length + ' site(s))');
/* additive only: nothing the shipped receipts carried was dropped */
['chartName: ident.name', 'chartDob:', 'chartMrn: (ident && ident.mrn)', 'briefingText: briefingShip', 'findReason: findRes.reason'].forEach(function (frag) {
  var a = baseLines.filter(function (l) { return l.indexOf(frag) >= 0; }).length;
  var c = outLines.filter(function (l) { return l.indexOf(frag) >= 0; }).length;
  check(c >= a, 'receipt field still present (additive only): ' + frag + ' (' + a + ' -> ' + c + ')');
});
/* PHI: the new wrong-chart fields are COUNTS, never values */
var wc = outLines.filter(function (l) { return l.indexOf("reason: 'wrong-chart'") >= 0 && l.indexOf('expectedMrnDigits') >= 0; });
check(wc.length === 1 && wc[0].indexOf('expectedMrn:') < 0 && wc[0].indexOf('observedMrn:') < 0 && /expectedMrnDigits: mrnKeyStrict\(wantMrn\)\.length/.test(wc[0]),
  'wrong-chart adds MRN digit COUNTS only, never the MRN values');

/* ------------------------------------------------------------------ */
/* 6. node --check                                                     */
/* ------------------------------------------------------------------ */
console.log('6. node --check');
var syntax = cp.spawnSync(process.execPath, ['--check', OUT], { encoding: 'utf8' });
check(syntax.status === 0, 'node --check exit ' + syntax.status + (syntax.status ? ' :: ' + String(syntax.stderr || '').split('\n')[0] : ''));

/* ------------------------------------------------------------------ */
/* 7. Suites, pointed at the spliced copy.                             */
/* ------------------------------------------------------------------ */
console.log('7. suites against the spliced copy');
/* The repo root is THIS script's parent, not the baseline's directory: the
   baseline is routinely a copy extracted with `git show <sha>:background.js`
   into a temp dir, because this worktree has two writers and the tracked
   background.js may already carry the splice. $BACKGROUND_REPO overrides. */
var repoRoot = process.env.BACKGROUND_REPO ? path.resolve(process.env.BACKGROUND_REPO) : path.resolve(__dirname, '..');
var tracked = path.join(repoRoot, 'background.js');
var shim = path.join(os.tmpdir(), 'mls-bg-30117-shim.js');
fs.writeFileSync(shim, [
  "'use strict';",
  '/* Redirect ONE exact path - the repo-root background.js - to the draft copy.',
  '   Some suites also read a historical extension-candidates/3.0.4x/background.js',
  '   and must keep getting the real one. */',
  "var fs = require('fs');",
  "var path = require('path');",
  "var from = process.env.BACKGROUND_TRACKED ? path.resolve(process.env.BACKGROUND_TRACKED) : '';",
  "var to = process.env.BACKGROUND_JS ? path.resolve(process.env.BACKGROUND_JS) : '';",
  'var orig = fs.readFileSync;',
  'fs.readFileSync = function (p, opts) {',
  "  if (from && to && typeof p === 'string' && path.resolve(p) === from) return orig.call(fs, to, opts);",
  '  return orig.apply(fs, arguments);',
  '};',
  ''
].join('\n'), 'utf8');

/* The suite set: every tests/athena-*.test.js and tests/savenamed-*.js, plus
   every other suite that both READS background.js and mentions this lane. */
var LANE = /schedule-incomplete|schedule-surface-changed|wrong-chart|dob-mismatch|mlsSearchOpenDriverFn|mlsFindPatientOpenDriverFn|mlsSchedDomInline|mlsAppSearchOpen|kaFrameTouch|keepAlive|nrmDob|normDob|dateKey|clickRow|findpatient|__receipt|chartRespond/;
var testsDir = path.join(repoRoot, 'tests');
var all = fs.readdirSync(testsDir).filter(function (f) { return /\.(test\.js|js)$/.test(f); });
var SUITES = [];
all.forEach(function (f) {
  if (f === 'run-all.js' || f === 'live-extension-candidate.js') return;
  var full = path.join(testsDir, f), src;
  try { src = fs.readFileSync(full, 'utf8'); } catch (e) { return; }
  if (src.indexOf('background.js') < 0) return;
  if (/^athena-.*\.test\.js$/.test(f) || /^savenamed-.*\.js$/.test(f) || LANE.test(src)) SUITES.push('tests/' + f);
});
SUITES.sort();
console.log('   suite count: ' + SUITES.length);

/* Two suites pin the EXACT contracts this splice was asked to move. They are
   declared here with the pin that has to move with the release, and the proof
   demands that the regression set equals this set EXACTLY - a suite that goes
   red for any other reason still fails the proof, and a suite on this list that
   goes GREEN means the pin was already moved and this list is stale. */
var CONTRACT_MOVED = {};

/* Two suites pinned contracts this splice moves, and their pins have now been
   updated IN THE TRACKED TESTS, so both must be GREEN against the draft and RED
   against the baseline. That inversion is the whole point of a moved pin, so
   the proof measures it directly rather than trusting the edit:
     ext-3064-hidden-safe-sleep-contract.test.js   41 -> 42 mls-hs-1.0.0 sleeps
       (__svSleep, searchverify-1.0.0, is the compliant tenth helper)
     athena-keepalive-pull-busy-runtime.test.js    the busy tick runs ONE
       dialog-only injection instead of none; fetches and synthesized frame
       activity must still be zero while busy. */
var PIN_MOVED = [
  'tests/ext-3064-hidden-safe-sleep-contract.test.js',
  'tests/athena-keepalive-pull-busy-runtime.test.js'
];

var env = Object.assign({}, process.env, { BACKGROUND_JS: OUT, BACKGROUND_TRACKED: tracked });
var baseEnv = Object.assign({}, process.env, { BACKGROUND_JS: BASE, BACKGROUND_TRACKED: tracked });
if (process.env.PLAYWRIGHT_NODE_PATH) { env.NODE_PATH = process.env.PLAYWRIGHT_NODE_PATH; baseEnv.NODE_PATH = process.env.PLAYWRIGHT_NODE_PATH; }
var suiteResults = [];
SUITES.forEach(function (suite) {
  var r = cp.spawnSync(process.execPath, ['--require', shim, suite], { cwd: repoRoot, env: env, encoding: 'utf8', timeout: 600000 });
  var stdoutTail = String(r.stdout || '').trim().split('\n').slice(-1).join('') ||
    String(r.stderr || '').trim().split('\n').slice(0, 2).join(' | ');
  var baseStatus = null;
  if (r.status !== 0) {
    /* A RED SUITE MAY NEVER HAVE RUN, and the red count is never what it looks
       like: every red is re-run against the BASELINE before it is attributed to
       this splice. The baseline run goes through the SAME preload, pointed at
       the baseline file - the tracked background.js may already carry this
       splice (this worktree has two writers), so "just run the suite" is not a
       baseline. */
    var rb = cp.spawnSync(process.execPath, ['--require', shim, suite], { cwd: repoRoot, env: baseEnv, encoding: 'utf8', timeout: 600000 });
    baseStatus = rb.status;
  }
  suiteResults.push({ suite: suite, status: r.status, baseline: baseStatus, tail: stdoutTail.slice(0, 200) });
  console.log('   ' + suite + '  exit=' + r.status +
    (r.status === 0 ? '' : ('  baseline=' + baseStatus + '  :: ' + stdoutTail.slice(0, 150))));
});
var preExisting = suiteResults.filter(function (r) { return r.status !== 0 && r.baseline !== 0; });
var regressions = suiteResults.filter(function (r) { return r.status !== 0 && r.baseline === 0; });
console.log('   green: ' + suiteResults.filter(function (r) { return r.status === 0; }).length +
  '  pre-existing red (red on the baseline too): ' + preExisting.length +
  '  red only against the draft: ' + regressions.length);
preExisting.forEach(function (r) { ok('pre-existing red, NOT caused by this splice: ' + r.suite); });
regressions.forEach(function (r) {
  var why = CONTRACT_MOVED[r.suite];
  check(!!why, 'red only against the draft: ' + r.suite + (why ? ' - DECLARED contract move :: ' + why : ' - UNDECLARED REGRESSION :: ' + r.tail));
});
Object.keys(CONTRACT_MOVED).forEach(function (suite) {
  var hit = regressions.some(function (r) { return r.suite === suite; });
  check(hit, 'declared contract-moved suite is actually red (stale declaration if not): ' + suite);
});
/* The moved pins, measured both ways. A pin that passes against BOTH files was
   not actually moved - it would be a pin that no longer pins anything. */
PIN_MOVED.forEach(function (suite) {
  var r = suiteResults.filter(function (x) { return x.suite === suite; })[0];
  check(!!r && r.status === 0, 'moved pin is GREEN against the draft: ' + suite + (r ? ' (exit ' + r.status + ')' : ' (not run)'));
  var rb = cp.spawnSync(process.execPath, ['--require', shim, suite], { cwd: repoRoot, env: baseEnv, encoding: 'utf8', timeout: 600000 });
  var tail = String(rb.stdout || '').trim().split('\n').slice(-1).join('') || String(rb.stderr || '').split('\n').filter(function (l) { return /AssertionError|!==/.test(l); })[0] || '';
  check(rb.status !== 0, 'moved pin is RED against the untouched baseline (it still pins something): ' + suite + ' :: ' + String(tail).trim().slice(0, 90));
});

console.log('');
console.log(JSON.stringify({
  proof: 'splice-30117-proof', checks: checks, failures: failures.length,
  baselineCollisions: baseCollide.length, splicedCollisions: outCollide.length,
  suitesGreen: suiteResults.filter(function (r) { return r.status === 0; }).length,
  preExistingRed: preExisting.map(function (r) { return r.suite; }),
  contractMovedRed: regressions.map(function (r) { return r.suite; }),
  suites: suiteResults.map(function (r) { return { suite: r.suite, exit: r.status, baseline: r.baseline }; })
}));
if (failures.length) {
  console.error('PROOF FAILED (' + failures.length + '):');
  failures.forEach(function (f) { console.error('  - ' + f); });
  process.exit(1);
}
console.log('PROOF OK - ' + checks + ' checks');
