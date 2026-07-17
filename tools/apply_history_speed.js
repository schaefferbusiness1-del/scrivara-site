/* v2.9.32 history-pull speed: tighten poll cadence in the visits-pane driver
 * and the chart identity loop. Deadlines, budgets, identity gates, and the
 * two-consecutive-equal-row-counts stability guard are UNCHANGED - only how
 * often we look, and two blind settles that later polls already re-verify.
 * Byte-safe latin1 edits, ASCII/LF-only, unique anchors, CR census pinned. */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'background.js');
const src = fs.readFileSync(FILE, 'latin1');
const crCount = s => { let n = 0; for (let i = 0; i < s.length; i++) if (s[i] === '\r') n++; return n; };
const CR_BEFORE = crCount(src);
function replaceOnce(hay, oldStr, newStr, label) {
  const first = hay.indexOf(oldStr);
  if (first < 0) throw new Error('anchor missing: ' + label);
  if (hay.indexOf(oldStr, first + 1) >= 0) throw new Error('anchor not unique: ' + label);
  if (/[^\x00-\x7F]/.test(newStr)) throw new Error('non-ASCII: ' + label);
  if (/\r/.test(newStr)) throw new Error('CR in replacement: ' + label);
  return hay.slice(0, first) + newStr + hay.slice(first + oldStr.length);
}
let out = src;

/* -- visits-pane driver (mlsReadVisitsPaneDriverFn) -- */
/* 1. identity poll 800 -> 400 (15s deadline unchanged) */
out = replaceOnce(out,
"      if (!ident) await sleep(800);\n    }\n    if (!ident && nameOnlyHit) ident = nameOnlyHit;",
"      if (!ident) await sleep(400); /* v2.9.32 speed: poll cadence only - the 15s deadline and the identity gate below are unchanged */\n    }\n    if (!ident && nameOnlyHit) ident = nameOnlyHit;",
'identity poll');
/* 2. rail-click poll 700 -> 350 (12s deadline unchanged) */
out = replaceOnce(out,
"      clicked = clickRailByAttr('visits') || clickRailLabel('Visits');\n      if (!clicked) await sleep(700);",
"      clicked = clickRailByAttr('visits') || clickRailLabel('Visits');\n      if (!clicked) await sleep(350); /* v2.9.32 speed: cadence only */",
'rail poll');
/* 3. pane poll 500 -> 300 (16s deadline unchanged) */
out = replaceOnce(out,
"    var paneDeadline = Date.now() + 16000, paneSeen = false, paneText = '';\n    while (Date.now() < paneDeadline) {\n      await sleep(500);",
"    var paneDeadline = Date.now() + 16000, paneSeen = false, paneText = '';\n    while (Date.now() < paneDeadline) {\n      await sleep(300); /* v2.9.32 speed: cadence only */",
'pane poll');
/* 4. pane recovery poll 500 -> 300 (10s deadline unchanged) */
out = replaceOnce(out,
"      var paneDeadline2 = Date.now() + 10000;\n      while (Date.now() < paneDeadline2) {\n        await sleep(500);",
"      var paneDeadline2 = Date.now() + 10000;\n      while (Date.now() < paneDeadline2) {\n        await sleep(300); /* v2.9.32 speed: cadence only */",
'pane recovery poll');
/* 5. fixed hydrate settle 1200 -> 600: the v2.03 settle-poll below is the
   real guard (it exists because this fixed sleep raced hydration) and its
   two-consecutive-equal-counts requirement is untouched */
out = replaceOnce(out,
"    await sleep(1200); /* let the entry list hydrate */",
"    await sleep(600); /* v2.9.32: shorter pre-settle - the v2.03 settle-poll below owns hydration correctness */",
'hydrate settle');
/* 6. All-Events select settle 1500 -> 800: the settle-poll below re-parses
   with the same stability requirement, so a slow re-render is still caught */
out = replaceOnce(out,
"        try { sels[sx].dispatchEvent(new W.Event('change', { bubbles: true })); } catch (eC) {}\n        await sleep(1500);",
"        try { sels[sx].dispatchEvent(new W.Event('change', { bubbles: true })); } catch (eC) {}\n        await sleep(800); /* v2.9.32: the settle-poll below still verifies the re-rendered list */",
'all-events settle');
/* 7. empty-parse poll 700 -> 400 (14s deadline + honesty invariant unchanged;
   the 800ms two-equal-counts confirmation spacing is deliberately kept) */
out = replaceOnce(out,
"      await sleep(700);\n      parsed = parseEntries();",
"      await sleep(400); /* v2.9.32 speed: cadence only; the 800ms stability confirmation above is unchanged */\n      parsed = parseEntries();",
'parse poll');

/* -- chart identity loop (mlsAppChartRequest) -- */
/* 8. post-nudge-click load wait 3200 -> 1800: the loop re-probes identity
   each round; budget caps and acceptance conditions unchanged */
out = replaceOnce(out,
"            if (!(await chartWait(3200))) { chartFailDeadline('clinical chart load'); return; }",
"            if (!(await chartWait(1800))) { chartFailDeadline('clinical chart load'); return; } /* v2.9.32: shorter first settle - the identity loop keeps re-probing under the same budget */",
'post-click wait');
/* 9. poll interval: early rounds 1200, later rounds 2400; bootstrap round-2
   settle 900 -> 600 (round 2 still re-probes and must fully re-pass) */
out = replaceOnce(out,
"          if (!(await chartWait(bootstrapReadyEarly ? 900 : 2400))) { chartFailDeadline('clinical chart readiness'); return; }",
"          if (!(await chartWait(bootstrapReadyEarly ? 600 : (polls < 3 ? 1200 : 2400)))) { chartFailDeadline('clinical chart readiness'); return; } /* v2.9.32: faster early polls, same acceptance + budgets */",
'identity poll interval');

const CR_AFTER = crCount(out);
if (CR_AFTER !== CR_BEFORE) throw new Error('CR census changed: ' + CR_BEFORE + ' -> ' + CR_AFTER);
fs.writeFileSync(FILE, out, 'latin1');
console.log('OK background.js speed edits: CRs', CR_AFTER, 'size', out.length);
