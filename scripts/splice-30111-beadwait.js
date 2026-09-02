/* splice-30111-beadwait.js - ext 3.0.111 beadwait-1.0.0.
 *
 * THE MEASURED DEFECT (live, 2026-09-02 16:26, ext 3.0.110). The app opened
 * the encounter through the appointment row at 16:26:33; thirteen seconds
 * later every one of the six named-section probes refused 0.4 s apart with
 * note-section-not-on-surface and hetDiag { qualified:true, rank:6,
 * noteTargetFound:false, stageNav: no-bead } - yet at 16:26:55 that SAME frame
 * carried six visible li.nav-bead elements (Review, HPI, ROS, PE, A/P,
 * Sign-off), and a re-check at 16:29 wrote HPI, ROS, PE and the combined A&P.
 * So the encounter frame binds - its machine-typed stage context is already
 * there - BEFORE athenaOne paints the stage-tab strip, and sn-1.0.0
 * (background.js ~1306-1333) looked exactly once and gave up.
 *
 * WHAT THIS CHANGE IS. ONE bounded wait, twice: (1) the strip lookup becomes a
 * bounded poll - the same deepQueryAll, the same exact-label match, the same
 * visible() test, re-run up to 15 times 800 ms apart (the last look lands at
 * 11.2 s, inside a 12 s ceiling), stopping at the first look that finds a
 * visible bead; (2) the flat 1600 ms sleep after the one stage-tab click
 * becomes a bounded poll on the SHIPPED read-only findNamedNoteAction every
 * 400 ms, after a minimum first 400 ms sleep, up to an 8000 ms ceiling. Both
 * use the driver's own hidden-safe sleep (~212), so a backgrounded tab does
 * not freeze the wait.
 *
 * WHAT THIS CHANGE IS NOT. It grants NOTHING. The stage-tab whitelist, the
 * machine-bound stage-context requirement, the forbidden-control ban, the
 * at-most-one-click rule and every refusal code are untouched: no-bead is
 * still the answer when the strip never paints, already-open, forbidden-control
 * and click-failed are unchanged, and an editor that never resolves still
 * falls through to the unchanged candidate loop, which re-derives and refuses
 * honestly. An exception inside a look counts as NOT FOUND for that look and
 * never escapes the block. Nothing is clicked twice.
 *
 * TWO edits, background.js only. Both are line REPLACEMENTS inside the
 * sn-1.0.0 block; every other byte of the file is identical.
 *
 * LINE ENDINGS - READ THIS BEFORE COPYING THIS SCRIPT. background.js is NOT a
 * uniform CRLF file: it mixes CRLF and bare-LF terminators. So each edit here
 * detects the terminator of ITS OWN anchor span and joins the replacement
 * lines with that, and refuses a span whose lines are not uniformly
 * terminated. Everything else keeps the proven shape: latin1 in, exact
 * full-line anchors, exact occurrence count (abort otherwise), ASCII-only
 * insert, latin1 out, print what it did, node --check at the end.
 *
 * ANCHOR FACTS, COUNTED IN THE WORKTREE COPY BEFORE THIS SCRIPT WAS WRITTEN:
 *   - the single no-bead refusal line occurs exactly ONCE;
 *   - `await sleep(1600);` occurs TWICE in the file, so the second edit is
 *     anchored on the TWO-LINE PAIR (the opened- receipt line + that sleep),
 *     which occurs exactly ONCE.
 *
 * IDEMPOTENCE: refuses to run twice - aborts if the beadwait-1.0.0 marker is
 * already present.
 *
 * This script applies ON TOP OF scripts/splice-30111-savenamed.js; it touches
 * no line that script declares.
 *
 * DO NOT RUN AS PART OF A RELEASE - the coordinator releases the extension.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var child = require('child_process');

var LF = String.fromCharCode(10);
var CR = String.fromCharCode(13);

/* Split into lines that KEEP their own terminator, so a mixed-EOL file
   round-trips byte-for-byte through join(''). */
