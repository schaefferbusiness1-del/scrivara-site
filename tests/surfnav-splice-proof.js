/* surfnav-splice-proof.js - surfnav-1.0.0 (ext 3.0.110)
 *
 * WHAT IS BEING PROVED. scripts/splice-30110-surfnav.js is the ONLY authorized
 * way background.js gets this change (CRLF/latin1 file, exact-count anchors).
 * This suite runs that script against a TEMP COPY of background.js - never the
 * repo copy - and then proves, out of the spliced bytes themselves:
 *
 *   1. the splice is exact and idempotent-safe: both anchors matched exactly
 *      once, both markers landed, a second run REFUSES, and `node --check`
 *      passes on the result;
 *   2. nothing outside the two inserted spans moved a single byte - the whole
 *      original file, in order, survives the splice, which is what makes every
 *      deadline constant and the __gotoDeadline funnel text byte-identical;
 *   3. the surface stamp is exact: only athenaOne's own /ax/dashboard route
 *      stamps 'dashboard'; every classic calendar / schedule / frameset path,
 *      and a lookalike sibling route, stamp '';
 *   4. the decision block, LIFTED FROM THE SPLICED COPY and run in a sandbox,
 *      takes the Calendar > View Calendar restore exactly once for a control
 *      found on the dashboard and then continues the ladder; does literally
 *      nothing for a control found on the calendar; never repeats the restore
 *      inside one request; keeps every deadline funnel it touches.
 *
 * THE DEFECT IT DEFENDS (measured live 2026-09-02 05:5x-06:1x, owner's
 * practice, MLS Assist 3.0.107 loaded, site rebuilt three times in the
 * window): the durable month pull's date navigation failed nine times, and
 * every failing day was a day whose goto began while athenaOne was parked on
 * its DASHBOARD. The dashboard paints a .calendar-nav week strip that
 * mlsAthenaGotoDate accepts as its strategy 0 (background.js ~4867-4977,
 * v1.66 comment), so `found` was truthy and the `if (!found)` ladder - the
 * ONLY place the shipped Calendar > View Calendar restore runs (calmenu-1.0.0,
 * 3.0.101) - was skipped. The handler then spent its whole selected-day settle
 * budget re-clicking a widget that, in calmenu-1.0.0's own words, cannot
 * express a provider-scoped day switch, and answered the deadline funnel with
 * "...during the selected-day settle" and NO diag. Days whose goto began on
 * Calendar > View Calendar navigated in seconds.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const assert = require('assert');

const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'background.js');
const SPLICE = path.join(REPO, 'scripts', 'splice-30110-surfnav.js');
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); checks++; }

/* ---------- 1. run the real splice against a TEMP COPY ---------- */

function fullLines(s) {
  const out = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) if (s.charAt(i) === LF) { out.push(s.slice(start, i + 1)); start = i + 1; }
  if (start < s.length) out.push(s.slice(start));
  return out;
}
function body(line) {
  let b = line;
  if (b.charAt(b.length - 1) === LF) b = b.slice(0, -1);
  if (b.charAt(b.length - 1) === CR) b = b.slice(0, -1);
  return b;
}

const ANCHOR_A = '    if (!actionAllowed()) return deadlineStop();';
const ANCHOR_B = "if (!found) {";

/* The repo copy is spliced by the release, so this suite must hold BOTH before
   and after that happens - a proof that can only run once is not a proof.
   Before: temp-copy background.js and run the script on it. After: rebuild the
   pre-splice file by lifting the script's own declared lines back out, run the
   script on THAT, and require the result to equal the shipped bytes exactly -
   which additionally proves the shipped background.js is this script's output
   and nothing else. Requiring the script writes nothing (it splices only when
   run as main). */
const declared = require(SPLICE);
eq(declared.TARGET, 'background.js', 'the splice script no longer targets background.js');
eq(declared.MARKER, 'surfnav-1.0.0', 'the splice script no longer carries the surfnav marker');
eq(declared.EDITS.length, 2, 'the splice script no longer declares exactly two edits');

