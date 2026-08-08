'use strict';

/* sx-1.1 contract: per-read session liveness (requirements ledger 6.2).
 *
 * The bounded (2.5s) session probe that sx-1.0 (b863) gave the goto failure
 * path must ride EVERY read-verb failure response — chart (mlsAppChartRequest),
 * schedule (mlsAppScheduleRequest), and history (mlsAppAllVisitsRequest) — so a
 * dead athena session is named at the first failed read, not after the batch
 * grinds N failures. ok:true responses never probe (zero happy-path pace cost).
 *
 * The allvisits listener lives OUTSIDE the scope that declares
 * __mlsProbeSessionExpired, so the probe must be exported onto self; every
 * rider reaches it as self.__mlsProbeSessionExpired behind a typeof guard
 * (extraction safety — the b863 lesson: a bare reference throws when a harness
 * extracts a handler alone, and a typeof miss silently no-ops forever).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
/* The sx-1.1 background splices live in the 3.0.45 CANDIDATE until the next
 * release train stamps a new digest and promotes them — root background.js
 * must stay byte-identical to the shipped 3.0.44 channel (the
 * extension-package digest fence enforces that). The app/site halves below
 * are backward-compatible (an absent flag changes nothing) and ship with the
 * site, so they are asserted against the live root files. */
