'use strict';
/* MLS Assist 3.0.126 — contfix-1.1.0: the exact "unable to complete the requested action"
 * retry page is cleared by athena's own Continue on the patient opener, the history
 * engine's weather branch and the refresh handler; the helper never clicks anything else. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* 1. execute the real helper against synthetic pages */
const s = bg.indexOf('function mlsAthenaContinueFn() {');
ok(s > 0, 'helper present');
let d = 0, e = s; for (; e < bg.length; e++) { if (bg[e] === '{') d++; else if (bg[e] === '}') { d--; if (d === 0) { e++; break; } } }
const helper = new Function('document', bg.slice(s, e) + '\nreturn mlsAthenaContinueFn();');
function page(text, controls) {
  const clicks = [];
  const els = (controls || []).map((c) => ({ value: c.value || '', textContent: c.text || '', click() { clicks.push(c.text || c.value); } }));
  return { doc: { body: { innerText: text }, querySelectorAll: () => els }, clicks };
}
{
  const p = page('We were unable to complete the requested action in athenaNet.\nClick Continue to try again, or Cancel if you did not initiate this action.', [{ value: 'Continue' }, { value: 'Cancel' }]);
  const r = helper(p.doc);
  eq(r.seen, true, 'retry page is seen'); eq(r.clicked, true, 'Continue is pressed'); assert.deepStrictEqual(p.clicks, ['Continue']); checks++;
}
{
  const p = page('We were unable to complete the requested action in athenaNet. Sign & Save the encounter to continue.', [{ value: 'Continue' }]);
  const r = helper(p.doc);
  eq(r.seen, true, 'sign vocabulary page is seen'); eq(r.clicked, false, 'never pressed on a page carrying sign vocabulary'); eq(p.clicks.length, 0, 'no click');
}
{
  const p = page('Your session has expired. Please sign in again.', [{ value: 'Continue' }]);
  const r = helper(p.doc);
  eq(r.seen, true, 'session-expired is seen'); eq(r.clicked, false, 'session-expired stays manual'); eq(r.manualActionRequired, true, 'manual action reported');
}
{
  const p = page('Clinical Inbox. Today. Schedule.', [{ value: 'Continue' }]);
  eq(helper(p.doc).seen, false, 'an ordinary page is not the retry page');
}

/* 2. the three call sites exist and press before deciding */
eq(bg.split('contfix-1.1.0').length - 1, 3, 'three contfix-1.1.0 sites');
{
  const i = bg.indexOf("execOpen({ target: { tabId: tab.id, allFrames: true }, func: mlsAthenaContinueFn }, 5000)");
  const j = bg.indexOf("            if (order[oi] === 'sched') {");
  ok(i > 0 && j > i && j - i < 600, 'patient opener presses Continue before each leg');
  ok(bg.slice(i, j).includes("failOpenDeadline('the Athena retry-page settle')"), 'the settle after the press respects the absolute open deadline');
}
{
  const i = bg.indexOf("mlsExecTO({ target: { tabId: emrId, allFrames: true }, func: mlsAthenaContinueFn }, 6000)");
  const j = bg.indexOf("          /* interstitial weather: reloading NOW is the 2026-08-08 mistake.");
  ok(i > 0 && j > i && j - i < 900, 'history engine presses Continue and re-probes before waiting out the weather');
  ok(bg.slice(i, j).includes("fbPreR = bestResult(fbPre2, function (r) { return r ? 1 : 0; }).result || fbPreR;"), 'the engine re-probes after the press');
  ok(!bg.slice(i, j).includes('surfaceRefresh'), 'the press never turns into a reload');
}
{
  const i = bg.indexOf("mlsExecTO({ target: { tabId: tabId, allFrames: true }, func: mlsAthenaContinueFn }, 6000)");
  const j = bg.indexOf("      if (pre && pre.interstitial) return { ok: false, reason: 'interstitial-weather',");
  ok(i > 0 && j > i && j - i < 700, 'refresh handler presses Continue and re-probes before refusing as weather');
}
/* 3. restorehome-1.0.0 (3.0.133): the exact-schedule restore goes Home before navigating the date */
{
  const s = bg.indexOf('async function restoreExactSchedule(stage) {');
  const e = bg.indexOf('async function waitOpen(ms) {', s);
  ok(s > 0 && e > s, 'restoreExactSchedule present');
  const body = bg.slice(s, e);
  const home = body.indexOf("func: mlsGoHomeDriverFn }, 9000)");
  const goto = body.indexOf("func: mlsAthenaGotoDate }, 40000)");
  ok(home > 0 && goto > home, 'Home (athena logo) runs before the date navigation');
  ok(body.includes("args: [openGuard], func: mlsGoHomeDriverFn"), 'Home runs under the same request guard');
  ok(body.includes("if (!(await waitOpen(2500))) { failOpenDeadline(stage || 'exact schedule restoration'); return false; }"), 'the settle respects the absolute open deadline');
  ok(!/reload|mlsRecoverAthenaTab/.test(body), 'the restore never reloads the tab');
  /* restorehome-1.1.0 (3.0.134): the date navigation retries while the strip has no day tabs yet */
  ok(body.includes("for (var rgTry = 0; rgTry < 10; rgTry++) {") && body.includes("rgTry === 9) break;"), 'bounded retry ladder (restorehome-1.2.0, 3.0.145: ten tries while only the empty strip answers)');
  ok(body.includes("value.reason === 'weekstrip-empty'"), 'retries only on the empty-strip answer');
  ok(body.includes("if (!(await waitOpen(3000))) { failOpenDeadline(stage || 'exact schedule restoration'); return false; }"), 'each retry settle respects the absolute open deadline');
  ok(body.indexOf('for (var rgTry') < body.indexOf("if (regroundX.timeout) { failOpenDeadline("), 'the loop precedes the terminal timeout check');
}
console.log('PASS contfix-30126-runtime: ' + checks + ' checks');