const repoFile = fs.readFileSync(SRC, 'latin1');
const alreadySpliced = repoFile.indexOf(declared.MARKER) >= 0;

function unsplice(text) {
  let lines = fullLines(text);
  declared.EDITS.forEach((e, i) => {
    const at = [];
    lines.forEach((l, k) => { if (body(l) === e.find) at.push(k); });
    eq(at.length, 1, 'edit ' + i + ': the anchor is not an exactly-once full line in the shipped file');
    const from = (e.where === 'before') ? at[0] - e.lines.length : at[0] + 1;
    const span = lines.slice(from, from + e.lines.length).map(body);
    eq(span.join(LF), e.lines.join(LF), 'edit ' + i + ': the shipped file does not carry this script\'s declared lines at its anchor');
    lines = lines.slice(0, from).concat(lines.slice(from + e.lines.length));
  });
  return lines.join('');
}

const original = alreadySpliced ? unsplice(repoFile) : repoFile;
eq(original.indexOf('surfnav'), -1, 'the pre-splice background.js still carries a surfnav marker');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'surfnav-'));
const copy = path.join(work, 'background.js');
fs.writeFileSync(copy, original, 'latin1');
ok(fs.readFileSync(copy, 'latin1') === original, 'the temp copy is not byte-identical to the pre-splice background.js');
ok(path.resolve(copy) !== path.resolve(SRC), 'the proof would have spliced the repo copy');

const run1 = spawnSync(process.execPath, [SPLICE], { cwd: work, encoding: 'utf8' });
const out1 = String(run1.stdout || '') + String(run1.stderr || '');
eq(run1.status, 0, 'the splice refused to run against a clean copy:' + LF + out1);
ok(/edit 0: after line \d+ \(LF\), \+12 lines/.test(out1), 'edit 0 did not report a single exact anchor insert: ' + out1);
ok(/edit 1: before line \d+ \(CRLF\), \+46 lines/.test(out1), 'edit 1 did not report a single exact anchor insert: ' + out1);
ok(/OK background\.js \(2 edits\)/.test(out1), 'the splice did not report two edits: ' + out1);
ok(/SPLICE 3\.0\.110 surfnav-1\.0\.0 DONE/.test(out1), 'the splice did not print its completion line: ' + out1);
console.log('  1. the splice ran once against a temp copy, two exact-count anchors, two edits' + (alreadySpliced ? ' (repo copy already spliced - rebuilt from the script\'s own declared lines)' : ''));

/* the anchors must be exactly-once anchors in the ORIGINAL file - this is the
   property that makes the splice safe, and the script asserts it internally.
   Prove it here too, on the same full-line definition the script uses. */
const origLines = fullLines(original);
eq(origLines.filter(l => body(l) === ANCHOR_A).length, 1, 'anchor A is not an exactly-once full line');
eq(origLines.filter(l => body(l) === ANCHOR_B).length, 1, 'anchor B is not an exactly-once full line');

/* a second run must REFUSE - the marker is now present */
const run2 = spawnSync(process.execPath, [SPLICE], { cwd: work, encoding: 'utf8' });
eq(run2.status, 1, 'the splice did not refuse a second run');
ok(/marker surfnav-1\.0\.0 is already present/.test(String(run2.stderr || '')), 'the second run refused for the wrong reason: ' + String(run2.stderr || ''));
console.log('  2. a second run refuses on its own marker (idempotence)');

const spliced = fs.readFileSync(copy, 'latin1');
if (alreadySpliced) {
  ok(spliced === repoFile, 'the shipped background.js is not byte-identical to this script\'s own output');
  checks++;
}
const check = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' });
eq(check.status, 0, 'node --check failed on the spliced copy: ' + String(check.stderr || ''));