function splitKeepEol(s) {
  var out = [], start = 0, i;
  for (i = 0; i < s.length; i++) {
    if (s.charAt(i) === LF) { out.push(s.slice(start, i + 1)); start = i + 1; }
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}
function bodyOf(line) {
  var b = line;
  if (b.charAt(b.length - 1) === LF) b = b.slice(0, -1);
  if (b.charAt(b.length - 1) === CR) b = b.slice(0, -1);
  return b;
}
function eolOf(line) {
  if (line.charAt(line.length - 1) !== LF) return '';
  return (line.charAt(line.length - 2) === CR) ? (CR + LF) : LF;
}

/* Every edit here is a REPLACEMENT of a consecutive run of whole lines. `find`
   is the exact array of line BODIES to be replaced; `n` is how many times that
   run must occur in the file (anything else aborts). The replacement lines are
   joined with the terminator the matched run itself carries, which is required
   to be uniform across the run - so a span that straddles the file's CRLF/LF
   seam is refused rather than silently normalised. */
function splice(file, marker, edits) {
  var s = fs.readFileSync(file, 'latin1');
  if (s.indexOf(marker) >= 0) {
    console.error('ABORT ' + file + ': marker ' + marker + ' is already present - this splice has already run');
    process.exit(1);
  }
  var lines = splitKeepEol(s);
  edits.forEach(function (e, i) {
    var joined = e.lines.join(LF);
    if (/[^\x00-\x7f]/.test(joined)) { console.error('ABORT ' + file + ' edit ' + i + ': non-ASCII insert'); process.exit(1); }
    if (!Array.isArray(e.find) || !e.find.length) { console.error('ABORT ' + file + ' edit ' + i + ': anchor is not a non-empty line array'); process.exit(1); }
    var f;
    for (f = 0; f < e.find.length; f++) {
      if (/[\r\n]/.test(e.find[f])) { console.error('ABORT ' + file + ' edit ' + i + ': anchor line ' + f + ' carries a terminator'); process.exit(1); }
    }
    var at = -1, n = 0, j, k, hit;
    for (j = 0; j + e.find.length <= lines.length; j++) {
      hit = true;
      for (k = 0; k < e.find.length; k++) { if (bodyOf(lines[j + k]) !== e.find[k]) { hit = false; break; } }
      if (hit) { n++; at = j; }
    }
    if (n !== e.n) { console.error('ABORT ' + file + ' edit ' + i + ': hits=' + n + ' expected ' + e.n + ' for: ' + e.find[0].slice(0, 90)); process.exit(1); }
    var eol = eolOf(lines[at]);
    if (!eol) { console.error('ABORT ' + file + ' edit ' + i + ': the anchor span is not newline-terminated'); process.exit(1); }
    for (k = 0; k < e.find.length; k++) {
      if (eolOf(lines[at + k]) !== eol) { console.error('ABORT ' + file + ' edit ' + i + ': the anchor span mixes CRLF and LF'); process.exit(1); }
    }
    var replacement = e.lines.map(function (t) { return t + eol; });
    lines.splice.apply(lines, [at, e.find.length].concat(replacement));
    console.log('  edit ' + i + ': replace line ' + (at + 1) + '-' + (at + e.find.length) + ' (' + (eol === LF ? 'LF' : 'CRLF') + '), -' + e.find.length + ' +' + e.lines.length + ' lines');
  });
  fs.writeFileSync(file, lines.join(''), 'latin1');
  console.log('OK ' + file + ' (' + edits.length + ' edits)');
}

var EDITS = [
  /* 0. THE BEAD WAIT. The one shipped line that decided, on a single look,
        that athenaOne had no stage-tab strip. It becomes a bounded poll that
        asks the SAME question again; the refusal it ends with is the shipped
        refusal, unchanged. */
  {
    n: 1,
    find: [
      "            if (!snBead || !visible(snBead, snFr.w)) { hetDiag.stageNav = 'no-bead'; break; }"
    ],
    lines: [
      "            /* beadwait-1.0.0 (3.0.111) - THE BEAD WAIT.",
      "               MEASURED LIVE 2026-09-02 16:26 (ext 3.0.110): the app opened",
      "               the encounter through the appointment row at 16:26:33 and",
      "               13 s later all six named-section probes refused 0.4 s apart",
      "               with note-section-not-on-surface and hetDiag qualified:true,",
      "               rank:6, noteTargetFound:false, stageNav no-bead - yet at",
      "               16:26:55 the SAME frame carried six visible li.nav-bead",
      "               elements (Review, HPI, ROS, PE, A/P, Sign-off), and a",
      "               re-check at 16:29 wrote HPI, ROS, PE and the combined A&P.",
      "               The encounter frame therefore BINDS - its machine-typed",
      "               stage context is already present, which is what let the",
      "               probe get this far - BEFORE athenaOne paints the stage-tab",
      "               strip, and the shipped line looked exactly once.",
      "               THIS IS A WAIT, NOT A PERMISSION. The same deepQueryAll, the",
      "               same exact-label equality and the same visible() test are",
      "               re-run, up to 15 looks 800 ms apart - the last look lands at",
      "               11.2 s, inside a 12 s ceiling - stopping at the FIRST look",
      "               that finds a visible bead. The whitelist above, the",
      "               machine-bound stage context above and every gate below are",
      "               untouched, nothing is clicked here, and an exception inside",
      "               a look counts as NOT FOUND for that look and never escapes",
      "               the block. If the strip never paints, the refusal on the",
      "               last line of this span is the shipped one, byte for byte,",
      "               and the unchanged candidate loop below still answers.",
      "               The two receipts are diagnostics only - nothing reads them",
      "               to decide anything - so the next live measurement can tell",
      "               a strip that never painted from one that painted late. */",
      "            var snWaitAt = Date.now(), snLooks = 1;",
      "            var snBeadVisible = function (b) { try { return !!(b && visible(b, snFr.w)); } catch (eSnV) { return false; } };",
      "            var snLookForBead = function () {",
      "              var got = [], found = null, snk;",
      "              try {",
      "                got = deepQueryAll(snFr.doc, 'li.nav-bead');",
      "                for (snk = 0; snk < got.length; snk++) { if (text(got[snk].textContent) === snWant) { found = found || got[snk]; } }",
      "              } catch (eSnL) { found = null; }",
      "              return snBeadVisible(found) ? found : null;",
      "            };",
      "            if (!snBeadVisible(snBead)) snBead = null;",
      "            while (!snBead && snLooks < 15) {",
      "              await sleep(800);",
      "              snLooks++;",
      "              snBead = snLookForBead();",
      "            }",
      "            hetDiag.stageNavWaitMs = Math.max(0, Math.round(Date.now() - snWaitAt));",
      "            hetDiag.stageNavLooks = snLooks;",
      "            if (!snBead) { hetDiag.stageNav = 'no-bead'; break; }"
    ]
  },
  /* 1. THE EDITOR WAIT. The flat sleep after the ONE stage-tab click. Anchored
        on the TWO-LINE PAIR because `await sleep(1600);` occurs twice in the
        file; the pair occurs once. The receipt line is carried through this
        replacement verbatim. */
  {
    n: 1,
    find: [
      "            hetDiag.stageNav = 'opened-' + snWant;",
      "            await sleep(1600);"
    ],
    lines: [
      "            /* beadwait-1.0.0 (3.0.111) - THE EDITOR WAIT.",
      "               sn-1.0.0 slept a flat 1600 ms after opening the stage tab and",
      "               then let the candidate loop re-derive. On the surface",
      "               measured above, the strip and the section editor under it",
      "               can paint later than that, and the loop's honest answer for",
      "               a section whose editor has not painted yet is the same",
      "               note-section-not-on-surface refusal the doctor saw.",
      "               The fixed sleep becomes the SAME question asked repeatedly:",
      "               the shipped, read-only findNamedNoteAction, every 400 ms,",
      "               after a minimum first 400 ms sleep, up to an 8000 ms ceiling",
      "               (20 looks), stopping at the first truthy answer.",
      "               IT CLICKS NOTHING. The one stage-tab click already happened",
      "               on the line above and cannot happen twice - there is no",
      "               click in this span at all. If the editor never resolves, the",
      "               block falls through exactly as it did before, and the",
      "               unchanged candidate loop below re-derives and refuses",
      "               honestly. The receipts are diagnostics only. */",
      "            hetDiag.stageNav = 'opened-' + snWant;",
      "            var snEdAt = Date.now(), snEdLooks = 0, snEdOk = false;",
      "            while (snEdLooks < 20) {",
      "              await sleep(400);",
      "              snEdLooks++;",
      "              try { snEdOk = !!findNamedNoteAction(snFr, action, requestedNoteSection); } catch (eSnEd) { snEdOk = false; }",
      "              if (snEdOk) break;",
      "            }",
      "            hetDiag.stageNavEditorMs = Math.max(0, Math.round(Date.now() - snEdAt));",
      "            hetDiag.stageNavEditorLooks = snEdLooks;",
      "            hetDiag.stageNavEditor = snEdOk ? 'ready' : 'not-ready';"
    ]
  }
];

/* Running this file splices. REQUIRING it only hands over the declared edits,
   so tests/beadwait-splice-proof.js can rebuild the pre-splice file from a
   background.js that already carries this change and prove the shipped bytes
   are exactly what this script produces. Nothing is written on require. */
if (require.main === module) {
  splice('background.js', 'beadwait-1.0.0', EDITS);
  var checked = child.spawnSync(process.execPath, ['--check', path.resolve('background.js')], { encoding: 'utf8' });
  if (checked.status !== 0) {
    console.error('ABORT background.js: node --check failed AFTER the splice');
    console.error(String(checked.stderr || ''));
    process.exit(1);
  }
  console.log('  node --check background.js OK');
  console.log('SPLICE 3.0.111 beadwait-1.0.0 DONE');
} else {
  module.exports = { MARKER: 'beadwait-1.0.0', TARGET: 'background.js', EDITS: EDITS, splitKeepEol: splitKeepEol, bodyOf: bodyOf, eolOf: eolOf };
}
