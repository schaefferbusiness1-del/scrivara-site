'use strict';
/* MLS Assist 3.0.126 - contfix-1.1.0 (Fable, 2026-09-14). Owner: "in athena sometimes I
 * have to click continue or things break". The exact-page Continue press (contfix-1.0.0,
 * 3.0.100) existed only on the goHome/gotoDate paths; the patient opener, the history
 * engine's "interstitial weather" branch and the refresh handler all stalled on that page.
 * Byte-preserving latin1 seams with an inverse proof. Run once: node scripts/splice-30126.js
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function eolAt(anchor) { const i = out.indexOf(anchor); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90)); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
const PRESS = (tabExpr, execExpr, afterExpr) =>
  "try { var __contX = await " + execExpr + "; if (__contX && __contX.r && __contX.r.some(function (e) { return e && e.result && e.result.clicked; })) { " + afterExpr + " } } catch (eContFix) {}";

/* 1. patient opener: before every leg, clear the exact retry page */
{
  const a = "            if (order[oi] === 'sched') {";
  const N = eolAt(a);
  rep(a,
      "            /* contfix-1.1.0 (3.0.126): athena's \"unable to complete the requested action\" retry page can sit" + N +
      "               in the work tab between legs; press its own Continue (exact page, exact control, never a" + N +
      "               sign/order/billing page) before opening anything, then settle. */" + N +
      "            " + PRESS('tab.id', "execOpen({ target: { tabId: tab.id, allFrames: true }, func: mlsAthenaContinueFn }, 5000)", "if (!(await waitOpen(2500))) { failOpenDeadline('the Athena retry-page settle'); return; }") + N +
      a, 'opener');
}

/* 2. history engine: press Continue on the weather page, then re-probe before deciding to wait */
{
  const a = "        if (fbPreR && fbPreR.interstitial) {";
  const N = eolAt(a);
  rep(a,
      "        if (fbPreR && fbPreR.interstitial) {" + N +
      "          /* contfix-1.1.0 (3.0.126): press athena's own Continue on the exact retry page, then re-probe. */" + N +
      "          " + PRESS('emrId', "mlsExecTO({ target: { tabId: emrId, allFrames: true }, func: mlsAthenaContinueFn }, 6000)", "await sleep(4000); try { var fbPre2 = await exec(emrId, [0], ['surfaceProbe', cfg]); fbPreR = bestResult(fbPre2, function (r) { return r ? 1 : 0; }).result || fbPreR; } catch (eFbP2) {}") + N +
      "        }" + N +
      "        if (fbPreR && fbPreR.interstitial) {", 'engine');
}

/* 3. refresh handler: press Continue and re-probe before refusing as weather */
{
  const a = "      if (pre && pre.interstitial) return { ok: false, reason: 'interstitial-weather',";
  const N = eolAt(a);
  rep(a,
      "      if (pre && pre.interstitial) { /* contfix-1.1.0 (3.0.126) */ " + PRESS('tabId', "mlsExecTO({ target: { tabId: tabId, allFrames: true }, func: mlsAthenaContinueFn }, 6000)", "await new Promise(function (r) { setTimeout(r, 4000); }); try { pre = bestResult(await exec(tabId, [0], ['surfaceProbe', cfg]), function (r) { return r ? 1 : 0; }).result || pre; } catch (eImP2) {}") + " }" + N +
      a, 'refresh');
}

let restored = out;
for (const [a, b] of edits.slice().reverse()) { assert(count(restored, b) === 1, 'inverse unique'); restored = restored.replace(b, () => a); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30126: ' + edits.length + ' verified seams, ' + (out.length - before.length) + ' bytes delta');