/* the markers landed, in the two places they belong */
ok(/out\.surface = \/\\\/ax\\\/dashboard\(\?:\\\/\|\$\)\/\.test\(String\(location\.pathname \|\| ''\)\) \? 'dashboard' : ''/.test(spliced), 'the surface stamp did not land in mlsAthenaGotoDate');
ok(spliced.indexOf("if (found && found.surface === 'dashboard' && !GDIAG.surfaceRestored) {") >= 0, 'the decision block did not land in the goto handler');
eq((spliced.match(/surfnav-1\.0\.0/g) || []).length, 2, 'the surfnav marker did not land exactly twice (one per inserted span)');
console.log('  3. node --check passes on the spliced copy and both markers landed');

/* ---------- 2. nothing outside the inserted spans moved ---------- */

const splLines = fullLines(spliced);
const extraAt = [];
let oi = 0;
for (let si = 0; si < splLines.length; si++) {
  if (oi < origLines.length && splLines[si] === origLines[oi]) { oi++; continue; }
  extraAt.push(si);
}
eq(oi, origLines.length, 'the spliced file does not contain every original line, in order - the splice moved or dropped something');
eq(extraAt.length, 58, 'the splice added a different number of lines than the two blocks it declares');
eq(splLines.length - origLines.length, 58, 'the spliced line count does not match a pure insertion');
/* the two inserted spans are CONTIGUOUS - the splice made two inserts, not
   fifty-six scattered ones. */
const spans = extraAt.reduce((acc, i) => {
  const last = acc[acc.length - 1];
  if (last && i === last[1] + 1) last[1] = i; else acc.push([i, i]);
  return acc;
}, []);
eq(spans.length, 2, 'the inserted lines are not two contiguous spans');
eq(spans[0][1] - spans[0][0] + 1, 12, 'the surface-stamp span is not the 12 lines the splice declares');
eq(spans[1][1] - spans[1][0] + 1, 46, 'the decision-block span is not the 46 lines the splice declares');
/* the strongest form: strip those two spans back out and the file is the
   original, byte for byte - which is what makes every deadline constant, every
   guard and the whole __gotoDeadline funnel identical before and after. */
const dropped = new Set(extraAt);
const rebuilt = splLines.filter((l, i) => !dropped.has(i)).join('');
eq(rebuilt.length, original.length, 'the file outside the two inserted spans changed length');
ok(rebuilt === original, 'removing the two inserted spans did not reproduce background.js byte-for-byte');
checks++;
console.log('  4. the splice is a pure insertion - every other byte of background.js is unchanged');

/* every deadline the goto handler owns, and the deadline funnel's own text,
   are therefore untouched. Pin the exact lines anyway, so a future edit that
   "helpfully" retunes one of them reds here. */
const DEADLINE_LINES = [
  "    let __gotoDeadlineAt = __gotoStartedAt + (msg.probe ? 4500 : 57000);",
  "      return __gotoRespond({ ok: false, supported: true, reason: 'goto-date-deadline-exceeded', error: 'Date navigation reached its immutable request deadline during ' + (stage || 'the request') + '. No late retry was dispatched.' });",
  "        payload = { ok: false, supported: true, reason: 'goto-date-deadline-exceeded', error: 'Date navigation returned after its immutable request deadline. The late result was discarded.' };"
];
DEADLINE_LINES.forEach((line, i) => {
  eq(origLines.filter(l => body(l) === line).length, 1, 'deadline pin ' + i + ' is not an exactly-once line in the original');
  eq(splLines.filter(l => body(l) === line).length, 1, 'deadline pin ' + i + ' changed across the splice');
});
/* the deadline stage names the new leg uses are the ladder's OWN names - the
   splice introduces no new deadline vocabulary for the app to learn. */