const background = fs.readFileSync(path.join(root, 'extension-candidates', '3.0.45', 'background.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const staging = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
const sched = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

function between(source, begin, end, label) {
  const start = source.indexOf(begin);
  assert(start >= 0, 'missing start marker (' + label + '): ' + begin.slice(0, 60));
  const finish = source.indexOf(end, start);
  assert(finish > start, 'missing end marker (' + label + '): ' + end.slice(0, 60));
  return source.slice(start, finish);
}

/* 1 — the probe is exported onto self exactly once, right after its declaration. */
const exportMatches = background.match(/self\.__mlsProbeSessionExpired = __mlsProbeSessionExpired;/g) || [];
assert.strictEqual(exportMatches.length, 1, 'the probe must be exported onto self exactly once');
const probeDecl = background.indexOf('async function __mlsProbeSessionExpired()');
const probeExport = background.indexOf('self.__mlsProbeSessionExpired = __mlsProbeSessionExpired;');
assert(probeDecl >= 0 && probeExport > probeDecl && probeExport - probeDecl < 2000,
  'the self export must sit immediately after the probe declaration');

/* 2 — every rider uses the extraction-safe self.* + typeof form and the 2.5s cap. */
const riders = background.match(/\(typeof self\.__mlsProbeSessionExpired === 'function'\) \? self\.__mlsProbeSessionExpired\(\) : Promise\.resolve\(null\)/g) || [];
assert.strictEqual(riders.length, 3, 'chart + schedule + allvisits riders must all use the self.* typeof-guarded probe (found ' + riders.length + ')');

/* 3 — chartRespond: failure branch probes and attaches the flag; ok path responds untouched. */
const chartRegion = between(background, 'const chartRespond = (payload) => {', 'const chartExpired', 'chartRespond');
assert(/payload && payload\.ok !== true/.test(chartRegion), 'chartRespond must gate the rider on ok !== true');
assert(/sessionLikelyExpired: expSx === true/.test(chartRegion), 'chartRespond failure response must carry sessionLikelyExpired');
assert(/2500/.test(chartRegion), 'chartRespond rider must keep the 2.5s bound');

/* 4 — __schedRespond: same contract, responding through __schedRawRespond. */
const schedRegion = between(background, 'function __schedRespond(payload) {', 'function __schedDeadlineResponse', '__schedRespond');
assert(/payload && payload\.ok !== true/.test(schedRegion), '__schedRespond must gate the rider on ok !== true');
assert(/__schedRawRespond\(Object\.assign\(\{\}, payload \|\| \{\}, \{ sessionLikelyExpired: expSx === true/.test(schedRegion),
  '__schedRespond failure response must carry sessionLikelyExpired');

/* 5 — allvisits finish(): rider defers ONLY the response; cleanup after it still runs.
 *     The rider must not early-return out of finish() — the else branch carries the
 *     plain sendResponse and the block after the conditional stays reachable. */
const finishRegion = between(background, 'function finish(value) {', 'thisRead.then(', 'allvisits finish');
assert(/value && value\.ok !== true/.test(finishRegion), 'finish must gate the rider on ok !== true');
assert(/value\.sessionLikelyExpired = true/.test(finishRegion), 'finish must stamp the flag onto the failure value');
assert(/} else { sendResponse\(value\); }/.test(finishRegion), 'finish ok-path must respond directly');
const riderBlock = between(finishRegion, 'if (value && value.ok !== true) {', '} else { sendResponse(value); }', 'finish rider block');
assert(!/return/.test(riderBlock), 'the finish rider must never early-return past the cleanup that follows');

/* 6 — EXECUTED: the rider expression itself (the exact shape spliced into all
 *     three responders) attaches the flag on a probed-dead session, preserves
 *     the original reason, responds exactly once, and degrades to flag:false
 *     without throwing when the probe is unreachable. */
async function executedRiderSemantics() {
  const sent = [];
  let probeCalls = 0;
  const selfObj = { __mlsProbeSessionExpired: async () => { probeCalls++; return true; } };
  const payload = { ok: false, reason: 'chart-open-failed' };
  const chartRequestGuard = { token: 'req-1', deadline: 123 };
  const sendResponse = (p) => sent.push(p);
  /* the exact rider shape spliced into chartRespond: */
  await Promise.race([
    (typeof selfObj.__mlsProbeSessionExpired === 'function') ? selfObj.__mlsProbeSessionExpired() : Promise.resolve(null),
    new Promise((rsSx) => { setTimeout(() => { rsSx(null); }, 2500); })
  ]).then(
    (expSx) => { sendResponse(Object.assign({}, payload || {}, { sessionLikelyExpired: expSx === true, requestId: chartRequestGuard.token, deadlineAt: chartRequestGuard.deadline })); },
    () => { sendResponse(Object.assign({}, payload || {}, { requestId: chartRequestGuard.token, deadlineAt: chartRequestGuard.deadline })); }
  );
  assert.strictEqual(probeCalls, 1, 'failure rider must invoke the probe exactly once');
  assert.strictEqual(sent.length, 1, 'failure rider must respond exactly once');
  assert.strictEqual(sent[0].sessionLikelyExpired, true, 'a probed-dead session must ride the failure response');
  assert.strictEqual(sent[0].reason, 'chart-open-failed', 'the original failure reason must be preserved');

  /* probe unreachable → typeof guard degrades to a null race, flag false, no throw */
  const sent2 = [];
  const noSelf = {};
  await Promise.race([
    (typeof noSelf.__mlsProbeSessionExpired === 'function') ? noSelf.__mlsProbeSessionExpired() : Promise.resolve(null),
    new Promise((rsSx) => { setTimeout(() => { rsSx(null); }, 2500); })
  ]).then((expSx) => { sent2.push({ sessionLikelyExpired: expSx === true }); });
  assert.strictEqual(sent2[0].sessionLikelyExpired, false, 'an unreachable probe must degrade to flag:false, never throw');
  return true;
}

/* 7 — app side: the chart-read failure translates the flag into the canonical
 *     reason, byte-identically in ScribeFlow.html and ScribeFlow-staging.html. */
const translatedLine = "if(!r.ok || !r.text){ reject(new Error((r.sessionLikelyExpired===true?'athena-session-expired: ':'')+(r.error||";
assert(app.includes(translatedLine), 'ScribeFlow.html must translate sessionLikelyExpired into the athena-session-expired reason');
assert(staging.includes(translatedLine), 'ScribeFlow-staging.html must carry the byte-identical translation (parity law)');

/* 8 — importer: dead session halts the batch without burning retries, and the
 *     identity loop names the canonical reason. */
assert(sched.includes('if (vr && vr.sessionLikelyExpired === true) throw new Error("athena-session-expired");'),
  'the visits failure path must halt before the reopen retry when the session is probed dead');
assert(/opened && opened\.sessionLikelyExpired === true\) \? "athena-session-expired"/.test(sched),
  'the identity loop must prefer the canonical reason when the probe proved sign-out');
const haltSites = sched.match(/else if \(\/athena-session-expired\/\.test\((one\.chartReason|one\.visitsReason|pOne\.chartReason)\)\)/g) || [];
assert.strictEqual(haltSites.length, 3, 'all three reason-recording halt sites must recognize athena-session-expired (found ' + haltSites.length + ')');
assert((sched.match(/receipt\.sessionExpired = true/g) || []).length >= 2,
  'the batch receipt must record sessionExpired for the banner');
assert(sched.includes('schedSessionLikelyExpired: !!(r && r.sessionLikelyExpired)'),
  'the schedule failure must pass the probe verdict through fail()');

/* 9 — outcome renderer: every probed sign-out lands in the calm sign-in lane,
 *     never a generic failed pull. */
const signinRegion = between(connect, 'var signinRequired = ', 'if (signinRequired)', 'signinRequired predicate');
assert(/reason === 'athena-session-expired'/.test(signinRegion), 'pullOutcome must route the canonical reason to the sign-in lane');
assert(/r && r\.schedSessionLikelyExpired === true/.test(signinRegion), 'pullOutcome must route the schedule probe verdict to the sign-in lane');
assert(/hr2 && hr2\.sessionExpired === true/.test(signinRegion), 'pullOutcome must route a session-halted history batch to the sign-in lane');
assert(connect.includes('Athena sign-in required. Sign in to athenaOne, then select Retry.'),
  'the calm sign-in instruction must remain byte-stable');

/* 10 — the canonical reason string is spelled identically everywhere it appears. */
for (const [name, src] of [['background.js', background], ['ScribeFlow.html', app], ['ScribeFlow-staging.html', staging], ['feat_mls_schedimport_exact.js', sched], ['mls-connect.js', connect]]) {
  const variants = src.match(/athena[-_ ]session[-_ ]expired/gi) || [];
  for (const v of variants) assert.strictEqual(v, 'athena-session-expired', name + ' must spell the canonical reason exactly: saw "' + v + '"');
}

executedRiderSemantics().then(() => {
  console.log('per-read-session-liveness-contract: PASS');
}, (err) => {
  console.error('per-read-session-liveness-contract: FAIL', err && err.message || err);
  process.exitCode = 1;
});