["'the Calendar menu'", "'the Calendar menu paint'", "'the View Calendar entry'", "'the View Calendar settle'", "'date navigation'"].forEach(stage => {
  ok(original.indexOf(stage) >= 0, 'the new leg invented a deadline stage name that did not already exist: ' + stage);
});
console.log('  5. every deadline constant and the __gotoDeadline funnel text are byte-identical, and no new stage vocabulary was minted');

/* ---------- 3. the surface stamp, lifted from the spliced copy ---------- */

const stampLine = splLines.map(body).find(l => l.indexOf('out.surface =') >= 0);
ok(!!stampLine, 'the surface stamp line could not be lifted from the spliced copy');
function surfaceOf(pathname) {
  const sandbox = { out: {}, location: { pathname: pathname }, String: String };
  vm.createContext(sandbox);
  vm.runInContext(stampLine, sandbox);
  return sandbox.out.surface;
}
eq(surfaceOf('/22724/6/ax/dashboard'), 'dashboard', "athenaOne's own dashboard route did not stamp dashboard");
eq(surfaceOf('/1/1/ax/dashboard'), 'dashboard', 'the dashboard route used by this repo\'s own fixtures did not stamp dashboard');
eq(surfaceOf('/ax/dashboard'), 'dashboard', 'a context-less dashboard path did not stamp dashboard');
eq(surfaceOf('/22724/6/ax/dashboard/widgets'), 'dashboard', 'a dashboard sub-route did not stamp dashboard');
/* it cannot misfire: whole-segment match only, and no calendar/schedule
   surface is served from that route. */
eq(surfaceOf('/22724/6/ax/dashboards-report'), '', 'a lookalike sibling route was mistaken for the dashboard');
eq(surfaceOf('/22724/6/ax/calendar'), '', 'the calendar route was mistaken for the dashboard');
eq(surfaceOf('/22724/6/globalframeset.esp'), '', 'the classic frameset was mistaken for the dashboard');
eq(surfaceOf('/22724/6/schedulenavclose.esp'), '', 'a schedule plumbing frame was mistaken for the dashboard');
eq(surfaceOf('/22724/6/appointmentbrief.esp'), '', 'an appointment frame was mistaken for the dashboard');
eq(surfaceOf('/dashboard/ax/calendar'), '', 'a path merely containing dashboard was mistaken for the route');
eq(surfaceOf(''), '', 'an unreadable pathname minted a surface');
/* a frame that cannot read its own pathname must behave exactly as it does
   today: no stamp, no restore. */
(function () {
  const sandbox = { out: {}, String: String, get location() { throw new Error('cross-origin'); } };
  vm.createContext(sandbox);
  vm.runInContext(stampLine, sandbox);
  eq(sandbox.out.surface, '', 'a frame that cannot read its own path did not fall back to no-surface');
})();
/* WHERE the stamp sits is a gate, not a style choice. Reading `location` IS
   touching the renderer, and an expired injection is required to touch nothing
   at all - tests/day-schedule-absolute-deadline-runtime.test.js runs this exact
   driver against a Proxy that counts every renderer property read on an expired
   guard and asserts ZERO. The first draft of this splice stamped at the top of
   mlsAthenaGotoDate, above its own deadline guard, and reddened that pin with
   "an expired date/schedule injection touched the renderer, 1 !== 0". The stamp
   now sits immediately BELOW the guard; this pins that ordering. */
const linesOfSpliced = splLines.map(body);
const guardAt = linesOfSpliced.indexOf('    if (!actionAllowed()) return deadlineStop();');
const stampAt = linesOfSpliced.findIndex(l => l.indexOf('out.surface =') >= 0);
ok(guardAt > 0, 'the goto driver deadline guard could not be found in the spliced copy');
ok(stampAt > guardAt, 'the surface stamp reads location ABOVE the driver deadline guard - an expired injection would touch the renderer');
eq(stampAt - guardAt, 12, 'the surface stamp is no longer the statement its own comment block introduces, directly under the deadline guard');
/* and it is still above every strategy, so it is on every non-deadline return */
const strategy0At = linesOfSpliced.findIndex(l => l.indexOf("var cnav = document.querySelector('.calendar-nav');") >= 0);
ok(strategy0At > stampAt, 'the surface stamp no longer runs before the week-strip strategy it classifies');
console.log('  6. the surface stamp is exact, and it sits BELOW the driver deadline guard and ABOVE every strategy');

/* ---------- 4. the decision block, lifted from the spliced copy ---------- */

const bodies = splLines.map(body);
const blockStart = bodies.indexOf("        if (found && found.surface === 'dashboard' && !GDIAG.surfaceRestored) {");
const blockEnd = bodies.indexOf(ANCHOR_B);
ok(blockStart > 0 && blockEnd > blockStart, 'the decision block could not be located in the spliced copy');
const BLOCK = bodies.slice(blockStart, blockEnd).join(LF);
ok(BLOCK.indexOf('mlsCalendarMenuFn') > 0 && BLOCK.indexOf('__gotoDeadline') > 0, 'the lifted block is not the decision block');
/* it ends where the untouched ladder begins */
eq(bodies[blockEnd], ANCHOR_B, 'the block does not sit immediately before the existing !found ladder');

const runBlock = new Function('ctx', [
  'return (async function () {',
  '  let found = ctx.found, __gotoFoundFrame = ctx.__gotoFoundFrame;',
  '  const GDIAG = ctx.GDIAG, tab = ctx.tab, date = ctx.date, __gotoGuard = ctx.__gotoGuard;',
  '  const __gotoExec = ctx.__gotoExec, __gotoWait = ctx.__gotoWait, __gotoDeadline = ctx.__gotoDeadline, __gotoLeft = ctx.__gotoLeft;',
  '  const mlsCalendarMenuFn = ctx.mlsCalendarMenuFn, mlsAthenaGotoDate = ctx.mlsAthenaGotoDate;',
  BLOCK,
  '  return { found: found, foundFrame: __gotoFoundFrame, ladderRuns: !found };',
  '})();'
].join(LF));

const DASH = { found: true, via: 'weekstrip', surface: 'dashboard', done: false };
const CAL = { found: true, via: 'input', surface: '', done: true };

function harness(opts) {
  opts = opts || {};
  const calls = [];
  const ctx = {
    found: opts.found === undefined ? DASH : opts.found,
    __gotoFoundFrame: opts.frame === undefined ? 0 : opts.frame,
    GDIAG: opts.GDIAG || { tabId: 7, initFrames: 2, initFound: true, rounds: [] },
    tab: { id: 41 },
    date: '2026-08-14',
    __gotoGuard: { token: 'tok', deadline: Date.now() + 40000 },
    mlsCalendarMenuFn: function mlsCalendarMenuFn() {},
    mlsAthenaGotoDate: function mlsAthenaGotoDate() {},
    left: opts.left === undefined ? 45000 : opts.left,
    __gotoLeft: function () { return ctx.left; },
    __gotoWait: async function (ms, stage) { calls.push({ kind: 'wait', ms: ms, stage: stage }); return !(opts.deadlineAt && opts.deadlineAt === stage); },
    __gotoDeadline: function (stage) { calls.push({ kind: 'deadline', stage: stage }); return true; },
    __gotoExec: async function (inj, ceiling, stage) {
      const which = (inj.func === ctx.mlsCalendarMenuFn) ? ('calmenu:' + inj.args[0]) : (inj.func === ctx.mlsAthenaGotoDate ? 'goto' : 'other');
      calls.push({ kind: 'exec', which: which, ceiling: ceiling, stage: stage, tabId: inj.target.tabId, allFrames: inj.target.allFrames });
      if (which === 'calmenu:open') return { r: [{ frameId: 0, result: { stage: 'open', calendar: opts.menu !== false } }] };
      if (which === 'calmenu:pick') return { r: [{ frameId: 3, result: { stage: 'pick', viewCalendar: opts.pick !== false } }] };
      if (which === 'goto') return { r: opts.redetect || [] };
      return { timeout: true };
    }
  };
  return { ctx: ctx, calls: calls };
}

(async () => {
  /* (a) a control found on the DASHBOARD: restore taken once, ladder continues */
  {
    const h = harness({ redetect: [
      { frameId: 0, result: { found: true, via: 'weekstrip', surface: 'dashboard' } },
      { frameId: 9, result: { found: true, via: 'input', surface: '', done: true } }
    ] });
    const res = await runBlock(h.ctx);
    const execs = h.calls.filter(c => c.kind === 'exec');
    eq(execs.length, 3, 'the dashboard restore did not run exactly the three injections it declares');
    eq(execs[0].which, 'calmenu:open', 'the restore did not open athenaOne\'s own Calendar menu first');
    eq(execs[1].which, 'calmenu:pick', 'the restore did not pick View Calendar');
    eq(execs[2].which, 'goto', 'the restore did not re-detect the date control');
    eq(execs.filter(c => c.tabId !== 41).length, 0, 'the restore touched a tab other than the one already picked');
    eq(h.ctx.GDIAG.surface, 'dashboard', 'the receipt does not say which surface was found');
    eq(h.ctx.GDIAG.surfaceRestored, true, 'the receipt does not say the restore ran');
    eq(h.ctx.GDIAG.surfaceFound, true, 'the receipt does not say the restore produced a control');
    eq(res.found.via, 'input', 'the off-dashboard control did not replace the dashboard hit');
    eq(res.foundFrame, 9, 'the found frame was not re-aimed at the frame that answered off the dashboard');
    eq(res.ladderRuns, false, 'the ladder below would have re-run after a successful restore');
    /* the waits are the ladder's own, unchanged */
    const waits = h.calls.filter(c => c.kind === 'wait').map(c => c.ms + ':' + c.stage);
    eq(waits.join('|'), '900:the Calendar menu paint|6500:the View Calendar settle', 'the restore did not reuse the ladder\'s own settle waits');
    eq(h.calls.filter(c => c.kind === 'deadline').length, 0, 'a successful restore answered the deadline funnel');
    console.log('  7. a control found on the dashboard takes the Calendar > View Calendar restore once, then the ladder continues');
  }

  /* (b) a control found on the CALENDAR: byte-identical behaviour, nothing happens */
  {
    const h = harness({ found: CAL, frame: 4 });
    const before = JSON.stringify(h.ctx.GDIAG);
    const res = await runBlock(h.ctx);
    eq(h.calls.length, 0, 'a calendar-surface control triggered work it must not trigger');
    eq(JSON.stringify(h.ctx.GDIAG), before, 'a calendar-surface control wrote a surface field into the receipt');
    eq(res.found, CAL, 'a calendar-surface control did not survive untouched');
    eq(res.foundFrame, 4, 'a calendar-surface control had its frame re-aimed');
    /* and so does every pre-surfnav result shape (no `surface` field at all) */
    const legacy = harness({ found: { found: true, via: 'weekstrip' } });
    await runBlock(legacy.ctx);
    eq(legacy.calls.length, 0, 'a result minted before surfnav (no surface field) was treated as a dashboard hit');
    /* and a request that found nothing at all still falls straight through to
       the untouched !found ladder */
    const none = harness({ found: null, frame: null });
    const nres = await runBlock(none.ctx);
    eq(none.calls.length, 0, 'a request with no control at all was diverted out of the !found ladder');
    eq(nres.ladderRuns, true, 'a request with no control no longer reaches the !found ladder');
    console.log('  8. a control found on the calendar (or a pre-surfnav result, or no control) is byte-identical to today');
  }

  /* (c) the restore never repeats inside one request */
  {
    const h = harness({ redetect: [{ frameId: 0, result: { found: true, via: 'weekstrip', surface: 'dashboard' } }] });
    const first = await runBlock(h.ctx);
    eq(h.calls.filter(c => c.kind === 'exec').length, 3, 'the first restore did not run');
    eq(h.ctx.GDIAG.surfaceFound, false, 'a restore that produced no off-dashboard control claimed it did');
    eq(first.found, DASH, 'a failed restore did not leave the original hit exactly as it was');
    eq(first.foundFrame, 0, 'a failed restore moved the found frame');
    /* same request, same GDIAG, still on the dashboard: nothing more may run */
    const again = harness({ found: first.found, frame: first.foundFrame, GDIAG: h.ctx.GDIAG });
    const second = await runBlock(again.ctx);
    eq(again.calls.length, 0, 'the restore repeated inside one request');
    eq(second.found, DASH, 'the second pass changed the hit');
    console.log('  9. the restore runs at most once per request, and a restore that fails leaves the request exactly as it was');
  }

  /* (d) the budget guard and the deadline funnels */
  {
    const tight = harness({ left: 12000 });
    await runBlock(tight.ctx);
    eq(tight.calls.length, 0, 'the restore started on a request that had no room for it');
    eq(tight.ctx.GDIAG.surfaceSkipped, 'budget', 'a skipped restore did not say why');
    eq(tight.ctx.GDIAG.surfaceRestored, undefined, 'a restore that never ran claimed it did');

    const paint = harness({ deadlineAt: 'the Calendar menu paint' });
    const pres = await runBlock(paint.ctx);
    eq(pres, undefined, 'a blown deadline during the menu paint did not stop the handler');
    eq(paint.calls.filter(c => c.kind === 'deadline').map(c => c.stage).join('|'), 'the Calendar menu paint', 'the menu-paint deadline did not answer through __gotoDeadline with its own stage');

    const settle = harness({ deadlineAt: 'the View Calendar settle' });
    const sres = await runBlock(settle.ctx);
    eq(sres, undefined, 'a blown deadline during the View Calendar settle did not stop the handler');
    eq(settle.calls.filter(c => c.kind === 'deadline').map(c => c.stage).join('|'), 'the View Calendar settle', 'the settle deadline did not answer through __gotoDeadline with its own stage');
    eq(settle.calls.filter(c => c.kind === 'exec' && c.which === 'goto').length, 0, 'a blown deadline still dispatched the re-detect');

    /* a menu that is not there, or a View Calendar entry that is not there,
       stops the leg without touching the hit */
    const noMenu = harness({ menu: false });
    const nm = await runBlock(noMenu.ctx);
    eq(noMenu.calls.filter(c => c.kind === 'exec').length, 1, 'a missing Calendar menu did not stop the leg at the first injection');
    eq(nm.found, DASH, 'a missing Calendar menu changed the hit');
    eq(noMenu.ctx.GDIAG.surfaceMenu, false, 'the receipt does not say the Calendar menu was absent');

    const noPick = harness({ pick: false });
    const np = await runBlock(noPick.ctx);
    eq(noPick.calls.filter(c => c.kind === 'exec').length, 2, 'a missing View Calendar entry did not stop the leg before the re-detect');
    eq(np.found, DASH, 'a missing View Calendar entry changed the hit');
    eq(noPick.ctx.GDIAG.surfacePick, false, 'the receipt does not say the View Calendar entry was absent');

    /* every injection ceiling is bounded by what is left of the request */
    const bounded = harness({ left: 20000, redetect: [] });
    await runBlock(bounded.ctx);
    bounded.calls.filter(c => c.kind === 'exec').forEach(c => {
      ok(c.ceiling <= 20000, 'an injection ceiling exceeded the remaining request budget: ' + c.stage + ' = ' + c.ceiling);
    });
    console.log(' 10. the budget guard, both deadline funnels, and every injection ceiling hold');
  }

  try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
  console.log('surfnav-splice-proof PASS (' + checks + ' checks)');
})().catch(e => { console.error(e); process.exit(1); });
